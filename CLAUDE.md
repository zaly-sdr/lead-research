## Project Overview

[Brief description of your project - what it does, tech stack]

## Critical Rules

### 1. Code Organization

- Many small files over few large files
- High cohesion, low coupling
- 200-400 lines typical, 800 max per file
- Organize by feature/domain, not by type

### 2. Code Style

- No emojis in code, comments, or documentation
- Immutability always - never mutate objects or arrays
- No console.log in production code
- Proper error handling with try/catch
- Input validation with Zod or similar
- Always refer to skills/vercel-next-best-practices/SKILL.md to apply best Next JS practice and approach when creating new components or updating them



### 3. Testing

- TDD: Write tests first
- 80% minimum coverage
- Unit tests for utilities
- Integration tests for APIs
- E2E tests for critical flows

### 4. Security

- No hardcoded secrets
- Environment variables for sensitive data
- Validate all user inputs
- Parameterized queries only
- CSRF protection enabled

## File Structure

```
app/
├── api/
│   ├── auth/callback/route.ts
│   ├── stripe/
│   │   ├── create-checkout/route.ts
│   │   └── create-portal/route.ts
│   └── webhook/stripe/route.ts
├── blog/[articleId]/page.tsx
├── dashboard/
│   ├── layout.tsx
│   └── page.tsx
├── globals.css
└── layout.tsx

components/
├── ButtonCheckout.tsx
├── ButtonSignin.tsx
└── LayoutClient.tsx

libs/
├── supabase/
│   ├── client.ts
│   └── server.ts
├── stripe.ts
└── resend.ts
```

## Key Patterns

### API Response Format

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}
```

### Error Handling

```typescript
try {
  const result = await operation()
  return { success: true, data: result }
} catch (error) {
  console.error('Operation failed:', error)
  return { success: false, error: 'User-friendly message' }
}
```

## Environment Variables

```bash
# Required
DATABASE_URL=
API_KEY=

# Optional
DEBUG=false
```

## Available Commands

- `/tdd` - Test-driven development workflow
- `/plan` - Create implementation plan
- `/code-review` - Review code quality
- `/build-fix` - Fix build errors

## Git Workflow

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- Never commit to main directly
- PRs require review
- All tests must pass before merge

## Estructura de Archivos Que Debes Seguir

## Cuando Usar Cada Patron

### Usar Componentes de Servidor Cuando:
- Obtengas datos de base de datos/API
- Manejes verificaciones de autenticacion
- Generes metadata
- Renderices contenido estatico

### Usar Componentes de Cliente Cuando:
- Manejes interacciones de usuario (clics, inputs de formulario)
- Gestiones estado local
- Uses APIs del navegador
- Funcionalidades en tiempo real

### Usar Rutas de API Cuando:
- Manejes envios de formularios
- Endpoints de webhook
- Operaciones del lado del servidor
- Mutaciones de base de datos

## Consideraciones de Testing

### Comando de Test de Build
Siempre testea que el proyecto construya exitosamente:
```bash
npm run build
```

### Errores Comunes de Build a Vigilar:
1. Falta de `await` en APIs asincronas de Next.js 15
2. Tipado incorrecto de `params` en rutas dinamicas
3. Problemas de limites entre componentes Cliente/Servidor
4. Variables de entorno faltantes
5. Errores de configuracion de Tailwind CSS
