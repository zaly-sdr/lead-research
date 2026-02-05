// Search Executor - Ejecuta el flujo completo de búsqueda + scoring
// Orquesta: Google Places → LinkedIn → Merge → Score → Guardar en DB

import { createClient } from "@/libs/supabase/admin";
import { executeSearch } from "./search-orchestrator";
import { scoreLeads, type ScoredLead } from "@/libs/ai/lead-scorer";
import type { ParsedSearchParams } from "@/types/search";
import type { MergedLead } from "./lead-merger-types";
import type { CreateLeadPayload } from "@/types/lead";

// --- Tipos ---

export interface ExecuteSearchOptions {
  readonly searchId: number;
  readonly userId: string;
  readonly parsedParams: ParsedSearchParams;
  readonly skipScoring?: boolean; // Para testing
}

export interface ExecuteSearchResult {
  readonly success: boolean;
  readonly leadsCreated: number;
  readonly stats: {
    readonly searchDurationMs: number;
    readonly scoringDurationMs: number;
    readonly totalLeadsFound: number;
    readonly leadsAboveThreshold: number;
    readonly avgScore: number;
  };
  readonly errors: readonly string[];
}

// --- Helpers ---

// Convertir MergedLead + ScoredLead a CreateLeadPayload
function toCreateLeadPayload(
  merged: MergedLead,
  scored: ScoredLead | undefined,
  searchId: number,
  userId: string
): CreateLeadPayload {
  return {
    search_id: searchId,
    user_id: userId,
    source: merged.sources.includes("both") ? "merged" : "linkedin",

    // Datos de persona
    full_name: merged.fullName,
    first_name: merged.firstName ?? undefined,
    last_name: merged.lastName ?? undefined,
    job_title: merged.jobTitle ?? undefined,
    linkedin_url: merged.linkedinUrl,
    linkedin_profile_id: merged.linkedinId ?? undefined,

    // Datos de empresa
    company_name: merged.companyName,
    company_website: merged.companyWebsite ?? undefined,
    company_industry: merged.companyIndustry ?? undefined,
    company_phone: merged.companyPhone ?? undefined,
    company_address: merged.companyAddress ?? undefined,
    company_rating: merged.companyRating ?? undefined,
    google_place_id: merged.googlePlaceId ?? undefined,

    // Ubicación
    city: merged.city ?? undefined,
    region: merged.region ?? undefined,
    country: merged.country ?? undefined,

    // Raw data
    raw_data: {
      merged: {
        headline: merged.headline,
        networkDistance: merged.networkDistance,
        profilePictureUrl: merged.profilePictureUrl,
        matchConfidence: merged.matchConfidence,
      },
      scored: scored
        ? {
            score: scored.score,
            explanation: scored.explanation,
            confidence: scored.confidence,
          }
        : null,
    },
  };
}

// --- Función principal ---

/**
 * Ejecuta el flujo completo de búsqueda:
 * 1. Buscar en Google Places + LinkedIn
 * 2. Merge y deduplicar
 * 3. Scorear con IA
 * 4. Guardar en Supabase
 */
