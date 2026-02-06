import { withRetry } from "@/libs/utils/retry";
import {
  checkRateLimit,
  recordRequest,
  getRateLimitStats as getRateLimitStatsUtil,
  getUnipileServiceId,
  getUnipileRateLimitConfig,
} from "@/libs/utils/rate-limiter";
import type { ParsedSearchParamsInput } from "@/libs/validators/search-schema";
import type { CreateLeadPayload } from "@/types/lead";
import type {
  UnipileSalesNavPeopleRequest,
  UnipileSearchRequest,
  UnipileSearchResponse,
  UnipilePersonResult,
  UnipileNormalizedPerson,
  UnipileSearchParameter,
  UnipileSearchParametersResponse,
  UnipileSalesNavSeniority,
} from "./unipile-types";

// --- Configuracion ---

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PAGES = 10; // Mas paginas para traer mas resultados (50-200 leads)

// Service ID dinamico basado en UNIPILE_RATE_LIMIT_MODE (test/dev/production)
function getRateLimitServiceId(): string {
  return getUnipileServiceId();
}

// --- Credenciales ---

interface UnipileConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly accountId: string;
}

function getConfig(): UnipileConfig {
  const apiKey = process.env.UNIPILE_API_KEY;
  const baseUrl = process.env.UNIPILE_BASE_URL;
  const accountId = process.env.UNIPILE_ACCOUNT_ID;

  if (!apiKey) {
    throw new Error("UNIPILE_API_KEY no esta configurada");
  }
  if (!baseUrl) {
    throw new Error("UNIPILE_BASE_URL no esta configurada");
  }
  if (!accountId) {
    throw new Error("UNIPILE_ACCOUNT_ID no esta configurada");
  }

  return { apiKey, baseUrl, accountId };
}

function buildUrl(path: string, params?: Record<string, string>): string {
  const { baseUrl, accountId } = getConfig();
  const url = new URL(`https://${baseUrl}${path}`);
  url.searchParams.set("account_id", accountId);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

// --- Error personalizado ---

export class UnipileError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "UnipileError";
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, UnipileError.prototype);
  }
}

export class RateLimitError extends Error {
  readonly waitMs: number;
  readonly stats: {
    hourlyRemaining: number;
    dailyRemaining: number;
    nextResetIn: number;
  };

  constructor(
    message: string,
    waitMs: number,
    stats: { hourlyRemaining: number; dailyRemaining: number; nextResetIn: number }
  ) {
    super(message);
    this.name = "RateLimitError";
    this.waitMs = waitMs;
    this.stats = stats;
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof UnipileError) {
    return error.statusCode === 429 || error.statusCode >= 500;
  }
  return false;
}

// --- Helpers de request ---

