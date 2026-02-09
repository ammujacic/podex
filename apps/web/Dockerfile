# Base Node.js image
FROM node:20-alpine AS base

# Install pnpm (matches package.json packageManager field)
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

WORKDIR /app

# Development stage
FROM base AS development

# Copy workspace config files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json ./

# Copy all package.json files for workspace resolution
COPY apps/web/package.json ./apps/web/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/shared/package.json ./packages/shared/
COPY packages/state/package.json ./packages/state/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies (--filter installs workspace dependencies too)
# Use --no-frozen-lockfile in development to allow updates if needed
RUN pnpm install --filter @podex/web...

# Copy source files
COPY apps/web ./apps/web
COPY packages ./packages

WORKDIR /app/apps/web

# Start dev server
CMD ["pnpm", "dev"]

# Builder stage
FROM base AS builder

# Copy workspace config files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json ./

# Copy all package.json files
COPY apps/web/package.json ./apps/web/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/shared/package.json ./packages/shared/
COPY packages/state/package.json ./packages/state/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies
RUN pnpm install --filter @podex/web...

# Copy source
COPY apps/web ./apps/web
COPY packages ./packages

WORKDIR /app/apps/web

# Build in production mode for full optimizations (minification, tree-shaking, etc.)
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Production stage
FROM base AS production

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

WORKDIR /app

# Copy built assets from standalone output
# In monorepo, standalone preserves the directory structure
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

# Health check for container orchestration (Traefik/Caddy/Coolify)
# Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues in Alpine
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# server.js is at apps/web/server.js in monorepo standalone output
CMD ["node", "apps/web/server.js"]
