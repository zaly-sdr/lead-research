# Fuente de Leads - Plan de Arquitectura

## 1. Vision General

Aplicacion web de generacion de leads tipo Apollo.io. El usuario escribe una consulta en lenguaje natural (ej: "directivos en Barcelona del sector de la energia") y el sistema:

1. Interpreta la consulta con IA (Claude/OpenAI)
2. Busca en LinkedIn (Unipile) y Google Maps en paralelo
3. Fusiona y deduplica resultados
4. Scrapea las webs encontradas (Firecrawl/Jina.ai) para obtener contexto de la empresa
5. Clasifica y puntua cada lead con IA (usando datos de perfil + contenido web)
6. Enriquece emails faltantes con Hunter.io
7. Muestra resultados en tabla interactiva con export

---

## 2. Stack Tecnologico

| Componente | Tecnologia |
|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript |
| UI Components | DaisyUI 5 + Tailwind CSS v4 |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| AI Primario | Claude API (Anthropic) |
| AI Fallback | OpenAI API (GPT-4o) |
| LinkedIn Data | Unipile API |
| Business Data | Google Places API |
| Email Finder | Hunter.io API |
| Web Scraping | Firecrawl API (primario) + Jina.ai (fallback) |
| State Management | Zustand |
| Validacion | Zod |
| Testing | Vitest + Playwright |

---

## 3. Flujo del Sistema

```
[Usuario escribe consulta]
        |
        v
[API Route: /api/search]
        |
        v
[AI Parser] -- Claude API (fallback: OpenAI)
  Extrae: {
    keywords: string[]
    jobTitles: string[]
    location: { city, country, region }
    industry: string[]
    seniority: string[]
    companySize?: string
    language?: string
  }
        |
        v
  [Orquestador de Busqueda]
     /                    \
    v                      v
[Unipile Search]    [Google Places Search]
  LinkedIn            Negocios locales
  Personas            Nombre empresa
  Perfiles            Telefono
  Emails              Web
  Telefonos           Categoria
    \                      /
     v                    v
  [Merger + Deduplicador]
    Combina por: empresa, nombre, email
        |
        v
  [Web Scraper] -- Firecrawl (primario) / Jina.ai (fallback)
    Para cada lead que tenga website:
    - Scrapea la web de la empresa
    - Extrae: descripcion, servicios, sector, tamano, tecnologias
    - Almacena resumen (max ~500 tokens por empresa)
    - Cache en Supabase (no re-scrapear misma web)
        |
        v
  [AI Scorer] -- Claude API (fallback: OpenAI)
    Para cada lead recibe:
    - Datos de perfil (LinkedIn/Google Maps)
    - Contenido scrapeado de la web de la empresa
    - Consulta original del usuario
    Produce:
    - relevance_score (0-100)
    - explanation (por que si/no es relevante)
    - confidence (high/medium/low)
    - company_insights (resumen de la empresa basado en su web)
        |
        v
  [Enrichment Pipeline]
    Para leads sin email:
    - Hunter.io: domain + name -> email
    - Verificacion de email
        |
        v
  [Guardar en Supabase]
        |
        v
  [Respuesta al Frontend]
    Leads ordenados por score
    Con paginacion y filtros
```

---



## 5. Estructura de Archivos

NOTA: El proyecto usa directorios en raiz (NO src/), y `libs/` (NO `lib/`).

