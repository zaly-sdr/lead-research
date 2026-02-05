// Tipos para la API de Google Places (New) - Text Search
// Endpoint: POST https://places.googleapis.com/v1/places:searchText

// --- Request ---

export interface GooglePlacesSearchRequest {
  readonly textQuery: string;
  readonly pageSize?: number;
  readonly pageToken?: string;
  readonly languageCode?: string;
  readonly regionCode?: string;
  readonly rankPreference?: "RELEVANCE" | "DISTANCE";
  readonly includedType?: string;
  readonly locationBias?: {
    readonly circle: {
      readonly center: {
        readonly latitude: number;
        readonly longitude: number;
      };
      readonly radius: number;
    };
  };
}

// --- Response ---

export interface GooglePlacesDisplayName {
  readonly text: string;
  readonly languageCode: string;
}

export interface GooglePlacesAddressComponent {
  readonly longText: string;
  readonly shortText: string;
  readonly types: readonly string[];
  readonly languageCode: string;
}

export interface GooglePlacesPlace {
  readonly id: string;
  readonly displayName: GooglePlacesDisplayName;
  readonly formattedAddress: string;
  readonly internationalPhoneNumber?: string;
  readonly nationalPhoneNumber?: string;
  readonly websiteUri?: string;
  readonly types: readonly string[];
  readonly primaryType?: string;
  readonly primaryTypeDisplayName?: GooglePlacesDisplayName;
  readonly rating?: number;
  readonly userRatingCount?: number;
  readonly addressComponents?: readonly GooglePlacesAddressComponent[];
  readonly businessStatus?: string;
}

export interface GooglePlacesSearchResponse {
  readonly places?: readonly GooglePlacesPlace[];
  readonly nextPageToken?: string;
}

// --- Resultado normalizado ---

export interface GooglePlacesNormalizedResult {
  readonly placeId: string;
  readonly companyName: string;
  readonly formattedAddress: string;
  readonly phone: string | null;
  readonly website: string | null;
  readonly types: readonly string[];
  readonly primaryType: string | null;
  readonly rating: number | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly country: string | null;
}
