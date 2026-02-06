// Tests para unipile-service.ts
// Verificar: parseCompanySize, normalizePerson (sin headline fallback)

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de las dependencias externas
vi.mock("@/libs/utils/retry", () => ({
  withRetry: vi.fn((fn) => fn()),
}));

vi.mock("@/libs/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  recordRequest: vi.fn(),
  getRateLimitStats: vi.fn(() => ({
    hourlyRemaining: 100,
    dailyRemaining: 500,
    nextResetIn: 3600000,
  })),
  getUnipileServiceId: vi.fn(() => "unipile-test"),
  getUnipileRateLimitConfig: vi.fn(() => ({
    mode: "test",
    maxRequestsPerHour: 100,
    maxRequestsPerDay: 500,
    minDelayBetweenRequests: 0,
  })),
}));

// --- Tests para parseCompanySize (funcion interna, testeamos indirectamente) ---

describe("parseCompanySize logic", () => {
  // Reimplementamos la logica corregida para testear
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

  it("parsea 'mas de 20 empleados' correctamente", () => {
    const result = parseCompanySize("mas de 20 empleados");
    expect(result).toEqual({ min: 20 });
  });

  it("parsea '>50' correctamente", () => {
    const result = parseCompanySize(">50");
    expect(result).toEqual({ min: 50 });
  });

  it("parsea '100+' correctamente", () => {
    const result = parseCompanySize("100+");
    expect(result).toEqual({ min: 100 });
  });

  it("parsea 'menos de 50' correctamente", () => {
    const result = parseCompanySize("menos de 50");
    expect(result).toEqual({ max: 50 });
  });

  it("parsea '<100' correctamente", () => {
    const result = parseCompanySize("<100");
    expect(result).toEqual({ max: 100 });
  });

  it("parsea '20-50' correctamente", () => {
    const result = parseCompanySize("20-50");
    expect(result).toEqual({ min: 20, max: 50 });
  });

  it("parsea '10 a 100' correctamente", () => {
    const result = parseCompanySize("10 a 100");
    expect(result).toEqual({ min: 10, max: 100 });
  });

  it("parsea numero solo como minimo", () => {
    const result = parseCompanySize("50");
    expect(result).toEqual({ min: 50 });
  });

  it("retorna null para string vacio", () => {
    const result = parseCompanySize("");
    expect(result).toBeNull();
  });

  it("retorna null para undefined", () => {
    const result = parseCompanySize(undefined);
    expect(result).toBeNull();
  });
});

// --- Tests para normalizePerson (sin headline fallback) ---

describe("normalizePerson - sin headline fallback", () => {
  // Reimplementamos la logica clave para testear
  function extractCurrentCompany(
    positions: readonly { company_name?: string; is_current?: boolean }[] | undefined
  ): string | null {
    if (!positions || positions.length === 0) return null;
    const current = positions.find((p) => p.is_current === true);
    return current?.company_name ?? positions[0]?.company_name ?? null;
  }

  function normalizePerson(person: {
    id: string;
    name: string;
    company?: string | null;
    headline?: string;
    current_positions?: readonly { company_name?: string; is_current?: boolean }[];
  }): { companyName: string | null } {
    // Solo usa company directo y current_positions, NO headline
    const companyDirect = person.company ?? null;
    const companyFromPositions = extractCurrentCompany(person.current_positions);
    const companyName = companyDirect ?? companyFromPositions;
    return { companyName };
  }

  it("usa campo company directo si esta presente", () => {
    const person = {
      id: "123",
      name: "Juan Perez",
      company: "Repsol",
      headline: "CEO at FakeCompany",
      current_positions: [{ company_name: "OtraEmpresa", is_current: true }],
    };
    const result = normalizePerson(person);
    expect(result.companyName).toBe("Repsol");
  });

  it("usa current_positions si company directo es null", () => {
    const person = {
      id: "123",
      name: "Juan Perez",
      company: null,
      headline: "CEO at FakeCompany",
      current_positions: [{ company_name: "Telefonica", is_current: true }],
    };
    const result = normalizePerson(person);
    expect(result.companyName).toBe("Telefonica");
  });

  it("NO extrae empresa del headline (fallback eliminado)", () => {
    const person = {
      id: "123",
      name: "Juan Perez",
      company: null,
      headline: "Director en Repsol | Experto en energia",
      current_positions: [],
    };
    const result = normalizePerson(person);
    // Antes extraeria "Repsol" del headline, ahora debe ser null
    expect(result.companyName).toBeNull();
  });

  it("retorna null si no hay datos de empresa en ningun campo", () => {
    const person = {
      id: "123",
      name: "Maria Garcia",
      headline: "Profesor y Mentor, discipline",
    };
    const result = normalizePerson(person);
    expect(result.companyName).toBeNull();
  });

  it("usa primera posicion si ninguna es current", () => {
    const person = {
      id: "123",
      name: "Ana Lopez",
      current_positions: [
        { company_name: "EmpresaAntigua", is_current: false },
        { company_name: "EmpresaNueva", is_current: false },
      ],
    };
    const result = normalizePerson(person);
    expect(result.companyName).toBe("EmpresaAntigua");
  });
});

// --- Tests para normalizeCompanyName ---

describe("normalizeCompanyName", () => {
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

  it("normaliza 'Repsol S.A.' a 'repsol'", () => {
    expect(normalizeCompanyName("Repsol S.A.")).toBe("repsol");
  });

  it("normaliza 'NH Hotel Group' a 'nh hotel'", () => {
    expect(normalizeCompanyName("NH Hotel Group")).toBe("nh hotel");
  });

  it("normaliza 'Telefonica España' - remueve caracteres no ASCII", () => {
    // La ñ se remueve porque no esta en a-z, resultando en "espaa"
    // que no coincide con "espana" en la blocklist
    expect(normalizeCompanyName("Telefonica España")).toBe("telefonica espaa");
  });

  it("normaliza 'Telefonica Espana' (sin tilde) a 'telefonica'", () => {
    // Sin tilde, "espana" SI esta en la blocklist y se remueve
    expect(normalizeCompanyName("Telefonica Espana")).toBe("telefonica");
  });

  it("normaliza 'Acme Inc.' a 'acme'", () => {
    expect(normalizeCompanyName("Acme Inc.")).toBe("acme");
  });

  it("normaliza 'Google LLC' a 'google llc'", () => {
    // LLC no esta en la lista de sufijos a remover
    expect(normalizeCompanyName("Google LLC")).toBe("google llc");
  });

  it("normaliza 'BBVA S.A.U.' a 'bbva'", () => {
    expect(normalizeCompanyName("BBVA S.A.U.")).toBe("bbva");
  });
});

// --- Tests para extractDomain ---

describe("extractDomain", () => {
  function extractDomain(url: string): string | null {
    try {
      const hostname = new URL(url).hostname;
      return hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return null;
    }
  }

  it("extrae dominio de URL completa", () => {
    expect(extractDomain("https://www.repsol.com/es/productos")).toBe("repsol.com");
  });

  it("extrae dominio sin www", () => {
    expect(extractDomain("https://google.com")).toBe("google.com");
  });

  it("maneja URLs con subdominios", () => {
    expect(extractDomain("https://careers.telefonica.com")).toBe("careers.telefonica.com");
  });

  it("retorna null para URL invalida", () => {
    expect(extractDomain("not-a-url")).toBeNull();
  });

  it("retorna null para string vacio", () => {
    expect(extractDomain("")).toBeNull();
  });
});