```
app/
├── layout.tsx                        # Layout principal
├── page.tsx                          # Landing / redirect
├── globals.css                       # DaisyUI 5 + Tailwind v4 theme
├── signin/
│   ├── layout.tsx
│   └── page.tsx
├── dashboard/
│   ├── layout.tsx                    # Dashboard layout (sidebar + header + auth guard)
│   ├── page.tsx                      # Pagina principal de busqueda
│   ├── search/[id]/
│   │   └── page.tsx                  # Resultados de una busqueda
│   ├── leads/
│   │   └── page.tsx                  # Todos los leads guardados
│   ├── lists/
│   │   └── page.tsx                  # Listas de leads
│   ├── lists/[id]/
│   │   └── page.tsx                  # Detalle de una lista
│   ├── history/
│   │   └── page.tsx                  # Historial de busquedas
│   └── settings/
│       └── page.tsx                  # Configuracion de cuenta
└── api/
    ├── auth/callback/route.ts        # OAuth callback
    ├── search/
    │   ├── route.ts                  # POST: iniciar busqueda
    │   └── [id]/
    │       ├── route.ts              # GET: estado/resultados de busqueda
    │       └── leads/route.ts        # GET: leads de una busqueda
    ├── leads/
    │   ├── route.ts                  # GET: listar leads, POST: bulk ops
    │   ├── [id]/route.ts             # GET/PATCH/DELETE un lead
    │   └── export/route.ts           # POST: exportar a CSV/Excel
    ├── lists/
    │   ├── route.ts                  # GET/POST listas
    │   └── [id]/
    │       ├── route.ts              # GET/PATCH/DELETE lista
    │       └── items/route.ts        # POST/DELETE items de lista
    ├── stripe/
    │   ├── create-checkout/route.ts
    │   └── create-portal/route.ts
    └── webhook/stripe/route.ts

libs/
├── supabase/
│   ├── client.ts                     # Cliente browser (SSR)
│   ├── server.ts                     # Cliente server-side (async)
│   ├── admin.ts                      # Cliente admin (service role)
│   └── middleware.ts                 # Session management
├── ai/
│   ├── provider.ts                   # Factory: Claude o OpenAI
│   ├── claude-client.ts              # Wrapper Claude API
│   ├── openai-client.ts              # Wrapper OpenAI API
│   ├── query-parser.ts               # Interpretar consulta -> parametros
│   ├── lead-scorer.ts                # Puntuar y clasificar leads
│   └── prompts/
│       ├── parse-query.ts            # Prompt para parsear consulta
│       └── score-lead.ts             # Prompt para puntuar lead
├── services/
│   ├── search-orchestrator.ts        # Orquesta busqueda completa
│   ├── unipile-service.ts            # Busqueda LinkedIn via Unipile
│   ├── google-places-service.ts      # Busqueda Google Places
│   ├── hunter-service.ts             # Email finding via Hunter.io
│   ├── web-scraper-service.ts        # Scraping webs con Firecrawl/Jina.ai
│   ├── lead-merger.ts                # Fusionar + deduplicar leads
│   └── export-service.ts             # Generar CSV/Excel
├── validators/
│   ├── search-schema.ts              # Zod schemas busqueda
│   └── lead-schema.ts                # Zod schemas leads
├── utils/
│   ├── rate-limiter.ts               # Rate limiting para APIs externas
│   ├── retry.ts                      # Retry logic con backoff
│   ├── dedup.ts                      # Algoritmos de deduplicacion
│   └── format.ts                     # Formateo de datos
├── api.ts                            # Axios client con interceptors
├── stripe.ts                         # Stripe checkout & portal
└── resend.ts                         # Email sending

types/
├── config.ts                         # Tipos de configuracion
├── search.ts                         # Tipos de busqueda
├── lead.ts                           # Tipos de lead
├── list.ts                           # Tipos de listas
├── api.ts                            # Tipos de respuestas API
└── index.ts                          # Barrel export

components/
├── search/
│   ├── search-bar.tsx                # Barra de busqueda principal
│   ├── search-suggestions.tsx        # Sugerencias de busqueda
│   ├── search-progress.tsx           # Progreso de busqueda en tiempo real
│   └── parsed-params-display.tsx     # Badges visuales de parametros parseados
├── leads/
│   ├── lead-table.tsx                # Tabla de leads
│   ├── lead-row.tsx                  # Fila individual
│   ├── lead-detail.tsx               # Detalle de un lead
│   ├── lead-filters.tsx              # Filtros de leads
│   ├── lead-score-badge.tsx          # Badge de puntuacion
│   └── lead-export-dialog.tsx        # Dialog de exportacion
├── lists/
│   ├── list-card.tsx
│   └── add-to-list-dialog.tsx
├── layout/
│   ├── sidebar.tsx                   # Sidebar de navegacion
│   ├── header.tsx                    # Header del dashboard
│   └── nav-items.ts                  # Definicion de items de navegacion
├── ButtonAccount.tsx                 # Menu de usuario
├── ButtonCheckout.tsx                # Checkout Stripe
├── ButtonSignin.tsx                  # Auth buttons
└── LayoutClient.tsx                  # Client wrapper (Crisp, Toast, Tooltip)

hooks/
├── use-search.ts                     # Hook para busquedas
├── use-leads.ts                      # Hook para leads
└── use-lists.ts                      # Hook para listas

stores/
├── search-store.ts                   # Estado de busqueda (Zustand)
└── lead-store.ts                     # Estado de leads (Zustand)

supabase/
└── migrations/
    ├── 001_profiles.sql              # Tabla profiles + trigger auto-create
    ├── 002_searches.sql              # Tabla searches + status enum
    ├── 003_leads.sql                 # Tabla leads + scoring + source
    ├── 004_lists.sql                 # Tablas lists + list_items
    └── 005_website_cache.sql         # Cache de scraping web
```

