import { withRetry } from "@/libs/utils/retry";
import type { ParsedSearchParamsInput } from "@/libs/validators/search-schema";
import type { CreateLeadPayload } from "@/types/lead";
import type {
  GooglePlacesSearchRequest,
  GooglePlacesSearchResponse,
  GooglePlacesPlace,
  GooglePlacesNormalizedResult,
  GooglePlacesAddressComponent,
} from "./google-places-types";

// --- Configuracion ---

const PLACES_API_URL =
  "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.types",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.rating",
  "places.addressComponents",
  "places.businessStatus",
  "nextPageToken",
].join(",");

const MAX_PAGES = 3;
const PAGE_SIZE = 20;
const REQUEST_TIMEOUT_MS = 15_000;

// --- API Key ---

function getApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_PLACES_API_KEY no esta configurada");
  }
  return key;
}

// --- Error personalizado ---

export class GooglePlacesError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "GooglePlacesError";
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, GooglePlacesError.prototype);
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof GooglePlacesError) {
    return error.statusCode === 429 || error.statusCode >= 500;
  }
  return false;
}

// --- Normalizacion de texto ---

/**
 * Elimina acentos/diacriticos de un string para comparaciones normalizadas.
 * "Espana" -> "espana", "Munchen" -> "munchen"
 */
function removeAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// --- Construccion de query ---

/**
 * Construye la query de texto para Google Places a partir de los
 * parametros parseados por la IA.
 *
 * Adapta el idioma del prefijo segun la configuracion de idioma.
 *
 * Ejemplos:
 * - { industry: ["energy"], location: { city: "Barcelona" } }
 *   -> "energy en Barcelona"
 * - { keywords: ["restaurante"], location: { city: "Madrid", country: "Spain" } }
 *   -> "restaurante en Madrid, Spain"
 */
export function buildPlacesQuery(params: ParsedSearchParamsInput): string {
  const parts: string[] = [];

  // Industria o keywords como base de la busqueda
  // Se pasan directamente sin prefijo para que Google Places
  // interprete correctamente en cualquier idioma
  if (params.industry.length > 0) {
    parts.push(params.industry.join(", "));
  } else if (params.keywords.length > 0) {
    parts.push(params.keywords.join(" "));
  }

  // Ubicacion
  const locationParts: string[] = [];
  if (params.location.city) {
    locationParts.push(params.location.city);
  }
  if (params.location.region) {
    locationParts.push(params.location.region);
  }
  if (params.location.country) {
    locationParts.push(params.location.country);
  }

  if (locationParts.length > 0) {
    parts.push(locationParts.join(", "));
  }

  return parts.join(" ") || "empresas";
}

/**
 * Determina el codigo de idioma para la consulta.
 * Usa el idioma parseado o "es" como default.
 */
function getLanguageCode(params: ParsedSearchParamsInput): string {
  if (params.language) {
    const langMap: Record<string, string> = {
      espanol: "es",
      spanish: "es",
      english: "en",
      ingles: "en",
      french: "fr",
      frances: "fr",
      portuguese: "pt",
      portugues: "pt",
      german: "de",
      aleman: "de",
      italian: "it",
      italiano: "it",
      chinese: "zh",
      chino: "zh",
      japanese: "ja",
      japones: "ja",
      korean: "ko",
      coreano: "ko",
      arabic: "ar",
      arabe: "ar",
      russian: "ru",
      ruso: "ru",
      dutch: "nl",
      holandes: "nl",
    };
    const normalized = removeAccents(params.language.toLowerCase());
    return langMap[normalized] ?? params.language.slice(0, 2).toLowerCase();
  }
  return "es";
}

/**
 * Determina el codigo de region a partir de la ubicacion.
 * Normaliza acentos para manejar variaciones como "Espana" vs "Espana".
 */
function getRegionCode(params: ParsedSearchParamsInput): string | undefined {
  const countryMap: Record<string, string> = {
    spain: "ES",
    espana: "ES",
    mexico: "MX",
    argentina: "AR",
    colombia: "CO",
    chile: "CL",
    peru: "PE",
    ecuador: "EC",
    uruguay: "UY",
    paraguay: "PY",
    bolivia: "BO",
    venezuela: "VE",
    "costa rica": "CR",
    panama: "PA",
    guatemala: "GT",
    honduras: "HN",
    "el salvador": "SV",
    nicaragua: "NI",
    "republica dominicana": "DO",
    cuba: "CU",
    "puerto rico": "PR",
    "united states": "US",
    "estados unidos": "US",
    usa: "US",
    canada: "CA",
    france: "FR",
    francia: "FR",
    germany: "DE",
    alemania: "DE",
    italy: "IT",
    italia: "IT",
    portugal: "PT",
    brazil: "BR",
    brasil: "BR",
    "united kingdom": "GB",
    "reino unido": "GB",
    uk: "GB",
    netherlands: "NL",
    "paises bajos": "NL",
    holanda: "NL",
    belgium: "BE",
    belgica: "BE",
    switzerland: "CH",
    suiza: "CH",
    austria: "AT",
    sweden: "SE",
    suecia: "SE",
    norway: "NO",
    noruega: "NO",
    denmark: "DK",
    dinamarca: "DK",
    finland: "FI",
    finlandia: "FI",
    ireland: "IE",
    irlanda: "IE",
    poland: "PL",
    polonia: "PL",
    japan: "JP",
    japon: "JP",
    china: "CN",
    australia: "AU",
    "new zealand": "NZ",
    "nueva zelanda": "NZ",
    india: "IN",
  };

  if (params.location.country) {
    const normalized = removeAccents(params.location.country.toLowerCase());
    return countryMap[normalized];
  }
  return undefined;
}

