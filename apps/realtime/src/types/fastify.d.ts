import type { prisma } from "@realtime-chat/database";
import type Redis from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    prisma: typeof prisma;
    redis: Redis;
  }
}
