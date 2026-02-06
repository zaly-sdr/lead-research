import type { GooglePlacesNormalizedResult } from "./google-places-types";
import type {
  GooglePlacesSearchOptions,
  GooglePlacesSearchResult,
} from "./google-places-service";

// Datos mock para desarrollo sin API key de Google Places

const MOCK_PLACES: readonly GooglePlacesNormalizedResult[] = [
  {
    placeId: "mock_place_001",
    companyName: "Energia Solar Barcelona SL",
    formattedAddress: "Carrer de Balmes 150, 08008 Barcelona, Espana",
    phone: "+34 93 123 4567",
    website: "https://energiasolarbarcelona.example.com",
    types: ["electrician", "point_of_interest", "establishment"],
    primaryType: "electrician",
    rating: 4.5,
    city: "Barcelona",
    region: "Cataluna",
    country: "Espana",
  },
  {
    placeId: "mock_place_002",
    companyName: "Renovables del Mediterraneo",
    formattedAddress: "Avinguda Diagonal 400, 08037 Barcelona, Espana",
    phone: "+34 93 234 5678",
    website: "https://renovablesmed.example.com",
    types: ["general_contractor", "point_of_interest", "establishment"],
    primaryType: "general_contractor",
    rating: 4.2,
    city: "Barcelona",
    region: "Cataluna",
    country: "Espana",
  },
  {
    placeId: "mock_place_003",
    companyName: "EcoPower Consulting",
    formattedAddress: "Passeig de Gracia 55, 08007 Barcelona, Espana",
    phone: "+34 93 345 6789",
    website: "https://ecopower.example.com",
    types: ["consultant", "point_of_interest", "establishment"],
    primaryType: "consultant",
    rating: 4.8,
    city: "Barcelona",
    region: "Cataluna",
    country: "Espana",
  },
  {
    placeId: "mock_place_004",
    companyName: "Instalaciones Verdes BCN",
    formattedAddress: "Carrer de Sarria 100, 08034 Barcelona, Espana",
    phone: "+34 93 456 7890",
    website: null,
    types: ["electrician", "point_of_interest", "establishment"],
    primaryType: "electrician",
    rating: 3.9,
    city: "Barcelona",
    region: "Cataluna",
    country: "Espana",
  },
  {
    placeId: "mock_place_005",
    companyName: "SunTech Iberia",
    formattedAddress: "Ronda de Sant Pere 30, 08010 Barcelona, Espana",
    phone: "+34 93 567 8901",
    website: "https://suntechiberia.example.com",
    types: ["store", "point_of_interest", "establishment"],
    primaryType: "store",
    rating: 4.1,
    city: "Barcelona",
    region: "Cataluna",
    country: "Espana",
  },
];

/**
 * Busqueda mock de Google Places para desarrollo sin API key.
 * Devuelve datos ficticios pero con la misma estructura.
 */
export async function searchGooglePlacesStub(
  options: GooglePlacesSearchOptions
): Promise<GooglePlacesSearchResult> {
  const { maxResults = 60 } = options;

  // Simular latencia de red
  await new Promise((resolve) => setTimeout(resolve, 300));

  const trimmed =
    MOCK_PLACES.length > maxResults
      ? MOCK_PLACES.slice(0, maxResults)
      : MOCK_PLACES;

  return {
    places: trimmed,
    totalFetched: trimmed.length,
    pagesUsed: 1,
  };
}
