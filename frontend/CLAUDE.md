# CLAUDE.md — Frontend

## Tech Stack
- **Next.js 16** (App Router), **React 19**, **TypeScript 5**
- **Tailwind CSS 4** — configured via `@theme` in `src/app/globals.css` (no `tailwind.config.ts`)
- **Better Auth 1.x** with Prisma adapter for authentication
- **React Query v5** (`@tanstack/react-query`) for all data fetching and server state
- **next-intl 4.x** for i18n — `localePrefix: "never"`, all strings in `src/messages/en.json`
- **Shadcn UI** components hand-copied into `src/components/ui/` (do not use CLI)
- **Prisma** for auth DB schema only (`ba_*` prefixed tables)
- **Package manager**: npm

## Project Structure
```
src/
├── app/
│   ├── layout.tsx                  # Root layout: ThemeProvider, NextIntlClientProvider, QueryProvider
│   ├── globals.css                 # Tailwind @theme config + CSS variables (light/dark)
│   ├── (auth)/login/               # Login page (public)
│   └── (dashboard)/
│       ├── layout.tsx              # Dashboard layout: CustomerProvider → SidebarProvider
│       └── page.tsx                # Home/dashboard page
├── components/
│   ├── ui/                         # Shadcn UI primitives (sidebar, button, input, badge, etc.)
│   ├── layout/
│   │   ├── app-sidebar.tsx         # Main sidebar: logo, CustomerSwitcher, tasks, user menu
│   │   ├── sidebar-tasks.tsx       # Task list with polling (10s active, 30s idle)
│   │   ├── topbar.tsx              # Top bar with route title
│   │   └── theme-toggle.tsx        # Light/dark/system toggle
│   ├── dashboard/
│   │   └── task-dashboard.tsx      # Main dashboard task view
│   ├── auth/
│   │   └── login-form.tsx          # Login form component
│   └── providers/
│       ├── query-provider.tsx      # React Query client provider
│       └── customer-provider.tsx   # Active customer context + localStorage persistence
├── lib/
│   ├── api.ts                      # FastAPI client (server: BACKEND_INTERNAL_URL, client: /backend/)
│   ├── auth.ts                     # Better Auth server config
│   ├── auth-client.ts              # Better Auth client (useSession, signIn, signOut)
│   └── utils.ts                    # cn() and helpers
├── messages/
│   └── en.json                     # All UI strings
├── i18n/
│   └── routing.ts                  # next-intl routing config
└── middleware.ts                   # Auth guard: redirects unauthenticated users to /login
```

## Common Commands
```bash
npm run dev               # start dev server (port 3000)
npm run build             # production build
npm run db:migrate        # prisma migrate dev
npm run db:generate       # prisma generate
```

## Key Conventions

### Styling
- Use CSS variables for theming: `text-[var(--foreground)]`, `bg-[var(--sidebar-accent)]`, etc.
- Tailwind tokens defined in `globals.css` `@theme {}` block — not `tailwind.config.ts`
- Sidebar collapse state: use `group-data-[collapsible=icon]:hidden` to hide text when collapsed
- Topbar height: `var(--topbar-height, 3.5rem)`, sidebar width: `var(--sidebar-width)` (16rem)

### Data Fetching
- All FastAPI calls go through `src/lib/api.ts` — server-side uses `BACKEND_INTERNAL_URL`, client-side routes via `/backend/api/v1/...` (Next.js rewrite)
- Use React Query for all data fetching — never raw `fetch` in components
- Query keys: `["customers"]`, `["tasks"]`

### i18n
- Every user-facing string must live in `src/messages/en.json`
- Access with `useTranslations("namespace")` then `t("key")`
- Never hardcode English strings in components

### Auth
- Server config: `src/lib/auth.ts` — uses `prismaAdapter` from `"better-auth/adapters/prisma"`
- Client hooks: `useSession`, `signIn`, `signOut` re-exported from `src/lib/auth-client.ts`
- Auth route handler: `src/app/api/auth/[...all]/route.ts`
- Prisma schema: `prisma/schema.prisma` — only auth tables, all prefixed `ba_`

### Customer Context
- `useCustomer()` from `src/components/providers/customer-provider.tsx`
- Returns: `{ customers, sortedCustomers, activeCustomer, setActiveCustomer }`
- Active customer persisted to `localStorage` under key `gorm:activeCustomerId`
- `CustomerProvider` lives in `(dashboard)/layout.tsx` — available to all dashboard pages

### Adding a New Page
1. Create route in `src/app/(dashboard)/your-route/page.tsx`
2. Add route title to `ROUTE_TITLE_MAP` in `src/components/layout/topbar.tsx`
3. Add nav entry to `NAV_ITEMS` / `PREDICTION_ITEMS` / `CONFIG_ITEMS` in `app-sidebar.tsx`
4. Add translation key to `src/messages/en.json` under `"nav"`

### Adding a New API Call
1. Add type interfaces to `src/lib/api.ts`
2. Add method to the appropriate `*Api` object (or create a new one)
3. Use `useQuery` / `useMutation` in the component

## Environment Variables
```
DATABASE_URL              # PostgreSQL (no +asyncpg prefix) — used by Prisma only
BACKEND_INTERNAL_URL      # Internal FastAPI URL (server-side only, e.g. http://app:8000)
NEXT_PUBLIC_APP_URL       # Public URL (e.g. http://localhost:3000)
BETTER_AUTH_URL           # Same as NEXT_PUBLIC_APP_URL
BETTER_AUTH_SECRET        # Auth signing secret
GOOGLE_CLIENT_ID/SECRET   # Google OAuth
MICROSOFT_CLIENT_ID/SECRET/TENANT_ID  # Microsoft OAuth
```

## Docker
- Dev mode: `target: dev` in `docker-compose.yml` — runs `npm run dev` with `WATCHPACK_POLLING=true`
- Source volumes mounted for hot reload: `./frontend/src`, `./frontend/public`, `./frontend/prisma`
- `node_modules` stays inside the container (not volume-mounted)
- Rebuild after adding dependencies: `docker compose up -d --build frontend`
