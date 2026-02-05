import { z } from "zod";

// Schema para la consulta del usuario
export const createSearchSchema = z.object({
  raw_query: z
    .string()
    .min(3, "La consulta debe tener al menos 3 caracteres")
    .max(500, "La consulta no puede exceder 500 caracteres")
    .trim(),
});

// Transforma null a undefined para campos opcionales de la IA
const nullableString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? undefined);

const nullableStringArray = z
  .array(z.string())
  .nullable()
  .optional()
  .transform((v) => v ?? undefined);

// Schema para los parametros parseados por IA
// La IA puede devolver null en campos opcionales, por eso usamos nullable
export const parsedSearchParamsSchema = z.object({
  keywords: z.array(z.string()).default([]),
  jobTitles: z.array(z.string()).default([]),
  location: z
    .object({
      city: nullableString,
      region: nullableString,
      country: nullableString,
    })
    .default({}),
  industry: z.array(z.string()).default([]),
  seniority: z.array(z.string()).default([]),
  companySize: nullableString,
  language: nullableString,
  excludeTerms: nullableStringArray,
});

// Schema para filtrar busquedas del historial
export const searchFiltersSchema = z.object({
  status: z
    .enum([
      "pending",
      "parsing",
      "searching",
      "scraping",
      "scoring",
      "enriching",
      "completed",
      "failed",
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSearchInput = z.infer<typeof createSearchSchema>;
export type ParsedSearchParamsInput = z.infer<typeof parsedSearchParamsSchema>;
export type SearchFiltersInput = z.infer<typeof searchFiltersSchema>;
