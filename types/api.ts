// Formato estandar de respuesta API

export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly meta?: ApiMeta;
}

export interface ApiMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly has_more: boolean;
}

// Parametros de paginacion para queries
export interface PaginationParams {
  readonly page?: number;
  readonly limit?: number;
  readonly cursor?: number;
}

// Parametros de ordenamiento
export interface SortParams {
  readonly sort_by?: string;
  readonly sort_order?: "asc" | "desc";
}
