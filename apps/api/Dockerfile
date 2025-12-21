# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Copy root package files for workspace
COPY package*.json ./
COPY pnpm-workspace.yaml ./
COPY tsconfig.base.json ./

# Copy shared database package
COPY packages/database/package*.json ./packages/database/
COPY packages/database/prisma ./packages/database/prisma/
COPY packages/database/src ./packages/database/src/
COPY packages/database/tsconfig.json ./packages/database/

# Copy API app package files
COPY apps/api/package*.json ./apps/api/
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src/

# Install pnpm
RUN npm install -g pnpm

# Install all dependencies
RUN pnpm install

# Generate Prisma client
RUN cd packages/database && pnpm prisma generate

# Build shared package
RUN cd packages/database && pnpm build

# Build API
RUN cd apps/api && pnpm build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install OpenSSL for Prisma runtime
RUN apk add --no-cache openssl

# Add non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 fastify

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/database/package*.json ./packages/database/
COPY --from=builder /app/apps/api/package*.json ./apps/api/

# Install production dependencies
RUN pnpm install --prod

# Copy Prisma schema and generated client
COPY --from=builder /app/packages/database/prisma ./packages/database/prisma/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma/
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma/

# Copy built shared package
COPY --from=builder /app/packages/database/dist ./packages/database/dist/

# Copy built API files
COPY --from=builder /app/apps/api/dist ./apps/api/dist/

# Set ownership
RUN chown -R fastify:nodejs /app

USER fastify

WORKDIR /app/apps/api

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "dist/index.js"]
