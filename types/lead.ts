// Tipos relacionados con leads

export type LeadSource = "linkedin" | "google_places" | "merged" | "manual";

export type LeadConfidence = "high" | "medium" | "low";

export type EmailVerification =
  | "verified"
  | "risky"
  | "undeliverable"
  | "unknown";

// Registro de lead en base de datos
export interface Lead {
  readonly id: number;
  readonly search_id: number;
  readonly user_id: string;

  // Datos de persona (Unipile / LinkedIn)
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly full_name: string | null;
  readonly job_title: string | null;
  readonly seniority: string | null;
  readonly linkedin_url: string | null;
  readonly linkedin_profile_id: string | null;

  // Datos de empresa (Google Places + Unipile)
  readonly company_name: string | null;
  readonly company_website: string | null;
  readonly company_industry: string | null;
  readonly company_size: string | null;
  readonly company_address: string | null;
  readonly company_phone: string | null;
  readonly company_rating: number | null;
  readonly google_place_id: string | null;

  // Datos de contacto
  readonly email: string | null;
  readonly email_confidence: number | null;
  readonly email_verification: EmailVerification;
  readonly phone: string | null;

  // Ubicacion
  readonly city: string | null;
  readonly region: string | null;
  readonly country: string | null;

  // Scoring IA
  readonly relevance_score: number | null;
  readonly score_explanation: string | null;
  readonly score_confidence: LeadConfidence | null;
  readonly company_insights: string | null;

  // Datos de web scraping
  readonly website_summary: string | null;

  // Metadata
  readonly source: LeadSource;
  readonly raw_data: Record<string, unknown> | null;
  readonly is_favorite: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

// Payload para insertar un lead (campos obligatorios minimos)
export interface CreateLeadPayload {
  readonly search_id: number;
  readonly user_id: string;
  readonly source: LeadSource;
  readonly full_name?: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly job_title?: string;
  readonly company_name?: string;
  readonly company_website?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly city?: string;
  readonly region?: string;
  readonly country?: string;
  readonly linkedin_url?: string;
  readonly linkedin_profile_id?: string;
  readonly google_place_id?: string;
  readonly company_phone?: string;
  readonly company_address?: string;
  readonly company_industry?: string;
  readonly company_rating?: number;
  readonly raw_data?: Record<string, unknown>;
}

// Resultado del AI scorer
export interface LeadScoreResult {
  readonly relevance_score: number;
  readonly explanation: string;
  readonly confidence: LeadConfidence;
  readonly company_insights: string;
}

// Filtros para listar leads
export interface LeadFilters {
  readonly search_id?: number;
  readonly source?: LeadSource;
  readonly min_score?: number;
  readonly max_score?: number;
  readonly is_favorite?: boolean;
  readonly has_email?: boolean;
  readonly city?: string;
  readonly country?: string;
  readonly company_industry?: string;
}

// Formato de exportacion
export type ExportFormat = "csv" | "xlsx" | "json";