function getHeaders(): Record<string, string> {
  const { apiKey } = getConfig();
  return {
    "Content-Type": "application/json",
    "X-API-KEY": apiKey,
  };
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- Busqueda de parametros (IDs de empresas, ubicaciones, etc.) ---

/**
 * Busca IDs de parametros de LinkedIn (empresas, ubicaciones, industrias).
 * LinkedIn no acepta texto plano en algunos filtros, necesita IDs.
 *
 * Ejemplo: searchParameters("COMPANY", "Repsol") -> [{ id: "165707", title: "repsol" }]
 */
export async function searchParameters(
  type: "COMPANY" | "REGION" | "SALES_INDUSTRY" | "LOCATION" | "INDUSTRY" | "SKILL" | "JOB_TITLE" | "DEPARTMENT",
  keywords: string,
  limit: number = 10
): Promise<readonly UnipileSearchParameter[]> {
  const url = buildUrl("/api/v1/linkedin/search/parameters", {
    type,
    keywords,
    limit: String(limit),
  });

  const response = await withRetry(
    async () => {
      const res = await fetchWithTimeout(url, {
        method: "GET",
        headers: getHeaders(),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "Sin detalle");
        console.error(
          `Unipile parameters API error ${res.status}: ${errorBody}`
        );
        throw new UnipileError(
          `Unipile parameters API error: ${res.status}`,
          res.status
        );
      }

      return res;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10_000,
      shouldRetry: isRetryableError,
    }
  );

  const data =
    (await response.json()) as UnipileSearchParametersResponse;
  return data.items ?? [];
}

/**
 * Busca el ID de una empresa en LinkedIn.
 * Devuelve el ID como string (formato requerido por Sales Navigator) o null.
 */
export async function findCompanyId(
  companyName: string
): Promise<string | null> {
  const results = await searchParameters("COMPANY", companyName, 5);

  if (results.length === 0) {
    return null;
  }

  // Buscar coincidencia exacta (case insensitive)
  const normalizedQuery = companyName.toLowerCase().trim();
  const exactMatch = results.find(
    (r) => r.title.toLowerCase().trim() === normalizedQuery
  );

  const match = exactMatch ?? results[0];

  if (match === undefined) {
    return null;
  }

  return String(match.id);
}

export interface CompanyIdValidationResult {
  readonly companyId: string | null;
  readonly confidence: "high" | "medium" | "low";
}

/**
 * Busca el ID de una empresa en LinkedIn con validacion mejorada.
 *
 * Estrategias de matching:
 * 1. Match exacto por nombre normalizado → confidence HIGH
 * 2. Validacion por dominio web (si Google tiene website) → confidence HIGH
 * 3. Primer resultado de busqueda → confidence MEDIUM
 *
 * @param companyName Nombre de la empresa (de Google Places)
 * @param googleWebsite Website de la empresa (de Google Places, opcional)
 */
export async function findCompanyIdWithValidation(
  companyName: string,
  googleWebsite: string | null
): Promise<CompanyIdValidationResult> {
  // 1. Normalizar y buscar
  const normalized = normalizeCompanyName(companyName);
  const results = await searchParameters("COMPANY", normalized, 5);

  if (results.length === 0) {
    console.log(`[Unipile] No se encontro empresa para "${companyName}"`);
    return { companyId: null, confidence: "low" };
  }

  // 2. Buscar match exacto por nombre normalizado (sin llamadas extra)
  const exactMatch = results.find(
    (r) => normalizeCompanyName(r.title) === normalized
  );
  if (exactMatch) {
    console.log(`[Unipile] Match exacto para "${companyName}" → ${exactMatch.id}`);
    return { companyId: String(exactMatch.id), confidence: "high" };
  }

  // 3. Si tenemos website de Google, validar por dominio
  if (googleWebsite) {
    const googleDomain = extractDomain(googleWebsite);

    if (googleDomain) {
      // Solo verificar el primer resultado para no hacer muchas llamadas
      const firstResult = results[0];
      if (firstResult) {
        const profile = await getCompanyProfile(String(firstResult.id));

        if (profile?.website) {
          const linkedInDomain = extractDomain(profile.website);
          if (googleDomain === linkedInDomain) {
            console.log(`[Unipile] Match por dominio "${googleDomain}" para "${companyName}" → ${firstResult.id}`);
            return { companyId: String(firstResult.id), confidence: "high" };
          }
        }
      }
    }
  }

  // 4. Fallback: usar primer resultado
  const firstResult = results[0];
  if (firstResult) {
    console.log(`[Unipile] Match fuzzy para "${companyName}" → ${firstResult.id} (confidence: medium)`);
    return { companyId: String(firstResult.id), confidence: "medium" };
  }

  return { companyId: null, confidence: "low" };
}

// --- Busqueda de personas ---

/**
 * Verifica el rate limit antes de hacer una peticion.
 * Lanza RateLimitError si se ha alcanzado el limite.
 */
function enforceRateLimit(): void {
  const result = checkRateLimit(getRateLimitServiceId());

  if (!result.allowed) {
    throw new RateLimitError(
      result.reason ?? "Rate limit alcanzado",
      result.waitMs,
      result.stats
    );
  }
}

/**
 * Ejecuta una busqueda de personas en LinkedIn Sales Navigator.
 * Incluye verificacion de rate limit.
 */
async function fetchSearchPage(
  request: UnipileSearchRequest
): Promise<UnipileSearchResponse> {
  // Verificar rate limit ANTES de la peticion
  enforceRateLimit();

  const url = buildUrl("/api/v1/linkedin/search");
  const body = JSON.stringify(request);

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: getHeaders(),
    body,
  });

  // Registrar la peticion DESPUES de que se ejecuto
  recordRequest(getRateLimitServiceId());

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Sin detalle");
    console.error(`Unipile search API error ${response.status}: ${errorBody}`);
    throw new UnipileError(
      `Unipile search API error: ${response.status}`,
      response.status
    );
  }

  return (await response.json()) as UnipileSearchResponse;
}

