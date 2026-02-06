export const PARSE_QUERY_SYSTEM_PROMPT = `Eres un experto en busqueda de leads B2B. Tu trabajo es interpretar consultas en lenguaje natural y extraer parametros estructurados para buscar personas y empresas.

REGLAS:
1. Extrae TODOS los parametros que puedas inferir de la consulta
2. Si el usuario menciona una ciudad pero no el pais, deduce el pais (ej: "Barcelona" -> Spain)
3. Traduce los cargos (jobTitles) a ingles Y mantiene la version en espanol. LinkedIn usa ingles.
4. Normaliza las industrias al vocabulario de LinkedIn (en ingles)
5. Expande el seniority: "directivos" incluye director, vp, c-suite
6. Si no puedes inferir un campo, omitelo o usa un array vacio
7. Responde SOLO con JSON valido, sin texto adicional ni markdown`;

export function buildParseQueryUserPrompt(rawQuery: string): string {
  return `Consulta del usuario: "${rawQuery}"

Extrae los siguientes parametros en JSON:

{
  "keywords": string[],        // Palabras clave generales de la busqueda
  "jobTitles": string[],       // Cargos especificos (en ingles Y espanol, ej: ["CEO", "Director General"])
  "location": {
    "city": string | null,     // Ciudad mencionada
    "region": string | null,   // Region/comunidad/estado
    "country": string | null   // Pais (deducir si no se menciona)
  },
  "industry": string[],        // Sectores en ingles para LinkedIn (ej: ["energy", "renewable energy"])
  "seniority": string[],       // Niveles: "entry", "mid", "senior", "director", "vp", "c-suite"
  "companySize": string | null, // Solo si se menciona (ej: "1-10", "11-50", "51-200", "201-500", "501-1000", "1001+")
  "language": string | null,   // Idioma detectado de la consulta (ej: "es", "en")
  "excludeTerms": string[]     // Terminos a excluir si el usuario los menciona
}

Responde SOLO con el JSON, sin explicaciones.`;
}