---

## 6. Integracion con APIs Externas

### 6.1 Unipile (LinkedIn)

**Endpoint principal**: `POST /api/v1/linkedin/search`

```typescript
// Flujo:
// 1. Convertir parsed_params a filtros de Unipile
// 2. Buscar personas en LinkedIn
// 3. Para cada resultado, extraer perfil completo
// 4. Devolver datos normalizados

// Manejo de errores:
// - Retry con exponential backoff (3 intentos)
// - Cache de resultados por 24h en Supabase
// - Rate limiting respetar limites de LinkedIn (via Unipile)

// Datos extraidos:
// - Nombre completo
// - Cargo actual
// - Empresa
// - Email (si publico)
// - Telefono (si publico)
// - URL de LinkedIn
// - Industria
// - Ubicacion
```

### 6.2 Google Places API

**Endpoint**: `places:searchText`

```typescript
// Flujo:
// 1. Construir query: "{industry} en {location}"
// 2. Buscar negocios
// 3. Para cada resultado, obtener detalles
// 4. Extraer: nombre empresa, telefono, web, direccion, categoria

// Manejo de errores:
// - FieldMask para minimizar costo (solo campos necesarios)
// - Cache agresivo (negocios cambian poco)
// - Limite de 60 resultados por busqueda (3 paginas de 20)

// Datos extraidos:
// - Nombre de empresa
// - Telefono de empresa
// - Website
// - Direccion
// - Categoria/industria
// - Rating (para filtrar calidad)
```

### 6.3 Hunter.io

**Endpoint**: `GET /v2/email-finder`

```typescript
// Flujo (solo para leads sin email):
// 1. Input: first_name + last_name + domain (del website)
// 2. Hunter devuelve email probable + confidence score
// 3. Verificar email con Hunter verify endpoint
// 4. Guardar solo emails con confidence > 80%

// Rate limits:
// - Free: 25 searches/month
// - Starter: 500 searches/month ($49)
// - Implementar cola para no exceder limites

// Datos extraidos:
// - Email profesional
// - Confidence score
// - Verificacion (deliverable/risky/undeliverable)
```

### 6.4 Web Scraping (Firecrawl + Jina.ai)

**Primario**: Firecrawl API (`POST https://api.firecrawl.dev/v1/scrape`)
**Fallback**: Jina.ai Reader (`GET https://r.jina.ai/{url}`)

```typescript
// Flujo (para cada lead con website):
// 1. Verificar cache: si ya scrapeamos esa URL en <7 dias, usar cache
// 2. Intentar con Firecrawl:
//    - POST /v1/scrape { url, formats: ["markdown"], onlyMainContent: true }
//    - Devuelve contenido limpio en markdown
// 3. Si Firecrawl falla -> fallback a Jina.ai:
//    - GET https://r.jina.ai/{url}
//    - Header: Accept: text/markdown
//    - Devuelve contenido como markdown
// 4. Resumir contenido con IA (max 500 tokens):
//    - Extraer: que hace la empresa, sector, servicios, tamano
// 5. Guardar resumen en tabla website_cache

// Manejo de errores:
// - Timeout de 10s por web (no bloquear el flujo)
// - Si ambos fallan, continuar sin datos web (scoring parcial)
// - Scraping en paralelo (hasta 5 webs simultaneas)
// - Skip URLs que parecen irrelevantes (social media, etc.)

// Datos extraidos y resumidos:
// - Descripcion de la empresa
// - Sector/industria real (no solo lo que dice LinkedIn)
// - Servicios o productos principales
// - Tamano estimado
// - Stack tecnologico (si es tech)
// - Ubicaciones/oficinas
```