// --- Normalizacion de resultados ---

function isPersonResult(
  item: { readonly type: string }
): item is UnipilePersonResult {
  return item.type === "PEOPLE";
}

/**
 * Extrae el cargo actual de las posiciones del perfil.
 */
function extractCurrentTitle(
  positions: readonly { readonly title?: string; readonly is_current?: boolean }[] | undefined
): string | null {
  if (!positions || positions.length === 0) {
    return null;
  }
  const current = positions.find((p) => p.is_current === true);
  return current?.title ?? positions[0]?.title ?? null;
}

/**
 * Extrae el nombre de la empresa actual de las posiciones del perfil.
 */
function extractCurrentCompany(
  positions: readonly { readonly company_name?: string; readonly is_current?: boolean }[] | undefined
): string | null {
  if (!positions || positions.length === 0) {
    return null;
  }
  const current = positions.find((p) => p.is_current === true);
  return current?.company_name ?? positions[0]?.company_name ?? null;
}

// --- Funciones de normalizacion para matching ---

/**
 * Normaliza un nombre de empresa para comparaciones.
 * Elimina sufijos legales comunes (S.A., S.L., Inc, Ltd, etc.)
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(s\.?a\.?u?|s\.?l\.?u?|inc\.?|ltd\.?|corp\.?|corporation|gmbh|ag|bv|nv|plc|group|holding|holdings|international|intl|espana|spain|europe|global|worldwide)\b/gi,
      ""
    )
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrae el dominio de una URL.
 * "https://www.repsol.com/es" → "repsol.com"
 */
function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// --- Perfil de empresa de LinkedIn ---

interface LinkedInCompanyProfile {
  readonly id?: string;
  readonly name?: string;
  readonly website?: string;
  readonly industry?: string;
  readonly company_size?: string;
}

/**
 * Obtiene el perfil de una empresa de LinkedIn por su ID.
 * Util para validar el website de la empresa.
 */
async function getCompanyProfile(
  companyId: string
): Promise<LinkedInCompanyProfile | null> {
  const url = buildUrl(`/api/v1/linkedin/company/${companyId}`);

  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: getHeaders(),
    });

    if (!response.ok) {
      console.warn(`[Unipile] No se pudo obtener perfil de empresa ${companyId}: ${response.status}`);
      return null;
    }

    return (await response.json()) as LinkedInCompanyProfile;
  } catch (error) {
    console.warn(`[Unipile] Error obteniendo perfil de empresa ${companyId}:`, error);
    return null;
  }
}

/**
 * Extrae el ID de la empresa actual.
 */
function extractCurrentCompanyId(
  positions: readonly { readonly company_id?: string | number; readonly is_current?: boolean }[] | undefined
): string | null {
  if (!positions || positions.length === 0) {
    return null;
  }
  const current = positions.find((p) => p.is_current === true);
  const id = current?.company_id ?? positions[0]?.company_id;
  return id != null ? String(id) : null;
}

function normalizePerson(person: UnipilePersonResult): UnipileNormalizedPerson {
  // Prioridad para empresa: 1) campo company directo, 2) current_positions
  // NO usamos headline fallback porque extrae valores incorrectos
  const companyDirect = person.company ?? null;
  const companyFromPositions = extractCurrentCompany(person.current_positions);
  const companyName = companyDirect ?? companyFromPositions;

  // Prioridad para company_id: 1) campo company_id directo, 2) current_positions
  const companyIdDirect = person.company_id != null ? String(person.company_id) : null;
  const companyIdFromPositions = extractCurrentCompanyId(person.current_positions);
  const companyId = companyIdDirect ?? companyIdFromPositions;

  const jobTitle = extractCurrentTitle(person.current_positions);

  // Debug: ver que datos tiene cada persona
  console.log(`[Unipile Person] ${person.name}: company="${companyName ?? 'null'}" (direct: ${companyDirect ?? 'null'}, pos: ${companyFromPositions ?? 'null'})`);

  return {
    linkedinId: person.id,
    fullName: person.name,
    firstName: person.first_name ?? null,
    lastName: person.last_name ?? null,
    headline: person.headline ?? null,
    jobTitle,
    companyName,
    companyId,
    location: person.location ?? null,
    profileUrl: person.profile_url ?? person.public_profile_url ?? null,
    networkDistance: person.network_distance ?? null,
    profilePictureUrl: person.profile_picture_url ?? null,
  };
}

