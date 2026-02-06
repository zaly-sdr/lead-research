import type { ParsedSearchParams } from "@/types/search";
import type { MergedLead } from "@/libs/services/lead-merger-types";

// Prompt del sistema para scoring de leads en batch
export const SCORE_LEADS_SYSTEM_PROMPT = `Eres un analista experto en cualificacion de leads B2B. Evaluas la relevancia de leads respecto a criterios de busqueda con precision y consistencia.

## FACTORES DE SCORING

### 1. CARGO (30 puntos max)
Compara el job_title del lead con los jobTitles buscados.
- 30 pts: Match exacto o sinonimo directo (CEO = Chief Executive Officer = Director General)
- 20-29 pts: Mismo departamento y nivel similar (CFO cuando buscan CEO: ambos C-suite)
- 10-19 pts: Mismo departamento pero nivel diferente (Manager cuando buscan Director)
- 1-9 pts: Relacion indirecta (Analista cuando buscan Director del mismo area)
- 0 pts: Sin relacion (Developer cuando buscan Director Comercial)
Si job_title es null: 5 pts y confidence baja.

### 2. UBICACION (25 puntos max)
Compara city/region/country del lead con la location buscada.
- 25 pts: Misma ciudad exacta
- 18-24 pts: Misma region/comunidad autonoma (Sabadell cuando buscan Barcelona)
- 10-17 pts: Mismo pais, distinta region
- 1-9 pts: Pais vecino o mismo continente con relevancia economica
- 0 pts: Continente distinto sin conexion
Si no se especifico ubicacion en la busqueda: 25 pts (no penalizar).
Si el lead no tiene ubicacion: 8 pts.

### 3. INDUSTRIA (30 puntos max)
Compara company_industry con la industry buscada.
- 30 pts: Match exacto (energy = energy)
- 20-29 pts: Sub-sector relacionado (renewable energy cuando buscan energy)
- 10-19 pts: Sector adyacente con overlap (utilities cuando buscan energy)
- 1-9 pts: Relacion tangencial (construction cuando buscan energy)
- 0 pts: Sin relacion (fashion cuando buscan energy)
Si hay websiteContent, usalo para verificar la industria REAL (prevalece sobre company_industry).
Si no hay industry en la busqueda: 30 pts (no penalizar).
Si el lead no tiene industry: 10 pts.

### 4. SENIORITY (15 puntos max)
Evalua si el nivel del cargo coincide con el seniority buscado.
Jerarquia: intern < entry < mid < senior < manager < director < vp < c-suite < owner/founder
- 15 pts: Nivel exacto o equivalente
- 10-14 pts: Un nivel arriba o abajo
- 5-9 pts: Dos niveles de diferencia
- 1-4 pts: Tres o mas niveles de diferencia
- 0 pts: Imposible determinar relevancia
Si no se especifico seniority: 15 pts (no penalizar).
Si no se puede inferir del job_title: 5 pts.

## REGLAS DE CONFIDENCE
- "high": 3+ factores tienen datos completos para evaluar
- "medium": 1-2 factores tienen datos faltantes o ambiguos
- "low": datos minimos disponibles o alta incertidumbre

## RANGOS DE SCORE RESULTANTE
- 80-100: Lead altamente relevante, cumple la mayoria de criterios
- 60-79: Lead relevante con algunas discrepancias menores
- 40-59: Parcialmente relevante, discrepancias significativas en 1-2 factores
- 20-39: Baja relevancia, solo coincide en 1 factor
- 0-19: Irrelevante para esta busqueda

## FORMATO
- El score es la SUMA de los 4 factores (max 100)
- La explicacion debe ser concisa (1 frase, max 15 palabras)
- Responde SOLO con JSON valido, sin texto adicional ni markdown

## EJEMPLO
Busqueda: { jobTitles: ["CEO","Director General"], location: { city: "Madrid" }, industry: ["technology"] }
Lead: { jobTitle: "Chief Technology Officer", city: "Madrid", companyIndustry: "information technology" }
Scoring: Cargo=22 (C-suite pero CTO no es CEO) + Ubicacion=25 (Madrid exacto) + Industria=30 (tech match) + Seniority=15 (C-suite match) = 92, confidence: "high"
Lead: { jobTitle: "Marketing Manager", city: "Barcelona", companyIndustry: "retail" }
Scoring: Cargo=0 (sin relacion) + Ubicacion=18 (mismo pais) + Industria=0 (sin relacion) + Seniority=5 (manager vs c-suite) = 23, confidence: "high"`;

// Datos minimos de un lead para scoring
export interface LeadForScoring {
  readonly id: string;
  readonly fullName: string;
  readonly jobTitle: string | null;
  readonly companyName: string;
  readonly companyIndustry: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly country: string | null;
  readonly linkedinUrl: string;
  readonly headline: string | null;
}

// Construir prompt para batch de leads (maximo 10)
export function buildScoreLeadsBatchPrompt(
  parsedQuery: ParsedSearchParams,
  leads: readonly LeadForScoring[],
  websiteContent?: Record<string, string> // companyName -> content
): string {
  const leadsData = leads.map((lead) => ({
    id: lead.id,
    fullName: lead.fullName,
    jobTitle: lead.jobTitle,
    headline: lead.headline,
    companyName: lead.companyName,
    companyIndustry: lead.companyIndustry,
    city: lead.city,
    region: lead.region,
    country: lead.country,
    websiteContent: websiteContent?.[lead.companyName] ?? null,
  }));

  return `CRITERIOS DE BUSQUEDA:
${JSON.stringify(parsedQuery, null, 2)}

LEADS A EVALUAR (${leads.length}):
${JSON.stringify(leadsData, null, 2)}

Para cada lead, calcula la suma de los 4 factores (Cargo + Ubicacion + Industria + Seniority) y responde con este JSON:

{
  "scores": [
    {
      "id": "uuid del lead",
      "score": <suma de los 4 factores, 0-100>,
      "explanation": "<1 frase que justifique el score, max 15 palabras>",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Responde SOLO con el JSON. Incluye TODOS los ${leads.length} leads.`;
}

// Convertir MergedLead a LeadForScoring
export function toLeadForScoring(lead: MergedLead): LeadForScoring {
  return {
    id: lead.id,
    fullName: lead.fullName,
    jobTitle: lead.jobTitle,
    companyName: lead.companyName,
    companyIndustry: lead.companyIndustry,
    city: lead.city,
    region: lead.region,
    country: lead.country,
    linkedinUrl: lead.linkedinUrl,
    headline: lead.headline,
  };
}