### 6.5 Claude API (AI Primario)

```typescript
// Uso 1: Parsear consulta del usuario
// Input: "directivos en Barcelona del sector de la energia"
// Output: { jobTitles: ["director","CEO","CTO"], location: {city:"Barcelona"}, industry: ["energy"] }

// Uso 2: Puntuar leads
// Input: lead data + query original
// Output: { score: 85, explanation: "Director de operaciones en empresa energetica en Barcelona", confidence: "high" }

// Fallback: Si Claude falla -> OpenAI GPT-4o con el mismo prompt
// Rate limit: Batch scoring (hasta 10 leads por request)
```

---

## 7. Estrategia de IA

### 7.1 Prompt para Parsear Consulta

```
Eres un experto en busqueda de leads B2B. El usuario te dara una consulta
en lenguaje natural. Extrae los siguientes parametros estructurados:

- keywords: palabras clave generales
- jobTitles: cargos especificos (traduce a ingles Y mantiene espanol)
- location: { city, region, country } (deduce pais si no se especifica)
- industry: sectores industriales (en ingles para LinkedIn)
- seniority: nivel (entry, mid, senior, director, vp, c-suite)
- companySize: tamano si se menciona
- excludeTerms: terminos a excluir

Responde SOLO en JSON valido.
```

### 7.2 Prompt para Puntuar Leads

```
Eres un analista de leads B2B. Dados los criterios de busqueda originales,
los datos de un lead y el contenido de la web de su empresa, evalua su relevancia.

Criterios de busqueda: {parsedQuery}
Datos del lead: {leadData}
Contenido web de la empresa: {websiteContent}

Evalua:
1. relevance_score (0-100): que tan bien coincide con la busqueda
2. explanation: explicacion breve en espanol de por que es o no relevante
3. confidence: (high/medium/low) basado en la calidad de datos disponibles
4. company_insights: resumen de 1-2 frases sobre la empresa basado en su web

Factores de scoring:
- Coincidencia de cargo con lo buscado (25%)
- Ubicacion correcta (20%)
- Industria relevante - verificada con contenido web (25%)
- Seniority apropiado (15%)
- Datos de contacto disponibles (10%)
- Calidad de la empresa segun su web (5%)

El contenido web te permite verificar si la empresa REALMENTE pertenece
al sector buscado (no solo lo que dice LinkedIn). Usa esta info para
ajustar el score. Si no hay contenido web, basa el score solo en los
datos del perfil y reduce el confidence.

Responde SOLO en JSON valido.
```

---

## 8. Fases de Implementacion (Detallado)

**APIs disponibles ahora**: Claude (Anthropic), Unipile, Google Places
**APIs pendientes**: Firecrawl, Hunter.io

### Estado de Fases

| Fase | Estado | Notas |
|------|--------|-------|
| Fase 1 | COMPLETADA | DB, tipos, validadores |
| Fase 2 | COMPLETADA | Query parser, UI busqueda |
| Fase 3 | COMPLETADA | Google Places, Orchestrator |
| Fase 4 | EN PROGRESO | Scoring implementado, UI pendiente |
| Fase 5 | PENDIENTE | Scraping, Hunter.io |

---

### Fase 1: Base de Datos + Tipos

**Prerequisito**: Crear proyecto Supabase y configurar `.env.local`

**1.1 Variables de entorno**
- Modificar `.env.example` - Agregar placeholders para todas las API keys

**1.2 Supabase admin client**
- Crear `libs/supabase/admin.ts` - Cliente con service role key (bypasea RLS)

**1.3 Migraciones SQL** (`supabase/migrations/`)

| Archivo | Tabla | Descripcion |
|---------|-------|-------------|
| `001_profiles.sql` | `profiles` | Extiende auth.users, trigger auto-create, creditos, plan |
| `002_searches.sql` | `searches` | Busquedas con status enum, parsed_params JSONB |
| `003_leads.sql` | `leads` | Datos de persona + empresa + scoring + source enum |
| `004_lists.sql` | `lists` + `list_items` | Listas de leads con relacion M:N |
| `005_website_cache.sql` | `website_cache` | Cache de scraping web (TTL 7 dias) |

