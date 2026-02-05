// Tipos para el Lead Merger
// Combina datos de LinkedIn (Unipile) + Google Places

import type { UnipileNormalizedPerson } from "./unipile-types";
import type { GooglePlacesNormalizedResult } from "./google-places-types";

// Fuentes de datos de un lead
export type LeadSource = "linkedin" | "google_places" | "both";

// Lead unificado con datos de ambas fuentes
export interface MergedLead {
  // Identificadores
  readonly id: string; // UUID generado
  readonly linkedinId: string | null;
  readonly googlePlaceId: string | null;

  // Datos de la persona (LinkedIn)
  readonly fullName: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly jobTitle: string | null;
  readonly headline: string | null;
  readonly linkedinUrl: string; // OBLIGATORIO - sin esto no es un lead valido
  readonly profilePictureUrl: string | null;
  readonly networkDistance: string | null;

  // Datos de la empresa (Google Places + LinkedIn)
  readonly companyName: string;
  readonly companyWebsite: string | null;
  readonly companyPhone: string | null;
  readonly companyAddress: string | null;
  readonly companyRating: number | null;
  readonly companyIndustry: string | null;

  // Ubicacion
  readonly city: string | null;
  readonly region: string | null;
  readonly country: string | null;

  // Metadata
  readonly sources: readonly LeadSource[];
  readonly matchConfidence: "high" | "medium" | "low";
  readonly createdAt: string; // ISO date
}

// Resultado de una busqueda con merge
export interface MergedSearchResult {
  readonly leads: readonly MergedLead[];
  readonly stats: {
    readonly totalFromGoogle: number;
    readonly totalFromLinkedIn: number;
    readonly mergedCount: number;
    readonly linkedInOnlyCount: number;
    readonly discardedNoLinkedIn: number;
  };
  readonly rateLimits: {
    readonly unipileRemaining: number;
    readonly googlePlacesRemaining: number;
  };
}

// Opciones para el merge
export interface MergeOptions {
  readonly fuzzyThreshold?: number; // 0-1, default 0.8
  readonly preferLinkedInData?: boolean; // Si hay conflicto, preferir LinkedIn
}

// Resultado intermedio de Google Places con personas encontradas
export interface GooglePlaceWithPeople {
  readonly place: GooglePlacesNormalizedResult;
  readonly people: readonly UnipileNormalizedPerson[];
  readonly linkedInSearchUsed: boolean;
}
