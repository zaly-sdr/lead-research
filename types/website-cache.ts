// Tipos relacionados con el cache de scraping web

export interface WebsiteCache {
  readonly id: number;
  readonly url: string;
  readonly domain: string;
  readonly raw_content: string | null;
  readonly summary: string | null;
  readonly company_name: string | null;
  readonly industry: string | null;
  readonly services: readonly string[] | null;
  readonly estimated_size: string | null;
  readonly tech_stack: readonly string[] | null;
  readonly locations: readonly string[] | null;
  readonly scrape_source: "firecrawl" | "jina";
  readonly http_status: number | null;
  readonly scraped_at: string;
  readonly expires_at: string;
  readonly created_at: string;
}

// Payload para insertar en cache (usado por el admin client)
export interface CreateWebsiteCachePayload {
  readonly url: string;
  readonly domain: string;
  readonly raw_content?: string;
  readonly summary?: string;
  readonly company_name?: string;
  readonly industry?: string;
  readonly services?: string[];
  readonly estimated_size?: string;
  readonly tech_stack?: string[];
  readonly locations?: string[];
  readonly scrape_source: "firecrawl" | "jina";
  readonly http_status?: number;
}