// --- Construccion de filtros desde ParsedSearchParamsInput ---

// Mapa de seniority del AI parser a valores de Sales Navigator
const SENIORITY_MAP: Record<string, UnipileSalesNavSeniority> = {
  "c-suite": "cxo",
  "csuite": "cxo",
  "cxo": "cxo",
  "ceo": "cxo",
  "cto": "cxo",
  "cfo": "cxo",
  "coo": "cxo",
  "owner": "owner/partner",
  "partner": "owner/partner",
  "vp": "vice_president",
  "vice president": "vice_president",
  "vice_president": "vice_president",
  "director": "director",
  "manager": "experienced_manager",
  "senior": "senior",
  "mid": "senior",
  "entry": "entry_level",
  "junior": "entry_level",
};

/**
 * Convierte los niveles de seniority del parser a valores de Sales Navigator.
 */
function buildSeniorityFilter(
  params: ParsedSearchParamsInput
): UnipileSalesNavPeopleRequest["seniority"] {
  if (params.seniority.length === 0) {
    return undefined;
  }

  const mapped = params.seniority
    .map((s) => SENIORITY_MAP[s.toLowerCase()])
    .filter((v): v is UnipileSalesNavSeniority => v !== undefined);

  // Deduplicar
  const unique = [...new Set(mapped)];

  if (unique.length === 0) {
    return undefined;
  }

  return { include: unique };
}

/**
 * Construye los filtros de rol/cargo como include/exclude.
 * Sales Navigator acepta texto plano en el campo role.include.
 */
function buildRoleFilter(
  params: ParsedSearchParamsInput
): UnipileSalesNavPeopleRequest["role"] {
  if (params.jobTitles.length === 0) {
    return undefined;
  }
  return { include: params.jobTitles };
}

/**
 * Construye las keywords de busqueda combinando keywords + industry.
 */
function buildSearchKeywords(params: ParsedSearchParamsInput): string {
  const parts: string[] = [];

  if (params.keywords.length > 0) {
    parts.push(params.keywords.join(" "));
  }
  if (params.industry.length > 0) {
    parts.push(params.industry.join(" "));
  }

  return parts.join(" ") || "";
}

/**
 * Resuelve IDs de ubicacion de LinkedIn para el filtro location.
 * Busca por pais, region y ciudad en ese orden y devuelve los IDs encontrados.
 */
async function resolveLocationIds(
  params: ParsedSearchParamsInput
): Promise<readonly string[]> {
  const locationIds: string[] = [];
  const { location } = params;

  // Prioridad: pais > region > ciudad
  // LinkedIn suele usar el pais como filtro principal
  const locationTerms: string[] = [];

  if (location.country) {
    locationTerms.push(location.country);
  }
  if (location.region) {
    locationTerms.push(location.region);
  }
  if (location.city) {
    locationTerms.push(location.city);
  }

  // Buscar IDs para cada termino de ubicacion
  for (const term of locationTerms) {
    try {
      const results = await searchParameters("LOCATION", term, 3);
      if (results.length > 0 && results[0]) {
        locationIds.push(String(results[0].id));
        console.log(`[Unipile] Location "${term}" → ID: ${results[0].id}`);
      }
    } catch (error) {
      console.warn(`[Unipile] Error buscando location "${term}":`, error);
    }
  }

  return locationIds;
}

/**
 * Parsea el string de companySize a rangos min/max para company_headcount.
 * Ejemplos:
 * - "20" → { min: 20, max: undefined }
 * - ">20" o "20+" → { min: 20, max: undefined }
 * - "<50" → { min: undefined, max: 50 }
 * - "20-50" → { min: 20, max: 50 }
 * - "mas de 20 empleados" → { min: 20, max: undefined }
 */
