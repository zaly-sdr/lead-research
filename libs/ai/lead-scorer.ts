// Lead Scorer - Servicio para puntuar leads con IA
// Usa batch processing (10 leads por request) para optimizar costos

import { z } from "zod";
import { aiCompletion } from "./provider";
import {
  SCORE_LEADS_SYSTEM_PROMPT,
  buildScoreLeadsBatchPrompt,
  toLeadForScoring,
  type LeadForScoring,
} from "./prompts/score-lead";
import type { MergedLead } from "@/libs/services/lead-merger-types";
import type { ParsedSearchParams } from "@/types/search";
import type { LeadConfidence } from "@/types/lead";

// --- Configuracion ---

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_TOKENS = 2048;

// --- Tipos ---

export interface ScoringOptions {
  readonly batchSize?: number;
  readonly includeWebContent?: boolean;
  readonly webContent?: Record<string, string>; // companyName -> content
}

export interface ScoredLead {
  readonly id: string;
  readonly score: number;
  readonly explanation: string;
  readonly confidence: LeadConfidence;
}

export interface ScoringResult {
  readonly success: boolean;
  readonly scoredLeads: readonly ScoredLead[];
  readonly stats: {
    readonly totalLeads: number;
    readonly scoredLeads: number;
    readonly failedLeads: number;
    readonly batchesProcessed: number;
    readonly avgScore: number;
    readonly leadsAboveThreshold: number; // score >= 60
  };
  readonly errors: readonly string[];
}

// --- Schemas Zod ---

const scoredLeadSchema = z.object({
  id: z.string(),
  score: z.number().int().min(0).max(100),
  explanation: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

const batchResponseSchema = z.object({
  scores: z.array(scoredLeadSchema),
});

// --- Funciones auxiliares ---

// Divide array en chunks de tamano especificado
function chunk<T>(array: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size) as T[]);
  }
  return result;
}

// Extraer JSON de una respuesta que puede tener texto extra
function extractJson(text: string): string {
  // Intentar encontrar un objeto JSON en el texto
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  return text;
}

// --- Funcion principal ---

/**
 * Puntua un array de leads usando IA.
 * Procesa en batches de 10 para optimizar costos y velocidad.
 */
export async function scoreLeads(
  leads: readonly MergedLead[],
  parsedQuery: ParsedSearchParams,
  options: ScoringOptions = {}
): Promise<ScoringResult> {
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    includeWebContent = false,
    webContent = {},
  } = options;

  if (leads.length === 0) {
    return {
      success: true,
      scoredLeads: [],
      stats: {
        totalLeads: 0,
        scoredLeads: 0,
        failedLeads: 0,
        batchesProcessed: 0,
        avgScore: 0,
        leadsAboveThreshold: 0,
      },
      errors: [],
    };
  }

  const errors: string[] = [];
  const allScoredLeads: ScoredLead[] = [];

  // Convertir a formato de scoring
  const leadsForScoring = leads.map(toLeadForScoring);

  // Dividir en batches
  const batches = chunk(leadsForScoring, batchSize);
  console.log(
    `[LeadScorer] Procesando ${leads.length} leads en ${batches.length} batches`
  );

  // Procesar cada batch
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (!batch) continue;

    console.log(
      `[LeadScorer] Batch ${i + 1}/${batches.length}: ${batch.length} leads`
    );

    try {
      const scoredBatch = await scoreBatch(
        batch,
        parsedQuery,
        includeWebContent ? webContent : undefined
      );
      allScoredLeads.push(...scoredBatch);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      errors.push(`Batch ${i + 1}: ${message}`);
      console.error(`[LeadScorer] Error en batch ${i + 1}:`, error);

      // Agregar leads con score null para los que fallaron
      for (const lead of batch) {
        allScoredLeads.push({
          id: lead.id,
          score: 0,
          explanation: "Error al procesar",
          confidence: "low",
        });
      }
    }
  }

  // Calcular estadisticas
  const validScores = allScoredLeads.filter((l) => l.score > 0);
  const avgScore =
    validScores.length > 0
      ? Math.round(
          validScores.reduce((sum, l) => sum + l.score, 0) / validScores.length
        )
      : 0;

  return {
    success: errors.length === 0,
    scoredLeads: allScoredLeads,
    stats: {
      totalLeads: leads.length,
      scoredLeads: validScores.length,
      failedLeads: leads.length - validScores.length,
      batchesProcessed: batches.length,
      avgScore,
      leadsAboveThreshold: allScoredLeads.filter((l) => l.score >= 60).length,
    },
    errors,
  };
}

// Procesar un batch de leads
async function scoreBatch(
  leads: readonly LeadForScoring[],
  parsedQuery: ParsedSearchParams,
  webContent?: Record<string, string>
): Promise<ScoredLead[]> {
  const userPrompt = buildScoreLeadsBatchPrompt(parsedQuery, leads, webContent);

  const response = await aiCompletion({
    systemPrompt: SCORE_LEADS_SYSTEM_PROMPT,
    userPrompt,
    maxTokens: DEFAULT_MAX_TOKENS,
    temperature: 0,
  });

  // Parsear respuesta JSON
  const jsonText = extractJson(response.content);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    console.error("[LeadScorer] JSON invalido:", response.content);
    throw new Error("La IA devolvio JSON invalido");
  }

  // Validar con Zod
  const validated = batchResponseSchema.safeParse(parsed);
  if (!validated.success) {
    console.error("[LeadScorer] Validacion fallida:", validated.error);
    throw new Error(`Respuesta invalida: ${validated.error.message}`);
  }

  // Mapear a ScoredLead
  return validated.data.scores.map((s) => ({
    id: s.id,
    score: s.score,
    explanation: s.explanation,
    confidence: s.confidence as LeadConfidence,
  }));
}

// --- Utilidad: filtrar leads por threshold ---

/**
 * Filtra leads que estan por encima del threshold de calidad.
 */
export function filterByThreshold(
  scoredLeads: readonly ScoredLead[],
  threshold: number = 60
): readonly ScoredLead[] {
  return scoredLeads.filter((lead) => lead.score >= threshold);
}

/**
 * Ordena leads por score descendente.
 */
export function sortByScore(
  scoredLeads: readonly ScoredLead[]
): readonly ScoredLead[] {
  return [...scoredLeads].sort((a, b) => b.score - a.score);
}
