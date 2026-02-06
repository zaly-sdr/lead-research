// Search Orchestrator - Coordina el flujo completo de busqueda de leads
// Flujo: Google Places → LinkedIn (por empresa) → Merge → Dedup

import type { ParsedSearchParamsInput } from "@/libs/validators/search-schema";
import {
  searchGooglePlaces,
  isGooglePlacesAvailable,
} from "./google-places-service";
import {
  searchPeopleByCompany,
  searchPeopleByCompanyId,
  searchPeopleDirect,
  findCompanyIdWithValidation,
  isUnipileAvailable,
  getUnipileRateLimitStats,
  RateLimitError,
} from "./unipile-service";
import {
  createMergedLead,
  deduplicateLeads,
  associatePersonWithCompany,
} from "./lead-merger";
import type { MergedLead } from "./lead-merger-types";
import type { UnipileNormalizedPerson } from "./unipile-types";
import type { GooglePlacesNormalizedResult } from "./google-places-types";

// --- Configuracion ---

const DEFAULT_MAX_GOOGLE_RESULTS = 20;
const DEFAULT_MAX_LINKEDIN_PER_COMPANY = 5; // Mas personas por empresa
const DEFAULT_MAX_TOTAL_LEADS = 200; // Objetivo: 50-200 leads para que la IA filtre

// --- Tipos ---

export interface SearchOrchestratorOptions {
  readonly params: ParsedSearchParamsInput;
  readonly maxGoogleResults?: number;
  readonly maxLinkedInPerCompany?: number;
  readonly maxTotalLeads?: number;
  readonly skipGooglePlaces?: boolean; // Para busquedas solo LinkedIn
}

export interface SearchOrchestratorResult {
  readonly success: boolean;
  readonly leads: readonly MergedLead[];
  readonly stats: {
    readonly googlePlaces: {
      readonly searched: boolean;
      readonly found: number;
      readonly companiesProcessed: number;
    };
    readonly linkedIn: {
      readonly searched: boolean;
      readonly directSearchPeople: number;
      readonly companySearchPeople: number;
      readonly searchesUsed: number;
    };
    readonly merge: {
      readonly totalBeforeMerge: number;
      readonly mergedWithGoogle: number;
      readonly linkedInOnly: number;
      readonly discardedNoUrl: number;
      readonly finalCount: number;
    };
    readonly rateLimits: {
      readonly unipileHourlyRemaining: number;
      readonly unipileDailyRemaining: number;
    };
  };
  readonly errors: readonly string[];
}

// --- Orquestador principal ---

/**
 * Ejecuta una busqueda completa de leads.
 *
 * Flujo mejorado:
 * 1. Buscar empresas en Google Places
 * 2. PRE-RESOLUCION: Para cada empresa, resolver su LinkedIn company ID
 * 3. BUSQUEDAS EN PARALELO:
 *    - Busqueda directa LinkedIn (amplia)
 *    - Por cada empresa con companyId: buscar personas
 * 4. POST-ASOCIACION: Asociar personas de busqueda directa con empresas
 * 5. Merge + Dedup
 */
