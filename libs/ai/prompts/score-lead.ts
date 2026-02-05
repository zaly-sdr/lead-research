import type { ParsedSearchParams } from "@/types/search";
import type { MergedLead } from "@/libs/services/lead-merger-types";

// Prompt del sistema para scoring de leads en batch
export const SCORE_LEADS_SYSTEM_PROMPT = `Eres un analista de leads B2B. Tu trabajo es evaluar la relevancia de multiples leads respecto a los criterios de busqueda del usuario.

FACTORES DE SCORING (pesos):
- Cargo (30%): Coincidencia del job_title con los cargos buscados (jobTitles)
- Ubicacion (25%): Match de city/region/country con la ubicacion buscada
- Industria (30%): Coincidencia de company_industry con la industria buscada
- Seniority (15%): Nivel del cargo apropiado para la busqueda

REGLAS:
1. Si falta un dato (ej: no hay seniority), asigna 50% de los puntos de ese factor
2. Si hay contenido web disponible, usalo para verificar industria real
3. Sin contenido web, basa el score en datos del perfil y reduce confidence a "medium"
4. La explicacion debe ser concisa (max 10 palabras)
5. El score debe ser un numero entero de 0 a 100
6. Responde SOLO con JSON valido, sin texto adicional ni markdown`;

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

Evalua TODOS los leads y responde con este JSON:

{
  "scores": [
    {
      "id": "uuid del lead",
      "score": 0-100,
      "explanation": "frase corta (max 10 palabras)",
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
