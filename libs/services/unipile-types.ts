// Tipos para la API de Unipile (LinkedIn Sales Navigator)
// Endpoint: POST https://{DSN}/api/v1/linkedin/search?account_id={ID}
// Docs: https://developer.unipile.com/reference/linkedincontroller_search

// --- Search Parameters Discovery ---

export interface UnipileSearchParameterRequest {
  readonly type:
    | "COMPANY"
    | "REGION"
    | "SALES_INDUSTRY"
    | "LOCATION"
    | "INDUSTRY"
    | "SKILL"
    | "JOB_TITLE"
    | "DEPARTMENT";
  readonly keywords: string;
  readonly limit?: number;
}

export interface UnipileSearchParameter {
  readonly id: string | number;
  readonly title: string;
  readonly object?: string;
  readonly picture_url?: string;
}

export interface UnipileSearchParametersResponse {
  readonly items: readonly UnipileSearchParameter[];
}

// --- Sales Navigator People Search Request ---

export type UnipileSearchApi = "classic" | "sales_navigator" | "recruiter";
export type UnipileSearchCategory = "people" | "companies" | "jobs" | "posts";

// Filtros include/exclude usados por Sales Navigator
export interface UnipileIncludeExcludeFilter {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

// Valores validos para seniority en Sales Navigator
export type UnipileSalesNavSeniority =
  | "owner/partner"
  | "cxo"
  | "vice_president"
  | "director"
  | "experienced_manager"
  | "entry_level_manager"
  | "strategic"
  | "senior"
  | "entry_level"
  | "in_training";

export interface UnipileSalesNavPeopleRequest {
  readonly api: "sales_navigator";
  readonly category: "people";
  readonly keywords?: string;
  readonly company?: UnipileIncludeExcludeFilter;
  readonly past_company?: UnipileIncludeExcludeFilter;
  readonly role?: UnipileIncludeExcludeFilter;
  readonly seniority?: {
    readonly include?: readonly UnipileSalesNavSeniority[];
    readonly exclude?: readonly UnipileSalesNavSeniority[];
  };
  readonly location?: UnipileIncludeExcludeFilter;
  readonly industry?: UnipileIncludeExcludeFilter;
  readonly function?: UnipileIncludeExcludeFilter;
  readonly company_headcount?: readonly {
    readonly min?: number;
    readonly max?: number;
  }[];
  readonly company_type?: readonly string[];
  readonly tenure?: readonly {
    readonly min?: number;
    readonly max?: number;
  }[];
  readonly network_distance?: readonly (number | "GROUP")[];
  readonly profile_language?: readonly string[];
  readonly first_name?: string;
  readonly last_name?: string;
  readonly cursor?: string;
}

// Paginacion con cursor (no necesita api/category)
export interface UnipileCursorRequest {
  readonly cursor: string;
}

// Union de tipos de request
export type UnipileSearchRequest =
  | UnipileSalesNavPeopleRequest
  | UnipileCursorRequest
  | {
      readonly api: UnipileSearchApi;
      readonly category: UnipileSearchCategory;
      readonly keywords?: string;
      readonly url?: string;
      readonly cursor?: string;
      readonly [key: string]: unknown;
    };

// --- Search Response ---

export type UnipileNetworkDistance =
  | "DISTANCE_1"
  | "DISTANCE_2"
  | "DISTANCE_3"
  | "OUT_OF_NETWORK";

export interface UnipilePersonPosition {
  readonly company_name?: string;
  readonly company_id?: string | number;
  readonly title?: string;
  readonly tenure_at_company?: string;
  readonly tenure_at_role?: string;
  readonly is_current?: boolean;
}

export interface UnipilePersonResult {
  readonly type: "PEOPLE";
  readonly id: string;
  readonly name: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly headline?: string;
  readonly location?: string;
  readonly profile_url?: string;
  readonly public_profile_url?: string;
  readonly member_urn?: string;
  readonly network_distance?: UnipileNetworkDistance;
  readonly current_positions?: readonly UnipilePersonPosition[];
  readonly profile_picture_url?: string;
  readonly pending_invitation?: boolean;
  readonly premium?: boolean;
  readonly open_profile?: boolean;
  // Campo company directo (puede venir de la API)
  readonly company?: string;
  readonly company_id?: string | number;
}

export interface UnipileCompanyResult {
  readonly type: "COMPANIES";
  readonly id: string;
  readonly name: string;
  readonly profile_url?: string;
  readonly summary?: string;
  readonly industry?: string;
  readonly location?: string;
  readonly followers_count?: number;
  readonly job_offers_count?: number;
}

export interface UnipilePaging {
  readonly start: number;
  readonly page_count: number;
  readonly total_count: number;
}

export interface UnipileSearchResponse {
  readonly items: readonly (UnipilePersonResult | UnipileCompanyResult)[];
  readonly paging: UnipilePaging;
  readonly cursor?: string;
}

// --- Resultado normalizado ---

export interface UnipileNormalizedPerson {
  readonly linkedinId: string;
  readonly fullName: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly headline: string | null;
  readonly jobTitle: string | null;
  readonly companyName: string | null;
  readonly companyId: string | null;
  readonly location: string | null;
  readonly profileUrl: string | null;
  readonly networkDistance: UnipileNetworkDistance | null;
  readonly profilePictureUrl: string | null;
}

// --- Profile Response (GET /api/v1/users/{identifier}) ---
// Docs: https://developer.unipile.com/reference/userscontroller_getprofilebyidentifier

export interface UnipileProfileExperience {
  readonly object?: string;
  readonly id?: string;
  readonly company_id?: string;
  readonly company_name?: string;
  readonly company_linkedin_url?: string;
  readonly company_logo_url?: string;
  readonly title?: string;
  readonly description?: string;
  readonly location?: string;
  readonly start_date?: string;
  readonly end_date?: string;
  readonly is_current?: boolean;
}

export interface UnipileProfileEducation {
  readonly object?: string;
  readonly school_id?: string;
  readonly school_name?: string;
  readonly school_linkedin_url?: string;
  readonly degree?: string;
  readonly field_of_study?: string;
  readonly start_date?: string;
  readonly end_date?: string;
}

export interface UnipileProfileResponse {
  readonly object?: string;
  readonly id: string;
  readonly account_id?: string;
  readonly provider?: string;
  readonly provider_id?: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly name?: string;
  readonly headline?: string;
  readonly summary?: string;
  readonly location?: string;
  readonly profile_url?: string;
  readonly public_profile_url?: string;
  readonly profile_picture_url?: string;
  readonly background_picture_url?: string;
  readonly network_distance?: UnipileNetworkDistance;
  readonly connections_count?: number;
  readonly followers_count?: number;
  readonly is_premium?: boolean;
  readonly is_open_to_work?: boolean;
  readonly is_hiring?: boolean;
  // Experiencia laboral - aqui viene la empresa actual
  readonly experiences?: readonly UnipileProfileExperience[];
  readonly education?: readonly UnipileProfileEducation[];
  readonly skills?: readonly string[];
  readonly languages?: readonly string[];
  readonly certifications?: readonly { name?: string; organization?: string }[];
}