function parseCompanySize(
  companySize: string | undefined
): { min?: number; max?: number } | null {
  if (!companySize) return null;

  const cleaned = companySize.toLowerCase().trim();

  // Orden importante: patrones mas especificos primero

  // 1. "X-Y", "X a Y", "X to Y" (rangos)
  const rangeMatch = cleaned.match(/(\d+)\s*(?:-|a|to)\s*(\d+)/);
  if (rangeMatch?.[1] && rangeMatch?.[2]) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    if (!isNaN(min) && !isNaN(max)) {
      return { min, max };
    }
  }

  // 2. "menos de X", "less than X", "<X" (maximo)
  const lessThanMatch = cleaned.match(/(?:menos\s+de|less\s+than|<)\s*(\d+)/);
  if (lessThanMatch?.[1]) {
    const max = parseInt(lessThanMatch[1], 10);
    if (!isNaN(max)) {
      return { max };
    }
  }

  // 3. "mas de X", "more than X", ">X" (minimo con indicador explicito)
  const moreThanMatch = cleaned.match(/(?:mas\s+de|more\s+than|>)\s*(\d+)/);
  if (moreThanMatch?.[1]) {
    const min = parseInt(moreThanMatch[1], 10);
    if (!isNaN(min)) {
      return { min };
    }
  }

  // 4. "X+" (numero con + al final)
  const plusMatch = cleaned.match(/(\d+)\s*\+/);
  if (plusMatch?.[1]) {
    const min = parseInt(plusMatch[1], 10);
    if (!isNaN(min)) {
      return { min };
    }
  }

  // 5. Numero solo (interpretado como minimo)
  const numberMatch = cleaned.match(/(\d+)/);
  if (numberMatch?.[1]) {
    const min = parseInt(numberMatch[1], 10);
    if (!isNaN(min)) {
      return { min };
    }
  }

  return null;
}

/**
 * Construye el filtro company_headcount para Sales Navigator.
 */
function buildCompanyHeadcountFilter(
  params: ParsedSearchParamsInput
): UnipileSalesNavPeopleRequest["company_headcount"] {
  const parsed = parseCompanySize(params.companySize);
  if (!parsed) {
    return undefined;
  }

  return [{ min: parsed.min, max: parsed.max }];
}

// --- Conversion a CreateLeadPayload ---

/**
 * Convierte un resultado normalizado de Unipile a un CreateLeadPayload
 * listo para insertar en la base de datos.
 */
export function personToLeadPayload(
  person: UnipileNormalizedPerson,
  searchId: number,
  userId: string
): CreateLeadPayload {
  return {
    search_id: searchId,
    user_id: userId,
    source: "linkedin",
    full_name: person.fullName,
    first_name: person.firstName ?? undefined,
    last_name: person.lastName ?? undefined,
    job_title: person.jobTitle ?? undefined,
    company_name: person.companyName ?? undefined,
    linkedin_url: person.profileUrl ?? undefined,
    linkedin_profile_id: person.linkedinId,
    city: person.location ?? undefined,
    raw_data: {
      headline: person.headline,
      networkDistance: person.networkDistance,
      companyId: person.companyId,
      profilePictureUrl: person.profilePictureUrl,
    },
  };
}

/**
 * Inyecta datos de empresa en una persona si le faltan.
 * Util cuando sabemos la empresa por contexto (busqueda por empresa).
 *
 * No modifica si la persona ya tiene companyName (respeta dato original).
 */
export function injectCompanyData(
  person: UnipileNormalizedPerson,
  companyName: string,
  companyId: string | null
): UnipileNormalizedPerson {
  // Si ya tiene companyName, no modificar
  if (person.companyName) {
    return person;
  }

  return {
    ...person,
    companyName,
    companyId: companyId ?? person.companyId,
  };
}

// --- Funcion principal: buscar personas por empresa ---

export interface UnipilePeopleSearchOptions {
  readonly companyName: string;
  readonly params: ParsedSearchParamsInput;
  readonly maxResults?: number;
}

export interface UnipilePeopleSearchResult {
  readonly people: readonly UnipileNormalizedPerson[];
  readonly totalFetched: number;
  readonly totalAvailable: number;
  readonly pagesUsed: number;
  readonly companyIdUsed: string | null;
}

/**
 * Busca personas (decision makers) en una empresa usando LinkedIn Sales Navigator.
 *
 * Flujo:
 * 1. Busca el ID de la empresa en LinkedIn
 * 2. Si encuentra la empresa, busca personas con filtro de empresa
 * 3. Si no encuentra, busca con keywords + nombre de empresa como texto
 * 4. Aplica filtros de cargo (role) y seniority
 * 5. Pagina hasta MAX_PAGES paginas
 * 6. Normaliza y devuelve resultados
 */
