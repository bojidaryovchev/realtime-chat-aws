import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { prisma } from "@realtime-chat/database";
import { createRedisClient } from "./lib/redis.js";
import { setupSocketHandlers } from "./socket/handlers.js";
import { loggerOptions } from "./lib/logger.js";

const PORT = parseInt(process.env.PORT || "3002", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  const fastify = Fastify({
    logger: loggerOptions,
    trustProxy: true,
  });

  // Security plugins
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  });

  // Decorate with Prisma client
  fastify.decorate("prisma", prisma);

  // Initialize Redis client
  const redis = createRedisClient();
  fastify.decorate("redis", redis);

  // Health check endpoint (for ALB)
  fastify.get("/health", async () => {
    // Test database connectivity
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", timestamp: new Date().toISOString(), service: "realtime" };
  });

  // Start HTTP server
  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`Realtime HTTP server listening on ${HOST}:${PORT}`);

  // Initialize Socket.IO with Redis adapter
  const io = new SocketIOServer(fastify.server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
      credentials: true,
    },
    pingTimeout: parseInt(process.env.SOCKET_IO_PING_TIMEOUT || "30000", 10),
    pingInterval: parseInt(process.env.SOCKET_IO_PING_INTERVAL || "25000", 10),
    transports: ["websocket", "polling"],
    allowUpgrades: true,
    path: "/socket.io/",
  });

  // Setup Redis adapter for horizontal scaling
  if (process.env.SOCKET_IO_ADAPTER === "redis") {
    // Use REDIS_ADAPTER_HOST for split Redis mode, otherwise fall back to REDIS_HOST
    const adapterHost = process.env.REDIS_ADAPTER_HOST || process.env.REDIS_HOST;
    const redisPort = process.env.REDIS_PORT || "6379";
    const redisPassword = process.env.REDIS_PASSWORD;
    const useTls = process.env.REDIS_TLS === "true";

    const pubClient = createClient({
      url: `redis${useTls ? "s" : ""}://${adapterHost}:${redisPort}`,
      password: redisPassword || undefined,
    });
    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));
    fastify.log.info(`Socket.IO Redis adapter initialized (host: ${adapterHost})`);
  }

  // Setup socket handlers
  setupSocketHandlers(io, prisma, redis);

  fastify.log.info("Socket.IO server initialized");

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      fastify.log.info(`Received ${signal}, shutting down...`);
      
      // Close Socket.IO connections
      io.close();
      
      await fastify.close();
      await prisma.$disconnect();
      await redis.quit();
      process.exit(0);
    });
  });
}

main();
