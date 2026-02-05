/**
 * Rate Limiter para APIs externas
 * Controla la frecuencia de peticiones para evitar baneos
 */

interface RateLimitConfig {
  maxRequestsPerHour: number
  maxRequestsPerDay: number
  minDelayBetweenRequests: number // en ms
}

interface RateLimitState {
  hourlyCount: number
  dailyCount: number
  hourlyResetAt: number
  dailyResetAt: number
  lastRequestAt: number
}

interface RateLimitResult {
  allowed: boolean
  waitMs: number
  reason?: string
  stats: {
    hourlyRemaining: number
    dailyRemaining: number
    nextResetIn: number // ms hasta el proximo reset horario
  }
}

// Estado en memoria por servicio
const rateLimitStates = new Map<string, RateLimitState>()

// Configuraciones predefinidas por servicio
export const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  // ============================================================
  // UNIPILE (LinkedIn Sales Navigator)
  // ============================================================

  // Test: Limites para desarrollo y pruebas
  // Sin delay artificial - Unipile ya maneja rate limiting de LinkedIn
  'unipile-test': {
    maxRequestsPerHour: 30,
    maxRequestsPerDay: 100,
    minDelayBetweenRequests: 0 // Sin delay - Unipile lo maneja
  },

  // Dev: Limites para desarrollo activo
  // Usar cuando: probando flujos completos, debugging
  'unipile-dev': {
    maxRequestsPerHour: 10,
    maxRequestsPerDay: 50,
    minDelayBetweenRequests: 5000 // 5 segundos
  },

  // Production: Limites seguros para usuarios reales
  // Usar cuando: app en produccion con usuarios
  // ~15/hora = 1 busqueda cada 4 min promedio (parece humano)
  // ~100/dia = suficiente para uso activo sin parecer bot
  'unipile-production': {
    maxRequestsPerHour: 15,
    maxRequestsPerDay: 100,
    minDelayBetweenRequests: 3000 // 3 segundos
  },

  // ============================================================
  // GOOGLE PLACES
  // ============================================================

  // Google Places es mas permisivo (API de pago por uso)
  'google-places': {
    maxRequestsPerHour: 100,
    maxRequestsPerDay: 1000,
    minDelayBetweenRequests: 100
  },

  // ============================================================
  // HUNTER.IO
  // ============================================================

  // Hunter.io plan free: 25 busquedas/mes
  // Ser muy conservador aqui
  'hunter': {
    maxRequestsPerHour: 5,
    maxRequestsPerDay: 25,
    minDelayBetweenRequests: 1000
  }
}

// ============================================================
// HELPERS PARA SELECCION DINAMICA DE PERFIL
// ============================================================

export type UnipileRateLimitMode = 'test' | 'dev' | 'production'

/**
 * Obtiene el service ID de Unipile basado en el modo configurado.
 * Lee de la variable de entorno UNIPILE_RATE_LIMIT_MODE.
 * Default: 'test' (el mas conservador)
 */
export function getUnipileServiceId(): string {
  const mode = (process.env.UNIPILE_RATE_LIMIT_MODE ?? 'test') as UnipileRateLimitMode
  const validModes: UnipileRateLimitMode[] = ['test', 'dev', 'production']

  if (!validModes.includes(mode)) {
    console.warn(`UNIPILE_RATE_LIMIT_MODE invalido: "${mode}". Usando "test".`)
    return 'unipile-test'
  }

  return `unipile-${mode}`
}

/**
 * Obtiene la configuracion actual de Unipile para mostrar al usuario.
 */
export function getUnipileRateLimitConfig(): RateLimitConfig & { mode: string } {
  const serviceId = getUnipileServiceId()
  const config = RATE_LIMIT_CONFIGS[serviceId]
  const mode = serviceId.replace('unipile-', '')

  return {
    ...config,
    mode
  }
}

function getInitialState(): RateLimitState {
  const now = Date.now()
  return {
    hourlyCount: 0,
    dailyCount: 0,
    hourlyResetAt: now + 60 * 60 * 1000, // 1 hora
    dailyResetAt: now + 24 * 60 * 60 * 1000, // 24 horas
    lastRequestAt: 0
  }
}