// --- Llamada a la API ---

async function fetchPlacesPage(
  request: GooglePlacesSearchRequest
): Promise<GooglePlacesSearchResponse> {
  const apiKey = getApiKey();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(PLACES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Sin detalle");
      // Log completo en servidor, lanzar mensaje sanitizado
      console.error(
        `Google Places API error ${response.status}: ${errorBody}`
      );
      throw new GooglePlacesError(
        `Google Places API error: ${response.status}`,
        response.status
      );
    }

    return (await response.json()) as GooglePlacesSearchResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- Normalizacion de resultados ---

function extractAddressComponent(
  components: readonly GooglePlacesAddressComponent[] | undefined,
  type: string
): string | null {
  if (!components) return null;
  const component = components.find((c) => c.types?.includes(type));
  return component?.longText ?? null;
}

function normalizePlace(
  place: GooglePlacesPlace
): GooglePlacesNormalizedResult {
  return {
    placeId: place.id,
    companyName: place.displayName.text,
    formattedAddress: place.formattedAddress,
    phone:
      place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,
    types: place.types ?? [],
    primaryType: place.primaryType ?? null,
    rating: place.rating ?? null,
    city: extractAddressComponent(place.addressComponents, "locality"),
    region: extractAddressComponent(
      place.addressComponents,
      "administrative_area_level_1"
    ),
    country: extractAddressComponent(place.addressComponents, "country"),
  };
}

// --- Conversion a CreateLeadPayload ---

/**
 * Convierte un resultado normalizado de Google Places a un CreateLeadPayload
 * listo para insertar en la base de datos.
 */
export function placeToLeadPayload(
  place: GooglePlacesNormalizedResult,
  searchId: number,
  userId: string
): CreateLeadPayload {
  return {
    search_id: searchId,
    user_id: userId,
    source: "google_places",
    company_name: place.companyName,
    company_website: place.website ?? undefined,
    company_phone: place.phone ?? undefined,
    company_address: place.formattedAddress,
    company_industry: place.primaryType ?? undefined,
    company_rating: place.rating ?? undefined,
    google_place_id: place.placeId,
    city: place.city ?? undefined,
    region: place.region ?? undefined,
    country: place.country ?? undefined,
    raw_data: {
      types: [...place.types],
      primaryType: place.primaryType,
      formattedAddress: place.formattedAddress,
    },
  };
}

// --- Funcion principal ---

export interface GooglePlacesSearchOptions {
  readonly params: ParsedSearchParamsInput;
  readonly maxResults?: number;
}

export interface GooglePlacesSearchResult {
  readonly places: readonly GooglePlacesNormalizedResult[];
  readonly totalFetched: number;
  readonly pagesUsed: number;
}

/**
 * Busca negocios en Google Places usando los parametros parseados por la IA.
 *
 * - Construye la query automaticamente desde ParsedSearchParamsInput
 * - Pagina hasta 3 paginas (60 resultados max)
 * - Filtra negocios permanentemente cerrados
 * - Normaliza los resultados
 * - Reintenta en errores 429 y 500+
 * - Timeout de 15s por request
 */
export async function searchGooglePlaces(
  options: GooglePlacesSearchOptions
): Promise<GooglePlacesSearchResult> {
  const { params, maxResults = 60 } = options;

  const textQuery = buildPlacesQuery(params);
  const languageCode = getLanguageCode(params);
  const regionCode = getRegionCode(params);

  const maxPages = Math.min(MAX_PAGES, Math.ceil(maxResults / PAGE_SIZE));

  let allPlaces: readonly GooglePlacesNormalizedResult[] = [];
  let pageToken: string | undefined;
  let pagesUsed = 0;

  for (let page = 0; page < maxPages; page++) {
    const request: GooglePlacesSearchRequest = {
      textQuery,
      pageSize: PAGE_SIZE,
      languageCode,
      regionCode,
      pageToken,
    };

    const response = await withRetry(() => fetchPlacesPage(request), {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10_000,
      shouldRetry: isRetryableError,
    });

    pagesUsed++;

    if (response.places) {
      // Filtrar negocios permanentemente cerrados
      const activePlaces = response.places.filter(
        (p) => p.businessStatus !== "CLOSED_PERMANENTLY"
      );
      const normalized = activePlaces.map(normalizePlace);
      allPlaces = [...allPlaces, ...normalized];
    }

    if (!response.nextPageToken || allPlaces.length >= maxResults) {
      break;
    }

    pageToken = response.nextPageToken;
  }

  const trimmed =
    allPlaces.length > maxResults ? allPlaces.slice(0, maxResults) : allPlaces;

  return {
    places: trimmed,
    totalFetched: trimmed.length,
    pagesUsed,
  };
}

// --- Utilidad para verificar disponibilidad ---

export function isGooglePlacesAvailable(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}
