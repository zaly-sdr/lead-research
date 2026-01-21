# IA LAB — TypeScript

Plantilla SaaS Next.js 15+ con TypeScript, Stripe, Supabase y TailwindCSS.

## Comenzar

1. Clona el repositorio y ejecuta tu servidor local:

```bash
npm install
npm run dev
```

2. Configura las variables de entorno en `.env.local`

## Stack Tecnologico

- **Framework**: Next.js 15+ con App Router
- **Lenguaje**: TypeScript 5.9+
- **Base de datos**: Supabase (PostgreSQL)
- **Autenticacion**: Supabase Auth con Google OAuth
- **Pagos**: Stripe con webhooks
- **Estilos**: TailwindCSS 4.1+ con DaisyUI 5.0+
- **Emails**: Resend para emails transaccionales
- **Blog**: Soporte MDX para contenido

## Estructura del Proyecto

```
app/                    # Paginas y rutas de API
components/             # Componentes React
libs/                   # Utilidades y configuracion
  supabase/             # Clientes de Supabase
  stripe.ts             # Integracion de Stripe
  seo.tsx               # Funciones de SEO
types/                  # Tipos TypeScript
config.ts               # Configuracion de la app
```

## Variables de Entorno

Crea un archivo `.env.local` con las siguientes variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
```

## Comandos

- `npm run dev` - Servidor de desarrollo
- `npm run build` - Construir para produccion
- `npm start` - Ejecutar en produccion
- `npm run lint` - Verificar codigo