function getState(serviceId: string): RateLimitState {
  if (!rateLimitStates.has(serviceId)) {
    rateLimitStates.set(serviceId, getInitialState())
  }

  const state = rateLimitStates.get(serviceId)!
  const now = Date.now()

  // Reset contadores si ha pasado el tiempo
  if (now >= state.hourlyResetAt) {
    state.hourlyCount = 0
    state.hourlyResetAt = now + 60 * 60 * 1000
  }

  if (now >= state.dailyResetAt) {
    state.dailyCount = 0
    state.dailyResetAt = now + 24 * 60 * 60 * 1000
  }

  return state
}

/**
 * Verifica si una peticion esta permitida segun los rate limits
 */
export function checkRateLimit(
  serviceId: string,
  config?: RateLimitConfig
): RateLimitResult {
  const effectiveConfig = config ?? RATE_LIMIT_CONFIGS[serviceId]

  if (!effectiveConfig) {
    throw new Error(`No rate limit config found for service: ${serviceId}`)
  }

  const state = getState(serviceId)
  const now = Date.now()

  // Calcular estadisticas
  const stats = {
    hourlyRemaining: Math.max(0, effectiveConfig.maxRequestsPerHour - state.hourlyCount),
    dailyRemaining: Math.max(0, effectiveConfig.maxRequestsPerDay - state.dailyCount),
    nextResetIn: state.hourlyResetAt - now
  }

  // Verificar limite diario
  if (state.dailyCount >= effectiveConfig.maxRequestsPerDay) {
    return {
      allowed: false,
      waitMs: state.dailyResetAt - now,
      reason: `Limite diario alcanzado (${effectiveConfig.maxRequestsPerDay}). Reset en ${Math.ceil((state.dailyResetAt - now) / 1000 / 60)} minutos.`,
      stats
    }
  }

  // Verificar limite horario
  if (state.hourlyCount >= effectiveConfig.maxRequestsPerHour) {
    return {
      allowed: false,
      waitMs: state.hourlyResetAt - now,
      reason: `Limite horario alcanzado (${effectiveConfig.maxRequestsPerHour}). Reset en ${Math.ceil((state.hourlyResetAt - now) / 1000 / 60)} minutos.`,
      stats
    }
  }

  // Verificar delay minimo entre peticiones
  const timeSinceLastRequest = now - state.lastRequestAt
  if (timeSinceLastRequest < effectiveConfig.minDelayBetweenRequests) {
    const waitMs = effectiveConfig.minDelayBetweenRequests - timeSinceLastRequest
    return {
      allowed: false,
      waitMs,
      reason: `Espera ${Math.ceil(waitMs / 1000)} segundos entre peticiones.`,
      stats
    }
  }

  return { allowed: true, waitMs: 0, stats }
}

/**
 * Registra una peticion realizada (incrementa contadores)
 */
export function recordRequest(serviceId: string): void {
  const state = getState(serviceId)
  state.hourlyCount++
  state.dailyCount++
  state.lastRequestAt = Date.now()
}

/**
 * Espera si es necesario y luego registra la peticion
 * Util para hacer rate limiting automatico
 */
export async function waitForRateLimit(
  serviceId: string,
  config?: RateLimitConfig
): Promise<RateLimitResult> {
  const result = checkRateLimit(serviceId, config)

  if (!result.allowed && result.waitMs > 0 && result.waitMs < 60000) {
    // Solo espera automaticamente si es menos de 1 minuto
    await new Promise(resolve => setTimeout(resolve, result.waitMs))
    return checkRateLimit(serviceId, config)
  }

  return result
}

/**
 * Obtiene las estadisticas actuales de rate limiting
 */
export function getRateLimitStats(serviceId: string): RateLimitResult['stats'] | null {
  const config = RATE_LIMIT_CONFIGS[serviceId]
  if (!config) return null

  const state = getState(serviceId)
  const now = Date.now()

  return {
    hourlyRemaining: Math.max(0, config.maxRequestsPerHour - state.hourlyCount),
    dailyRemaining: Math.max(0, config.maxRequestsPerDay - state.dailyCount),
    nextResetIn: state.hourlyResetAt - now
  }
}

/**
 * Resetea los contadores de un servicio (solo para testing)
 */
export function resetRateLimits(serviceId: string): void {
  rateLimitStates.delete(serviceId)
}
