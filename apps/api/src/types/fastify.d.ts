import type { prisma } from "@realtime-chat/database";
import type { FastifyReply } from "fastify";
import type Redis from "ioredis";
import type { JWTPayload } from "@realtime-chat/auth";

// Augment Fastify's types
declare module "fastify" {
  interface FastifyRequest {
    user?: JWTPayload;
  }

  interface FastifyInstance {
    prisma: typeof prisma;
    redis: Redis;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