export async function executeFullSearch(
  options: ExecuteSearchOptions
): Promise<ExecuteSearchResult> {
  const { searchId, userId, parsedParams, skipScoring = false } = options;
  const supabase = createClient();
  const errors: string[] = [];

  const startTime = Date.now();
  let searchDurationMs = 0;
  let scoringDurationMs = 0;

  try {
    // --- Paso 1: Actualizar status a 'searching' ---
    await supabase
      .from("searches")
      .update({ status: "searching" })
      .eq("id", searchId);

    // --- Paso 2: Ejecutar búsqueda ---
    console.log(`[SearchExecutor] Iniciando búsqueda #${searchId}`);
    const searchStart = Date.now();

    const searchResult = await executeSearch({
      params: parsedParams,
      maxGoogleResults: 20,
      maxLinkedInPerCompany: 5,
      maxTotalLeads: 200,
    });

    searchDurationMs = Date.now() - searchStart;
    console.log(
      `[SearchExecutor] Búsqueda completada: ${searchResult.leads.length} leads en ${searchDurationMs}ms`
    );

    if (searchResult.errors.length > 0) {
      errors.push(...searchResult.errors);
    }

    if (searchResult.leads.length === 0) {
      // No hay leads, marcar como completada
      await supabase
        .from("searches")
        .update({
          status: "completed",
          total_leads: 0,
          completed_at: new Date().toISOString(),
          error_message: errors.length > 0 ? errors.join("; ") : null,
        })
        .eq("id", searchId);

      return {
        success: true,
        leadsCreated: 0,
        stats: {
          searchDurationMs,
          scoringDurationMs: 0,
          totalLeadsFound: 0,
          leadsAboveThreshold: 0,
          avgScore: 0,
        },
        errors,
      };
    }

    // --- Paso 3: Scoring ---
    let scoredLeads: readonly ScoredLead[] = [];
    let avgScore = 0;
    let leadsAboveThreshold = 0;

    if (!skipScoring) {
      await supabase
        .from("searches")
        .update({ status: "scoring" })
        .eq("id", searchId);

      console.log(`[SearchExecutor] Iniciando scoring de ${searchResult.leads.length} leads`);
      const scoringStart = Date.now();

      const scoringResult = await scoreLeads(
        searchResult.leads,
        parsedParams,
        { batchSize: 10 }
      );

      scoringDurationMs = Date.now() - scoringStart;
      console.log(
        `[SearchExecutor] Scoring completado en ${scoringDurationMs}ms. ` +
          `Avg score: ${scoringResult.stats.avgScore}, Above threshold: ${scoringResult.stats.leadsAboveThreshold}`
      );

      scoredLeads = scoringResult.scoredLeads;
      avgScore = scoringResult.stats.avgScore;
      leadsAboveThreshold = scoringResult.stats.leadsAboveThreshold;

      if (scoringResult.errors.length > 0) {
        errors.push(...scoringResult.errors);
      }
    }

    // Crear mapa de scores por ID
    const scoreMap = new Map(scoredLeads.map((s) => [s.id, s]));

    // --- Paso 4: Guardar leads en DB ---
    const leadsToInsert = searchResult.leads.map((merged) => {
      const scored = scoreMap.get(merged.id);
      return toCreateLeadPayload(merged, scored, searchId, userId);
    });

    // Insertar con scores
    const leadsWithScores = leadsToInsert.map((lead, index) => {
      const merged = searchResult.leads[index];
      if (!merged) return lead;

      const scored = scoreMap.get(merged.id);
      return {
        ...lead,
        relevance_score: scored?.score ?? null,
        score_explanation: scored?.explanation ?? null,
        score_confidence: scored?.confidence ?? null,
      };
    });

    const { error: insertError, count } = await supabase
      .from("leads")
      .insert(leadsWithScores);

    if (insertError) {
      console.error("[SearchExecutor] Error al insertar leads:", insertError);
      errors.push(`Error al guardar leads: ${insertError.message}`);
    }

    // --- Paso 5: Marcar como completada ---
    await supabase
      .from("searches")
      .update({
        status: "completed",
        total_leads: leadsWithScores.length,
        completed_at: new Date().toISOString(),
        error_message: errors.length > 0 ? errors.join("; ") : null,
      })
      .eq("id", searchId);

    return {
      success: true,
      leadsCreated: count ?? leadsWithScores.length,
      stats: {
        searchDurationMs,
        scoringDurationMs,
        totalLeadsFound: searchResult.leads.length,
        leadsAboveThreshold,
        avgScore,
      },
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("[SearchExecutor] Error fatal:", error);

    // Marcar búsqueda como fallida
    await supabase
      .from("searches")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", searchId);

    return {
      success: false,
      leadsCreated: 0,
      stats: {
        searchDurationMs: Date.now() - startTime,
        scoringDurationMs: 0,
        totalLeadsFound: 0,
        leadsAboveThreshold: 0,
        avgScore: 0,
      },
      errors: [...errors, message],
    };
  }
}
