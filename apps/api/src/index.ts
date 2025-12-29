import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import sensible from "@fastify/sensible";
import { prisma } from "@realtime-chat/database";
import Fastify from "fastify";
import authPlugin from "./lib/authPlugin.js";
import { loggerOptions } from "./lib/logger.js";
import { createRedisClient } from "./lib/redis.js";
import { conversationRoutes } from "./routes/conversations.js";
import { healthRoutes } from "./routes/health.js";
import { messageRoutes } from "./routes/messages.js";
import { userRoutes } from "./routes/users.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  const fastify = Fastify({
    logger: loggerOptions,
    trustProxy: true, // Behind ALB
  });

  // Security plugins
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  });
  await fastify.register(sensible);

  // Auth plugin (provides fastify.authenticate decorator)
  await fastify.register(authPlugin);

  // Decorate with Prisma client
  fastify.decorate("prisma", prisma);

  // Initialize Redis client
  const redis = createRedisClient();
  fastify.decorate("redis", redis);

  // Register routes
  // All routes are prefixed with /api to match ALB path-based routing
  await fastify.register(healthRoutes, { prefix: "/api/health" });
  await fastify.register(userRoutes, { prefix: "/api/users" });
  await fastify.register(conversationRoutes, { prefix: "/api/conversations" });
  await fastify.register(messageRoutes, { prefix: "/api/messages" });

  // Root health check for ALB target group (expects /health)
  await fastify.register(healthRoutes, { prefix: "/health" });

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      fastify.log.info(`Received ${signal}, shutting down...`);
      await fastify.close();
      await prisma.$disconnect();
      await redis.quit();
      process.exit(0);
    });
  });

  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`API server listening on ${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
