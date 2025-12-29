FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/workers/package.json ./apps/workers/
COPY packages/database/package.json ./packages/database/
RUN pnpm install --frozen-lockfile --filter @realtime-chat/workers...

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/workers/node_modules ./apps/workers/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY . .
RUN pnpm --filter @realtime-chat/database generate
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

EXPOSE 3002
CMD ["node", "dist/index.js"]