export async function searchPeopleByCompany(
  options: UnipilePeopleSearchOptions
): Promise<UnipilePeopleSearchResult> {
  const { companyName, params, maxResults = 25 } = options;

  // Paso 1: Buscar ID de la empresa
  const companyId = await findCompanyId(companyName);

  // Paso 2: Construir request en formato Sales Navigator
  const roleFilter = buildRoleFilter(params);
  const seniorityFilter = buildSeniorityFilter(params);
  const keywords = buildSearchKeywords(params);

  // IMPORTANTE: Cuando tenemos companyId, NO usamos keywords porque hace la busqueda
  // demasiado restrictiva. LinkedIn busca AND de todos los filtros.
  // Solo usamos keywords si NO tenemos companyId (busqueda por texto).
  const baseRequest: UnipileSalesNavPeopleRequest = {
    api: "sales_navigator",
    category: "people",
    keywords: companyId ? undefined : `${companyName} ${keywords}`.trim() || undefined,
    company: companyId ? { include: [companyId] } : undefined,
    role: roleFilter,
    seniority: seniorityFilter,
  };

  // Paso 3: Paginar resultados
  const maxPages = MAX_PAGES;
  let allPeople: readonly UnipileNormalizedPerson[] = [];
  let totalAvailable = 0;
  let pagesUsed = 0;
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const request: UnipileSearchRequest = cursor
      ? { cursor }
      : baseRequest;

    const response = await withRetry(() => fetchSearchPage(request), {
      maxAttempts: 3,
      baseDelayMs: 2000,
      maxDelayMs: 15_000,
      shouldRetry: isRetryableError,
    });

    pagesUsed++;
    totalAvailable = response.paging?.total_count ?? 0;

    if (response.items) {
      const people = response.items
        .filter(isPersonResult)
        .map(normalizePerson);
      allPeople = [...allPeople, ...people];
    }

    if (!response.cursor || allPeople.length >= maxResults) {
      break;
    }

    cursor = response.cursor;
  }

  const trimmed =
    allPeople.length > maxResults ? allPeople.slice(0, maxResults) : allPeople;

  return {
    people: trimmed,
    totalFetched: trimmed.length,
    totalAvailable,
    pagesUsed,
    companyIdUsed: companyId,
  };
}

// --- Funcion para buscar personas por company ID (mas eficiente) ---

export interface SearchByCompanyIdOptions {
  readonly companyId: string;
  readonly companyName: string;
  readonly params: ParsedSearchParamsInput;
  readonly maxResults?: number;
}

/**
 * Busca personas en una empresa usando el companyId de LinkedIn directamente.
 *
 * Ventajas sobre searchPeopleByCompany():
 * - No necesita buscar el ID de la empresa (ya lo tenemos)
 * - Inyecta companyName en personas que no lo tienen
 * - Mas eficiente cuando ya resolvimos el company ID
 */
export async function searchPeopleByCompanyId(
  options: SearchByCompanyIdOptions
): Promise<UnipilePeopleSearchResult> {
  const { companyId, companyName, params, maxResults = 25 } = options;

  const roleFilter = buildRoleFilter(params);
  const seniorityFilter = buildSeniorityFilter(params);

  // Buscar por company ID directamente, sin keywords
  const baseRequest: UnipileSalesNavPeopleRequest = {
    api: "sales_navigator",
    category: "people",
    company: { include: [companyId] },
    role: roleFilter,
    seniority: seniorityFilter,
  };

  const maxPages = MAX_PAGES;
  let allPeople: readonly UnipileNormalizedPerson[] = [];
  let totalAvailable = 0;
  let pagesUsed = 0;
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const request: UnipileSearchRequest = cursor ? { cursor } : baseRequest;

    const response = await withRetry(() => fetchSearchPage(request), {
      maxAttempts: 3,
      baseDelayMs: 2000,
      maxDelayMs: 15_000,
      shouldRetry: isRetryableError,
    });

    pagesUsed++;
    totalAvailable = response.paging?.total_count ?? 0;

    if (response.items) {
      const people = response.items.filter(isPersonResult).map(normalizePerson);
      allPeople = [...allPeople, ...people];
    }

    if (!response.cursor || allPeople.length >= maxResults) {
      break;
    }

    cursor = response.cursor;
  }

  // CLAVE: Inyectar companyName en personas que no lo tienen
  const enrichedPeople = allPeople.map((person) =>
    injectCompanyData(person, companyName, companyId)
  );

  const trimmed =
    enrichedPeople.length > maxResults
      ? enrichedPeople.slice(0, maxResults)
      : enrichedPeople;

  return {
    people: trimmed,
    totalFetched: trimmed.length,
    totalAvailable,
    pagesUsed,
    companyIdUsed: companyId,
  };
}

