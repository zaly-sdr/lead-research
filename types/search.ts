// Tipos relacionados con busquedas de leads

export type SearchStatus =
  | "pending"
  | "parsing"
  | "searching"
  | "scraping"
  | "scoring"
  | "enriching"
  | "completed"
  | "failed";

// Parametros estructurados extraidos por IA de la consulta del usuario
export interface ParsedSearchParams {
  readonly keywords: string[];
  readonly jobTitles: string[];
  readonly location: {
    readonly city?: string;
    readonly region?: string;
    readonly country?: string;
  };
  readonly industry: string[];
  readonly seniority: string[];
  readonly companySize?: string;
  readonly language?: string;
  readonly excludeTerms?: string[];
}

// Registro de busqueda en base de datos
export interface Search {
  readonly id: number;
  readonly user_id: string;
  readonly raw_query: string;
  readonly status: SearchStatus;
  readonly parsed_params: ParsedSearchParams | null;
  readonly total_leads: number;
  readonly credits_used: number;
  readonly error_message: string | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// Payload para crear una busqueda
export interface CreateSearchPayload {
  readonly raw_query: string;
}

// Respuesta del AI parser
export interface QueryParseResult {
  readonly parsed_params: ParsedSearchParams;
  readonly raw_response: string;
}
