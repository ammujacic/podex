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

# Copy built assets
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