Todas con RLS policies (users solo ven sus propios datos).

**1.4 TypeScript types**
- Crear `types/search.ts` - `SearchStatus`, `ParsedSearchParams`, `Search`
- Crear `types/lead.ts` - `Lead`, `LeadSource`, `LeadConfidence`
- Crear `types/list.ts` - `LeadList`, `ListItem`
- Crear `types/api.ts` - `ApiResponse<T>` generico
- Modificar `types/index.ts` - Re-exportar todo

**1.5 Validacion Zod**
- Crear `libs/validators/search-schema.ts` - Schema para query y parsed params
- Crear `libs/validators/lead-schema.ts` - Schema para scoring y filtros

**Verificacion**: `npm run build` pasa, SQL ejecutado en Supabase, tablas con RLS activo.

---

### Fase 2: AI Query Parser + UI de Busqueda

**Dependencias**: `@anthropic-ai/sdk`, `zustand`

**2.1 Capa de IA**
- Crear `libs/ai/provider.ts` - Factory que detecta API key disponible (Claude > OpenAI)
- Crear `libs/ai/claude-client.ts` - Wrapper Anthropic SDK con retry y error handling
- Crear `libs/ai/openai-client.ts` - Stub inicial
- Crear `libs/ai/prompts/parse-query.ts` - Prompt template para parsear consultas
- Crear `libs/ai/prompts/score-lead.ts` - Prompt template para scoring (usado en Fase 4)
- Crear `libs/ai/query-parser.ts` - Servicio: raw query -> ParsedSearchParams validado con Zod

**2.2 Utilidades**
- Crear `libs/utils/retry.ts` - Retry con exponential backoff
- Crear `libs/utils/rate-limiter.ts` - Rate limiter en memoria

**2.3 API Route**
- Crear `app/api/search/route.ts` - POST: auth -> validar -> parsear con IA -> guardar en DB

**2.4 Estado cliente**
- Crear `stores/search-store.ts` - Zustand store: query, parsedParams, status, acciones

**2.5 Dashboard layout**
- Modificar `app/dashboard/layout.tsx` - Sidebar + header (mantener auth guard)
- Crear `components/layout/sidebar.tsx` - Navegacion: Buscar, Leads, Listas, Historial
- Crear `components/layout/header.tsx` - Header con ButtonAccount
- Crear `components/layout/nav-items.ts` - Items de navegacion

**2.6 Componentes de busqueda**
- Crear `components/search/search-bar.tsx` - Input principal + boton + loading
- Crear `components/search/parsed-params-display.tsx` - Badges visuales de parametros
- Modificar `app/dashboard/page.tsx` - SearchBar + ParsedParamsDisplay

**Verificacion**: Escribir consulta -> IA parsea -> badges de parametros -> guardado en Supabase.

---

### Fase 3: Google Places + Orquestador

**Prerequisito**: API key de Google Places

**3.1 Servicios de datos**
- Crear `libs/services/google-places-service.ts` - Places Text Search API
- Crear `libs/services/google-places-stub.ts` - Mock data para testing sin key
- Crear `libs/services/unipile-service.ts` - Stub inicial, interfaz lista

**3.2 Merger y dedup**
- Crear `libs/services/lead-merger.ts` - Combinar y deduplicar resultados
- Crear `libs/utils/dedup.ts` - Normalizacion y fuzzy matching

**3.3 Orquestador**
- Crear `libs/services/search-orchestrator.ts` - Pipeline: fuentes paralelo -> merge -> guardar

**3.4 API y UI**
- Crear `app/api/search/[id]/route.ts` - GET status de busqueda
- Crear `app/api/search/[id]/leads/route.ts` - GET leads paginados
- Crear `components/search/search-progress.tsx` - Barra de progreso con polling
- Crear `app/dashboard/search/[id]/page.tsx` - Pagina de resultados

**Verificacion**: Busqueda completa -> leads en DB -> resultados visibles.

---

### Fase 4: Tabla de Resultados + Scoring