// --- Funcion para buscar personas directamente con keywords ---

export interface UnipileDirectSearchOptions {
  readonly params: ParsedSearchParamsInput;
  readonly maxResults?: number;
}

/**
 * Busca personas directamente usando keywords y filtros del query parseado.
 * Util cuando no se busca por empresa especifica sino por industria/cargo/ubicacion.
 *
 * ESTRATEGIA: Busqueda con filtros de ubicacion y tamano de empresa.
 * - Keywords: industria (para relevancia de sector)
 * - Location: filtro estructurado por IDs de LinkedIn (para precision geografica)
 * - Company Headcount: filtro de tamano de empresa
 * - SIN filtros de role ni seniority (demasiado restrictivos, la IA clasificara)
 */
export async function searchPeopleDirect(
  options: UnipileDirectSearchOptions
): Promise<UnipilePeopleSearchResult> {
  const { params, maxResults = 100 } = options;

  // Keywords: solo industria (la ubicacion va como filtro estructurado)
  const industryKeywords = params.industry.slice(0, 2).join(" ");
  const finalKeywords = industryKeywords || undefined;

  // Resolver IDs de ubicacion para filtro estructurado
  const locationIds = await resolveLocationIds(params);
  const locationFilter = locationIds.length > 0
    ? { include: locationIds }
    : undefined;

  // Filtro de tamano de empresa
  const companyHeadcountFilter = buildCompanyHeadcountFilter(params);

  console.log(`[Unipile Direct] keywords="${finalKeywords ?? ''}", location=${locationIds.length} IDs, headcount=${companyHeadcountFilter ? JSON.stringify(companyHeadcountFilter) : 'none'}`);

  const baseRequest: UnipileSalesNavPeopleRequest = {
    api: "sales_navigator",
    category: "people",
    keywords: finalKeywords,
    location: locationFilter,
    company_headcount: companyHeadcountFilter,
    // role: undefined - NO filtrar por cargo (la IA clasificara)
    // seniority: undefined - NO filtrar por nivel (la IA clasificara)
  };

  const maxPages = MAX_PAGES;
  let allPeople: readonly UnipileNormalizedPerson[] = [];
  let totalAvailable = 0;
  let pagesUsed = 0;
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const request: UnipileSearchRequest = cursor
      ? { cursor }
      : baseRequest;

    const response = await withRetry(() => fetchSearchPage(request), {
      maxAttempts: 3,
      baseDelayMs: 2000,
      maxDelayMs: 15_000,
      shouldRetry: isRetryableError,
    });

    pagesUsed++;
    totalAvailable = response.paging?.total_count ?? 0;

    if (response.items) {
      const people = response.items
        .filter(isPersonResult)
        .map(normalizePerson);
      allPeople = [...allPeople, ...people];
    }

    if (!response.cursor || allPeople.length >= maxResults) {
      break;
    }

    cursor = response.cursor;
  }

  const trimmed =
    allPeople.length > maxResults ? allPeople.slice(0, maxResults) : allPeople;

  return {
    people: trimmed,
    totalFetched: trimmed.length,
    totalAvailable,
    pagesUsed,
    companyIdUsed: null,
  };
}

// --- Utilidad para verificar disponibilidad ---

export function isUnipileAvailable(): boolean {
  return Boolean(
    process.env.UNIPILE_API_KEY &&
      process.env.UNIPILE_BASE_URL &&
      process.env.UNIPILE_ACCOUNT_ID
  );
}

/**
 * Obtiene las estadisticas actuales de rate limiting para Unipile.
 * Util para mostrar al usuario cuantas peticiones le quedan.
 */
export function getUnipileRateLimitStats(): {
  hourlyRemaining: number;
  dailyRemaining: number;
  nextResetIn: number;
} | null {
  return getRateLimitStatsUtil(getRateLimitServiceId());
}

/**
 * Obtiene la configuracion actual de rate limiting de Unipile.
 * Incluye el modo actual (test/dev/production) y los limites.
 */
export function getUnipileRateLimitInfo(): {
  mode: string;
  maxRequestsPerHour: number;
  maxRequestsPerDay: number;
  minDelayBetweenRequests: number;
} {
  return getUnipileRateLimitConfig();
}
