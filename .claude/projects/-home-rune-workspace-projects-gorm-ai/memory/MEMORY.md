# Gorm AI Project Memory

## Project Overview
- **Backend**: FastAPI + PostgreSQL/TimescaleDB + Celery/Redis at `/home/rune/workspace/projects/gorm.ai/`
- **Frontend**: Next.js 16 at `/home/rune/workspace/projects/gorm.ai/frontend/`
- **Package manager**: npm (frontend), uv (backend)

## Frontend Stack (built 2026-03-05)
- Next.js 16.1.6, React 19, TypeScript 5, App Router
- Tailwind CSS 4 (PostCSS, no tailwind.config.ts — configured via @theme in globals.css)
- Better Auth 1.x with Prisma adapter (`@better-auth/prisma-adapter` — separate package needed!)
- Shadcn UI components (hand-copied into src/components/ui/, not via CLI)
- next-intl 4.x with localePrefix: "never", all text in src/messages/en.json
- React Query v5 for data fetching + polling

## Key Paths
- Frontend entry: `frontend/src/app/layout.tsx`
- Auth config: `frontend/src/lib/auth.ts` (server), `frontend/src/lib/auth-client.ts` (client)
- API client: `frontend/src/lib/api.ts` (FastAPI typed wrapper)
- Sidebar: `frontend/src/components/layout/app-sidebar.tsx`
- Dashboard: `frontend/src/components/dashboard/task-dashboard.tsx`
- i18n strings: `frontend/src/messages/en.json`
- Prisma schema: `frontend/prisma/schema.prisma` (ba_* prefixed tables for auth only)

## DB Notes
- Backend uses `postgresql+asyncpg://gorm:gorm@localhost:5433/gorm_ai`
- Prisma (frontend auth) uses `postgresql://gorm:gorm@localhost:5433/gorm_ai` (no +asyncpg!)
- Inside Docker: port 5432, service name `db`
- Better Auth tables prefixed `ba_` to avoid collision with backend tables

## Common Commands (frontend/)
```bash
npm run dev               # start dev server
npm run build             # production build
npm run db:migrate        # prisma migrate dev
npm run db:generate       # prisma generate
```

## Better Auth Import
- Adapter: `import { prismaAdapter } from "better-auth/adapters/prisma"` (requires `@better-auth/prisma-adapter` installed separately)
- Client: `import { createAuthClient } from "better-auth/react"`
- Next.js handler: `import { toNextJsHandler } from "better-auth/next-js"`
- 2FA plugin: `import { twoFactor } from "better-auth/plugins"` + `twoFactorClient` from `"better-auth/client/plugins"`

## Architecture
- Better Auth route: `/api/auth/[...all]`
- FastAPI proxied via Next.js rewrite: client → `/backend/api/v1/...` → FastAPI
- Server-side FastAPI calls: `BACKEND_INTERNAL_URL/api/v1/...` directly
- Task polling: 10s when running tasks exist, 30s otherwise
- Log dir: `../log/frontend.log` (same dir as backend: `log/`)

## Planned Features
- [Price History Covariates](project_price_history_covariates.md) — implemented 2026-03-31: historical price timeline for Ridge regression
- [Customer Health Check](project_customer_health_check.md) — onboarding report for new customers: data viability, dead outlets, coverage gaps
