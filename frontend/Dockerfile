FROM node:22-alpine AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Dev runner — source is bind-mounted at runtime, not baked in
FROM base AS dev
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=development
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
EXPOSE 3000
# Install deps and generate Prisma client on each start (fast when node_modules volume is warm)
CMD ["sh", "-c", "npm install && npx prisma generate && npm run dev"]

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Accept build-time env vars so Next.js can inline NEXT_PUBLIC_* values
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG BETTER_AUTH_URL=http://localhost:3000
ARG BACKEND_INTERNAL_URL=http://localhost:8000
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV BETTER_AUTH_URL=${BETTER_AUTH_URL}
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}

RUN npx prisma generate
RUN npm run build

# Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