export async function executeSearch(
  options: SearchOrchestratorOptions
): Promise<SearchOrchestratorResult> {
  const {
    params,
    maxGoogleResults = DEFAULT_MAX_GOOGLE_RESULTS,
    maxLinkedInPerCompany = DEFAULT_MAX_LINKEDIN_PER_COMPANY,
    maxTotalLeads = DEFAULT_MAX_TOTAL_LEADS,
    skipGooglePlaces = false,
  } = options;

  const errors: string[] = [];
  let googlePlaces: readonly GooglePlacesNormalizedResult[] = [];
  let linkedInSearchesUsed = 0;

  // Mapeos para asociar personas con empresas
  const personToPlace = new Map<string, GooglePlacesNormalizedResult>();
  const linkedInCompanyIdToPlace = new Map<string, GooglePlacesNormalizedResult>();

  // --- Paso 1: Google Places ---
  if (!skipGooglePlaces && isGooglePlacesAvailable()) {
    try {
      const googleResult = await searchGooglePlaces({
        params,
        maxResults: maxGoogleResults,
      });
      googlePlaces = googleResult.places;
      console.log(
        `[Orchestrator] Google Places: ${googlePlaces.length} empresas encontradas`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      errors.push(`Google Places: ${message}`);
    }
  } else if (!skipGooglePlaces && !isGooglePlacesAvailable()) {
    errors.push("Google Places: API key no configurada");
  }

  // --- Paso 2: PRE-RESOLUCION de LinkedIn company IDs ---
  if (googlePlaces.length > 0 && isUnipileAvailable()) {
    console.log(
      `[Orchestrator] Resolviendo company IDs para ${googlePlaces.length} empresas...`
    );

    const companyIdPromises = googlePlaces.map(async (place) => {
      try {
        const result = await findCompanyIdWithValidation(
          place.companyName,
          place.website
        );
        return { place, ...result };
      } catch (error) {
        console.warn(
          `[Orchestrator] Error resolviendo company ID para "${place.companyName}":`,
          error
        );
        return { place, companyId: null, confidence: "low" as const };
      }
    });

    const companyIdResults = await Promise.all(companyIdPromises);

    for (const { place, companyId, confidence } of companyIdResults) {
      if (companyId) {
        linkedInCompanyIdToPlace.set(companyId, place);
        console.log(
          `[Orchestrator] ${place.companyName} → LinkedIn ID: ${companyId} (${confidence})`
        );
      }
    }

    console.log(
      `[Orchestrator] Resueltos ${linkedInCompanyIdToPlace.size}/${googlePlaces.length} company IDs`
    );
  }

  // --- Paso 3: Busquedas LinkedIn en PARALELO ---
  let allPeople: UnipileNormalizedPerson[] = [];
  const seenIds = new Set<string>();
  let directSearchCount = 0;
  let companySearchCount = 0;

  if (!isUnipileAvailable()) {
    errors.push("LinkedIn: Unipile no configurado");
  } else {
    const rateLimitStats = getUnipileRateLimitStats();
    const remainingSearches = rateLimitStats?.hourlyRemaining ?? 0;

    // Preparar promesas de busqueda
    const searchPromises: Promise<{
      type: "direct" | "company";
      place?: GooglePlacesNormalizedResult;
      companyId?: string;
      result?: { people: readonly UnipileNormalizedPerson[]; pagesUsed: number };
      error?: string;
    }>[] = [];

    // 3a. Busqueda directa amplia
    searchPromises.push(
      searchPeopleDirect({ params, maxResults: 100 })
        .then((result) => ({
          type: "direct" as const,
          result: { people: result.people, pagesUsed: result.pagesUsed },
        }))
        .catch((error) => {
          const message =
            error instanceof RateLimitError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Error desconocido";
          return { type: "direct" as const, error: `LinkedIn directo: ${message}` };
        })
    );

    // 3b. Busquedas por empresa (solo las que tienen companyId)
    const companiesWithId = [...linkedInCompanyIdToPlace.entries()];
    const maxCompaniesToProcess = Math.min(
      companiesWithId.length,
      Math.max(0, remainingSearches - 1) // Reservar 1 para busqueda directa
    );

    for (let i = 0; i < maxCompaniesToProcess; i++) {
      const entry = companiesWithId[i];
      if (!entry) continue;

      const [companyId, place] = entry;

      searchPromises.push(
        searchPeopleByCompanyId({
          companyId,
          companyName: place.companyName,
          params,
          maxResults: maxLinkedInPerCompany,
        })
          .then((result) => ({
            type: "company" as const,
            place,
            companyId,
            result: { people: result.people, pagesUsed: result.pagesUsed },
          }))
          .catch((error) => {
            const message =
              error instanceof RateLimitError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : "Error";
            return {
              type: "company" as const,
              place,
              companyId,
              error: `LinkedIn "${place.companyName}": ${message}`,
            };
          })
      );
    }

    // Ejecutar en paralelo
    console.log(
      `[Orchestrator] Lanzando ${searchPromises.length} busquedas LinkedIn...`
    );
    const searchResults = await Promise.all(searchPromises);

    // --- Paso 4: Procesar resultados ---

    // 4a. Primero procesar busquedas por empresa (alta confianza)
    for (const searchResult of searchResults) {
      if (searchResult.type !== "company") continue;
      if (searchResult.error) {
        errors.push(searchResult.error);
        continue;
      }
      if (!searchResult.result || !searchResult.place) continue;

      linkedInSearchesUsed += searchResult.result.pagesUsed;

      for (const person of searchResult.result.people) {
        if (seenIds.has(person.linkedinId)) continue;

        allPeople.push(person);
        seenIds.add(person.linkedinId);
        personToPlace.set(person.linkedinId, searchResult.place);
        companySearchCount++;
      }
    }

    // 4b. Luego procesar busqueda directa con POST-ASOCIACION
    for (const searchResult of searchResults) {
      if (searchResult.type !== "direct") continue;
      if (searchResult.error) {
        errors.push(searchResult.error);
        continue;
      }
      if (!searchResult.result) continue;

      linkedInSearchesUsed += searchResult.result.pagesUsed;

      for (const person of searchResult.result.people) {
        if (seenIds.has(person.linkedinId)) continue;

        // POST-ASOCIACION: Intentar asociar con Google Places
        const association = associatePersonWithCompany(
          person,
          googlePlaces,
          linkedInCompanyIdToPlace,
          { fuzzyThreshold: 0.75 }
        );

        if (association) {
          personToPlace.set(person.linkedinId, association.place);
        }

        allPeople.push(person);
        seenIds.add(person.linkedinId);
        directSearchCount++;
      }
    }
  }

  // --- Paso 5: Crear MergedLeads ---
  const allLeads: MergedLead[] = [];
  let mergedWithGoogleCount = 0;
  let linkedInOnlyCount = 0;
  let discardedNoUrlCount = 0;

  for (const person of allPeople) {
    const associatedPlace = personToPlace.get(person.linkedinId) ?? null;
    const confidence = associatedPlace ? "high" : "medium";

    const lead = createMergedLead(person, associatedPlace, confidence);

    if (lead) {
      allLeads.push(lead);
      if (associatedPlace) {
        mergedWithGoogleCount++;
      } else {
        linkedInOnlyCount++;
      }
    } else {
      discardedNoUrlCount++;
    }
  }

  // --- Paso 6: Deduplicar y limitar ---
  const dedupedLeads = deduplicateLeads(allLeads);
  const finalLeads = dedupedLeads.slice(0, maxTotalLeads);

  const finalRateLimits = getUnipileRateLimitStats();

  return {
    success: errors.length === 0 || finalLeads.length > 0,
    leads: finalLeads,
    stats: {
      googlePlaces: {
        searched: !skipGooglePlaces && isGooglePlacesAvailable(),
        found: googlePlaces.length,
        companiesProcessed: linkedInCompanyIdToPlace.size,
      },
      linkedIn: {
        searched: isUnipileAvailable(),
        directSearchPeople: directSearchCount,
        companySearchPeople: companySearchCount,
        searchesUsed: linkedInSearchesUsed,
      },
      merge: {
        totalBeforeMerge: allPeople.length,
        mergedWithGoogle: mergedWithGoogleCount,
        linkedInOnly: linkedInOnlyCount,
        discardedNoUrl: discardedNoUrlCount,
        finalCount: finalLeads.length,
      },
      rateLimits: {
        unipileHourlyRemaining: finalRateLimits?.hourlyRemaining ?? 0,
        unipileDailyRemaining: finalRateLimits?.dailyRemaining ?? 0,
      },
    },
    errors,
  };
}

// --- Busqueda simplificada solo LinkedIn ---

export interface LinkedInOnlySearchOptions {
  readonly params: ParsedSearchParamsInput;
  readonly companyName?: string;
  readonly maxResults?: number;
}

/**
 * Busqueda simplificada solo en LinkedIn.
 * Util cuando no se necesita Google Places o para busquedas por empresa especifica.
 */
export async function searchLinkedInOnly(
  options: LinkedInOnlySearchOptions
): Promise<SearchOrchestratorResult> {
  const { params, companyName, maxResults = 25 } = options;

  const errors: string[] = [];
  let linkedInPeople: UnipileNormalizedPerson[] = [];
  let linkedInSearchesUsed = 0;

  if (!isUnipileAvailable()) {
    return {
      success: false,
      leads: [],
      stats: {
        googlePlaces: { searched: false, found: 0, companiesProcessed: 0 },
        linkedIn: { searched: false, directSearchPeople: 0, companySearchPeople: 0, searchesUsed: 0 },
        merge: { totalBeforeMerge: 0, mergedWithGoogle: 0, linkedInOnly: 0, discardedNoUrl: 0, finalCount: 0 },
        rateLimits: { unipileHourlyRemaining: 0, unipileDailyRemaining: 0 },
      },
      errors: ["LinkedIn: Unipile no configurado"],
    };
  }

  try {
    if (companyName) {
      // Busqueda por empresa especifica
      console.log(`[Orchestrator] Searching LinkedIn for company: ${companyName}`);
      const result = await searchPeopleByCompany({
        companyName,
        params,
        maxResults,
      });
      console.log(`[Orchestrator] LinkedIn result: ${result.people.length} people found`);
      linkedInPeople = [...result.people];
      linkedInSearchesUsed = result.pagesUsed;
    } else {
      // Busqueda general
      const result = await searchPeopleDirect({
        params,
        maxResults,
      });
      linkedInPeople = [...result.people];
      linkedInSearchesUsed = result.pagesUsed;
    }
  } catch (error) {
    if (error instanceof RateLimitError) {
      errors.push(`LinkedIn: ${error.message}`);
    } else {
      const message = error instanceof Error ? error.message : "Error desconocido";
      errors.push(`LinkedIn: ${message}`);
    }
  }

  // Crear leads (solo los que tienen URL)
  const leads: MergedLead[] = [];
  let discardedNoUrl = 0;

  for (const person of linkedInPeople) {
    const lead = createMergedLead(person, null, "high");
    if (lead) {
      leads.push(lead);
    } else {
      discardedNoUrl++;
    }
  }

  const deduplicated = deduplicateLeads(leads);
  const finalRateLimits = getUnipileRateLimitStats();

  return {
    success: errors.length === 0 || deduplicated.length > 0,
    leads: deduplicated,
    stats: {
      googlePlaces: { searched: false, found: 0, companiesProcessed: 0 },
      linkedIn: {
        searched: true,
        directSearchPeople: companyName ? 0 : linkedInPeople.length,
        companySearchPeople: companyName ? linkedInPeople.length : 0,
        searchesUsed: linkedInSearchesUsed,
      },
      merge: {
        totalBeforeMerge: linkedInPeople.length,
        mergedWithGoogle: 0,
        linkedInOnly: deduplicated.length,
        discardedNoUrl,
        finalCount: deduplicated.length,
      },
      rateLimits: {
        unipileHourlyRemaining: finalRateLimits?.hourlyRemaining ?? 0,
        unipileDailyRemaining: finalRateLimits?.dailyRemaining ?? 0,
      },
    },
    errors,
  };
}

// --- Utilidades ---

/**
 * Verifica si todas las APIs necesarias estan disponibles.
 */
export function checkApiAvailability(): {
  googlePlaces: boolean;
  unipile: boolean;
  allRequired: boolean;
} {
  const googlePlaces = isGooglePlacesAvailable();
  const unipile = isUnipileAvailable();

  return {
    googlePlaces,
    unipile,
    // LinkedIn es obligatorio (necesitamos URLs), Google Places es opcional
    allRequired: unipile,
  };
}
