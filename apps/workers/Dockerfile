FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/workers/package.json ./apps/workers/
COPY packages/database/package.json ./packages/database/
COPY packages/common/package.json ./packages/common/
RUN pnpm install --frozen-lockfile --filter @realtime-chat/workers...

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/workers/node_modules ./apps/workers/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/common/node_modules ./packages/common/node_modules
COPY . .
RUN pnpm --filter @realtime-chat/database generate
RUN pnpm --filter @realtime-chat/common build
RUN pnpm --filter @realtime-chat/workers build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 workers
USER workers

COPY --from=builder --chown=workers:nodejs /app/apps/workers/dist ./dist
COPY --from=builder --chown=workers:nodejs /app/apps/workers/node_modules ./node_modules
COPY --from=builder --chown=workers:nodejs /app/packages/database ./packages/database
COPY --from=builder --chown=workers:nodejs /app/packages/common/dist ./packages/common/dist
COPY --from=builder --chown=workers:nodejs /app/packages/common/package.json ./packages/common/

EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:3003/health || exit 1

CMD ["node", "dist/index.js"]
