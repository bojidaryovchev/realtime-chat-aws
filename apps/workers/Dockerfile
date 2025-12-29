# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files for workspace
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY tsconfig.base.json ./

# Copy shared database package
COPY packages/database/package*.json ./packages/database/
COPY packages/database/prisma ./packages/database/prisma/
COPY packages/database/prisma.config.ts ./packages/database/
COPY packages/database/src ./packages/database/src/
COPY packages/database/tsconfig.json ./packages/database/

# Copy shared common package
COPY packages/common/package*.json ./packages/common/
COPY packages/common/src ./packages/common/src/
COPY packages/common/tsconfig.json ./packages/common/

# Copy workers app package files
COPY apps/workers/package*.json ./apps/workers/
COPY apps/workers/tsconfig.json ./apps/workers/
COPY apps/workers/src ./apps/workers/src/

# Install pnpm
RUN npm install -g pnpm

# Install all dependencies
RUN pnpm install

# Generate Prisma client
RUN cd packages/database && pnpm prisma generate

# Build shared packages
RUN cd packages/common && pnpm build
RUN cd packages/database && pnpm build

# Build workers
RUN cd apps/workers && pnpm build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Add non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 workers

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/database/package*.json ./packages/database/
COPY --from=builder /app/packages/common/package*.json ./packages/common/
COPY --from=builder /app/apps/workers/package*.json ./apps/workers/

# Install production dependencies
RUN pnpm install --prod

# Copy Prisma schema and generated client
COPY --from=builder /app/packages/database/prisma ./packages/database/prisma/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma/
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma/

# Copy built shared packages
COPY --from=builder /app/packages/database/dist ./packages/database/dist/
COPY --from=builder /app/packages/common/dist ./packages/common/dist/

# Copy built workers files
COPY --from=builder /app/apps/workers/dist ./apps/workers/dist/

# Set ownership
RUN chown -R workers:nodejs /app

USER workers

WORKDIR /app/apps/workers

# Expose port
EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:3003/health || exit 1

# Start the server
CMD ["node", "dist/index.js"]