**4.1 Backend Scoring (COMPLETADO)**
- `libs/ai/lead-scorer.ts` - Servicio de scoring con batch de 10 leads
- `libs/ai/prompts/score-lead.ts` - Prompt actualizado con pesos: Cargo 30%, Ubicacion 25%, Industria 30%, Seniority 15%
- `libs/services/search-executor.ts` - Flujo completo: busqueda + scoring + guardado
- `app/api/search/route.ts` - Ejecuta scoring automatico al buscar
- `app/api/search/[id]/route.ts` - GET estado de busqueda con stats
- `app/api/search/[id]/leads/route.ts` - GET leads con filtros y paginacion (threshold default: 60)
- Tests unitarios para lead-scorer (12 tests pasando)

**4.2 Frontend (PENDIENTE)**
- Lead table interactiva con sort/filter (DaisyUI `table`)
- Score badges con colores (0-59 rojo, 60-79 amarillo, 80-100 verde)
- Panel de detalle de lead (sidebar o modal)
- Export CSV
- Pagina de historial de busquedas

---

### Fase 5: Listas, Enriquecimiento, Polish

- CRUD de listas de leads
- Web scraping con Firecrawl (primario) + Jina.ai (fallback)
- Hunter.io para emails faltantes (solo leads sin email)
- Settings page con status de API keys
- Rate limiting y tracking de uso
- Tests: Vitest (unit/integration) + Playwright (E2E)
- Cobertura minima: 80%
- Loading states y empty states

### E2E Tests (Playwright)
- Flujo completo: login -> busqueda -> ver resultados -> exportar
- Crear lista y agregar leads
- Historial de busquedas

---

### Orden de Ejecucion

| Fase | Cuando | Dependencia |
|------|--------|-------------|
| Fase 1 | Ahora | Proyecto Supabase creado |
| Fase 2 | Despues de Fase 1 | API key Claude |
| Fase 3 | Cuando tenga key | API key Google Places |
| Fase 4 | Despues de Fase 3 | Leads en DB |
| Fase 5 | Final | API keys Firecrawl, Hunter.io |


## 11. Decisiones Clave y Trade-offs

| Decision | Razon |
|---|---|
| Next.js App Router | SSR para SEO, API routes integradas, streaming para progreso |
| Supabase vs Prisma+PG | Supabase ofrece auth, realtime, dashboard - todo integrado |
| Claude primario + OpenAI fallback | Claude es mejor en espanol y en instrucciones complejas. OpenAI como backup |
| Polling vs WebSockets para progreso | Polling simple con GET /api/search/[id]. Supabase Realtime como mejora futura |
| Hunter.io solo para emails faltantes | Minimiza costo - solo se llama cuando Unipile no tiene email |
| Cache en Supabase | Los leads no cambian rapido. Cache 24h reduce llamadas a APIs |
| Scoring en batch | Enviar hasta 10 leads por request a Claude reduce latencia total |
| DaisyUI 5 | Componentes accesibles sobre Tailwind, temas CSS, sin vendor lock-in |

---

## 12. Estimacion de Costos por Busqueda

| Servicio | Costo aproximado por busqueda (50 leads) |
|---|---|
| Unipile | Incluido en suscripcion (~49 EUR/mes) |
| Google Places | ~$0.50 (20 requests x $0.025) |
| Hunter.io | ~20 de 25 gratis/mes (o $0.10/email en plan pago) |
| Claude API | ~$0.05 (parsing + scoring 50 leads) |
| OpenAI (fallback) | ~$0.03 (solo si Claude falla) |
| **Total por busqueda** | **~$0.55 + suscripciones fijas** |

---

## 13. Diagrama de Componentes UI

```
+----------------------------------------------------------+
|  Header: Logo | Search Bar                    | User Menu |
+----------------------------------------------------------+
|         |                                                 |
| Sidebar |  Main Content                                   |
|         |                                                 |
|  Search |  [Search Results Page]                          |
|  Leads  |  +-------------------------------------------+  |
|  Lists  |  | Filters: Score | Source | Location | ...  |  |
|  History|  +-------------------------------------------+  |
|  Settings| | Lead Table                                 |  |
|         |  | Name | Company | Title | Email | Score    |  |
|         |  | ---  | ---     | ---   | ---   | ---      |  |
|         |  | ...  | ...     | ...   | ...   | [85]     |  |
|         |  +-------------------------------------------+  |
|         |  | Pagination                    | Export CSV |  |
|         |  +-------------------------------------------+  |
+----------------------------------------------------------+
```
