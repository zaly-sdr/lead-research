// Lead Merger - Combina y deduplica leads de LinkedIn y Google Places
// Regla clave: Solo leads con LinkedIn URL son validos

import type { UnipileNormalizedPerson } from "./unipile-types";
import type { GooglePlacesNormalizedResult } from "./google-places-types";
import type {
  MergedLead,
  MergeOptions,
  LeadSource,
} from "./lead-merger-types";

// --- Utilidades de normalizacion ---

/**
 * Normaliza un string para comparaciones fuzzy.
 * - Lowercase
 * - Sin acentos
 * - Sin caracteres especiales
 * - Sin espacios extra
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9\s]/g, "") // Remove special chars
    .replace(/\s+/g, " ") // Normalize spaces
    .trim();
}

/**
 * Extrae palabras significativas de un nombre de empresa.
 * Remueve sufijos comunes como S.A., S.L., Inc., etc.
 */
function extractCompanyKeywords(companyName: string): readonly string[] {
  const normalized = normalizeString(companyName);

  // Sufijos comunes a remover
  const suffixes = [
    "sa", "sl", "slu", "sau", "inc", "llc", "ltd", "corp", "corporation",
    "gmbh", "ag", "bv", "nv", "plc", "company", "co", "group", "holding",
    "holdings", "international", "intl", "espana", "spain", "europe",
    "global", "worldwide", "solutions", "services", "consulting",
  ];

  const words = normalized.split(" ");
  const filtered = words.filter(
    (word) => word.length > 1 && !suffixes.includes(word)
  );

  return filtered;
}

// --- Fuzzy matching ---

/**
 * Calcula la similitud entre dos strings usando coeficiente de Dice.
 * Retorna un valor entre 0 y 1.
 */
function diceCoefficient(str1: string, str2: string): number {
  const s1 = normalizeString(str1);
  const s2 = normalizeString(str2);

  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  // Crear bigramas
  const bigrams1 = new Set<string>();
  for (let i = 0; i < s1.length - 1; i++) {
    bigrams1.add(s1.substring(i, i + 2));
  }

  const bigrams2 = new Set<string>();
  for (let i = 0; i < s2.length - 1; i++) {
    bigrams2.add(s2.substring(i, i + 2));
  }

  // Contar interseccion
  let intersection = 0;
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) {
      intersection++;
    }
  }

  return (2 * intersection) / (bigrams1.size + bigrams2.size);
}

/**
 * Compara dos nombres de empresa con logica de negocio.
 * Considera keywords principales y variaciones comunes.
 */
export function compareCompanyNames(
  name1: string,
  name2: string,
  threshold: number = 0.7
): { match: boolean; confidence: "high" | "medium" | "low"; score: number } {
  // Comparacion exacta normalizada
  const n1 = normalizeString(name1);
  const n2 = normalizeString(name2);

  if (n1 === n2) {
    return { match: true, confidence: "high", score: 1 };
  }

  // Uno contiene al otro completamente
  if (n1.includes(n2) || n2.includes(n1)) {
    return { match: true, confidence: "high", score: 0.95 };
  }

  // Comparar keywords principales
  const keywords1 = extractCompanyKeywords(name1);
  const keywords2 = extractCompanyKeywords(name2);

  // Si el keyword principal coincide
  if (
    keywords1.length > 0 &&
    keywords2.length > 0 &&
    keywords1[0] === keywords2[0]
  ) {
    return { match: true, confidence: "high", score: 0.9 };
  }

  // Fuzzy matching con Dice coefficient
  const score = diceCoefficient(name1, name2);

  if (score >= 0.85) {
    return { match: true, confidence: "high", score };
  }

  if (score >= threshold) {
    return { match: true, confidence: "medium", score };
  }

  if (score >= 0.5) {
    return { match: false, confidence: "low", score };
  }

  return { match: false, confidence: "low", score };
}

// --- Asociacion de persona con empresa ---

export interface PersonCompanyAssociation {
  readonly place: GooglePlacesNormalizedResult;
  readonly confidence: "high" | "medium";
}

/**
 * Intenta asociar una persona de LinkedIn con una empresa de Google Places.
 *
 * Estrategias (en orden de prioridad):
 * 1. Match por LinkedIn companyId (alta precision)
 * 2. Match por companyName con fuzzy matching (menor precision)
 *
 * @param person Persona de LinkedIn
 * @param googlePlaces Lista de empresas de Google Places
 * @param linkedInCompanyIdToPlace Mapa de companyId → Google Place
 * @param options.fuzzyThreshold Umbral para fuzzy matching (default 0.75)
 */
