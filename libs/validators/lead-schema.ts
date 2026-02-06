import { z } from "zod";

// Schema para filtrar leads
export const leadFiltersSchema = z.object({
  search_id: z.coerce.number().int().positive().optional(),
  source: z.enum(["linkedin", "google_places", "merged", "manual"]).optional(),
  min_score: z.coerce.number().int().min(0).max(100).optional(),
  max_score: z.coerce.number().int().min(0).max(100).optional(),
  is_favorite: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  has_email: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  company_industry: z.string().optional(),
  sort_by: z
    .enum([
      "relevance_score",
      "created_at",
      "company_name",
      "full_name",
    ])
    .default("relevance_score"),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Schema para actualizar un lead
export const updateLeadSchema = z.object({
  is_favorite: z.boolean().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  job_title: z.string().optional(),
  company_name: z.string().optional(),
});

// Schema para scoring de IA
export const leadScoreSchema = z.object({
  relevance_score: z.number().int().min(0).max(100),
  explanation: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  company_insights: z.string(),
});

// Schema para exportar leads
export const exportLeadsSchema = z.object({
  search_id: z.number().int().positive().optional(),
  lead_ids: z.array(z.number().int().positive()).optional(),
  format: z.enum(["csv", "xlsx", "json"]).default("csv"),
  fields: z
    .array(z.string())
    .optional(),
});

// Schema para agregar leads a una lista
export const addToListSchema = z.object({
  lead_ids: z.array(z.number().int().positive()).min(1, "Selecciona al menos un lead"),
});

// Schema para crear una lista
export const createListSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre es requerido")
    .max(100, "El nombre no puede exceder 100 caracteres")
    .trim(),
  description: z.string().max(500).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal invalido")
    .optional(),
});

// Schema para actualizar una lista
export const updateListSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .trim()
    .optional(),
  description: z.string().max(500).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export type LeadFiltersInput = z.infer<typeof leadFiltersSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type LeadScoreInput = z.infer<typeof leadScoreSchema>;
export type ExportLeadsInput = z.infer<typeof exportLeadsSchema>;
export type AddToListInput = z.infer<typeof addToListSchema>;
export type CreateListInput = z.infer<typeof createListSchema>;
export type UpdateListInput = z.infer<typeof updateListSchema>;