export function associatePersonWithCompany(
  person: UnipileNormalizedPerson,
  googlePlaces: readonly GooglePlacesNormalizedResult[],
  linkedInCompanyIdToPlace: Map<string, GooglePlacesNormalizedResult>,
  options: { fuzzyThreshold?: number } = {}
): PersonCompanyAssociation | null {
  const { fuzzyThreshold = 0.75 } = options;

  // Estrategia 1: Match por LinkedIn companyId (alta precision)
  if (person.companyId) {
    const placeById = linkedInCompanyIdToPlace.get(person.companyId);
    if (placeById) {
      return { place: placeById, confidence: "high" };
    }
  }

  // Estrategia 2: Match por companyName con fuzzy matching
  if (person.companyName) {
    for (const place of googlePlaces) {
      const comparison = compareCompanyNames(
        person.companyName,
        place.companyName,
        fuzzyThreshold
      );

      if (comparison.match && comparison.confidence !== "low") {
        return {
          place,
          confidence: comparison.confidence as "high" | "medium",
        };
      }
    }
  }

  return null;
}

// --- Generacion de ID ---

function generateLeadId(): string {
  // Generar UUID v4 simple
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// --- Funciones de merge ---

/**
 * Crea un MergedLead a partir de una persona de LinkedIn y opcionalmente
 * datos de empresa de Google Places.
 */
export function createMergedLead(
  person: UnipileNormalizedPerson,
  place: GooglePlacesNormalizedResult | null,
  matchConfidence: "high" | "medium" | "low" = "high"
): MergedLead | null {
  // REGLA CLAVE: Sin LinkedIn URL no es un lead valido
  if (!person.profileUrl) {
    return null;
  }

  const sources: LeadSource[] = place ? ["linkedin", "google_places"] : ["linkedin"];

  return {
    id: generateLeadId(),
    linkedinId: person.linkedinId,
    googlePlaceId: place?.placeId ?? null,

    // Datos de persona (LinkedIn)
    fullName: person.fullName,
    firstName: person.firstName,
    lastName: person.lastName,
    jobTitle: person.jobTitle,
    headline: person.headline,
    linkedinUrl: person.profileUrl,
    profilePictureUrl: person.profilePictureUrl,
    networkDistance: person.networkDistance,

    // Datos de empresa (preferir Google Places si disponible, mas completo)
    companyName: place?.companyName ?? person.companyName ?? "Desconocida",
    companyWebsite: place?.website ?? null,
    companyPhone: place?.phone ?? null,
    companyAddress: place?.formattedAddress ?? null,
    companyRating: place?.rating ?? null,
    companyIndustry: place?.primaryType ?? null,

    // Ubicacion (preferir Google Places, mas estructurado)
    city: place?.city ?? extractCityFromLocation(person.location),
    region: place?.region ?? null,
    country: place?.country ?? extractCountryFromLocation(person.location),

    // Metadata
    sources,
    matchConfidence,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Intenta extraer la ciudad de un string de ubicacion de LinkedIn.
 * LinkedIn devuelve ubicaciones como "Madrid, Comunidad de Madrid, Espana"
 */
function extractCityFromLocation(location: string | null): string | null {
  if (!location) return null;
  const parts = location.split(",").map((p) => p.trim());
  return parts[0] ?? null;
}

/**
 * Intenta extraer el pais de un string de ubicacion de LinkedIn.
 */
function extractCountryFromLocation(location: string | null): string | null {
  if (!location) return null;
  const parts = location.split(",").map((p) => p.trim());
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

// --- Deduplicacion ---

/**
 * Deduplica leads por LinkedIn ID.
 * Si hay duplicados, mantiene el que tiene mas datos (sources: both).
 */
export function deduplicateLeads(
  leads: readonly MergedLead[]
): readonly MergedLead[] {
  const seenLinkedInIds = new Map<string, MergedLead>();

  for (const lead of leads) {
    const existing = seenLinkedInIds.get(lead.linkedinId ?? "");

    if (!existing) {
      seenLinkedInIds.set(lead.linkedinId ?? lead.id, lead);
      continue;
    }

    // Si el nuevo tiene mas fuentes, reemplazar
    if (lead.sources.length > existing.sources.length) {
      seenLinkedInIds.set(lead.linkedinId ?? lead.id, lead);
    }
    // Si el nuevo tiene mejor confidence, reemplazar
    else if (
      lead.matchConfidence === "high" &&
      existing.matchConfidence !== "high"
    ) {
      seenLinkedInIds.set(lead.linkedinId ?? lead.id, lead);
    }
  }

  return [...seenLinkedInIds.values()];
}

// --- Merge principal ---

export interface MergeInput {
  readonly linkedInPeople: readonly UnipileNormalizedPerson[];
  readonly googlePlaces: readonly GooglePlacesNormalizedResult[];
  readonly linkedInPeopleByCompany: ReadonlyMap<
    string, // companyName normalizado
    readonly UnipileNormalizedPerson[]
  >;
}

export interface MergeResult {
  readonly leads: readonly MergedLead[];
  readonly stats: {
    readonly totalLinkedIn: number;
    readonly totalGoogle: number;
    readonly mergedWithGoogle: number;
    readonly linkedInOnly: number;
    readonly discardedNoUrl: number;
  };
}

/**
 * Merge principal: combina personas de LinkedIn con empresas de Google Places.
 *
 * Flujo:
 * 1. Para cada empresa de Google, buscar personas de LinkedIn que trabajen ahi
 * 2. Crear MergedLead combinando persona + empresa
 * 3. Agregar personas de LinkedIn que no matchearon con Google (solo si tienen URL)
 * 4. Deduplicar por LinkedIn ID
 */
export function mergeLeads(
  input: MergeInput,
  options: MergeOptions = {}
): MergeResult {
  const { fuzzyThreshold = 0.7 } = options;

  const allLeads: MergedLead[] = [];
  const usedLinkedInIds = new Set<string>();
  let discardedNoUrl = 0;

  // Paso 1: Para cada empresa de Google, buscar personas de LinkedIn
  for (const place of input.googlePlaces) {
    const placeNameNormalized = normalizeString(place.companyName);

    // Buscar en el mapa de personas por empresa
    const peopleForCompany = input.linkedInPeopleByCompany.get(placeNameNormalized);

    if (peopleForCompany && peopleForCompany.length > 0) {
      // Match directo por nombre de empresa
      for (const person of peopleForCompany) {
        const lead = createMergedLead(person, place, "high");
        if (lead) {
          allLeads.push(lead);
          usedLinkedInIds.add(person.linkedinId);
        } else {
          discardedNoUrl++;
        }
      }
    } else {
      // Intentar fuzzy matching con todas las personas de LinkedIn
      for (const person of input.linkedInPeople) {
        if (usedLinkedInIds.has(person.linkedinId)) continue;
        if (!person.companyName) continue;

        const comparison = compareCompanyNames(
          place.companyName,
          person.companyName,
          fuzzyThreshold
        );

        if (comparison.match) {
          const lead = createMergedLead(person, place, comparison.confidence);
          if (lead) {
            allLeads.push(lead);
            usedLinkedInIds.add(person.linkedinId);
          } else {
            discardedNoUrl++;
          }
        }
      }
    }
  }

  // Paso 2: Agregar personas de LinkedIn que no matchearon (solo con URL)
  for (const person of input.linkedInPeople) {
    if (usedLinkedInIds.has(person.linkedinId)) continue;

    const lead = createMergedLead(person, null, "high");
    if (lead) {
      allLeads.push(lead);
    } else {
      discardedNoUrl++;
    }
  }

  // Paso 3: Deduplicar
  const deduplicated = deduplicateLeads(allLeads);

  // Calcular stats
  const mergedWithGoogle = deduplicated.filter(
    (l) => l.sources.includes("google_places")
  ).length;
  const linkedInOnly = deduplicated.filter(
    (l) => l.sources.length === 1 && l.sources[0] === "linkedin"
  ).length;

  return {
    leads: deduplicated,
    stats: {
      totalLinkedIn: input.linkedInPeople.length,
      totalGoogle: input.googlePlaces.length,
      mergedWithGoogle,
      linkedInOnly,
      discardedNoUrl,
    },
  };
}

/**
 * Agrupa personas de LinkedIn por nombre de empresa normalizado.
 * Util para el matching con Google Places.
 */
export function groupPeopleByCompany(
  people: readonly UnipileNormalizedPerson[]
): Map<string, UnipileNormalizedPerson[]> {
  const map = new Map<string, UnipileNormalizedPerson[]>();

  for (const person of people) {
    if (!person.companyName) continue;

    const key = normalizeString(person.companyName);
    const existing = map.get(key) ?? [];
    map.set(key, [...existing, person]);
  }

  return map;
}
