import { FastifyInstance } from "fastify";

export async function healthRoutes(fastify: FastifyInstance) {
  // Basic health check for ALB
  fastify.get("/", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // Detailed health check
  fastify.get("/detailed", async (request, reply) => {
    const checks: Record<string, { status: string; latency?: number; error?: string }> = {};

    // Check database
    const dbStart = Date.now();
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: "ok", latency: Date.now() - dbStart };
    } catch (err) {
      checks.database = {
        status: "error",
        latency: Date.now() - dbStart,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }

    // Check Redis
    const redisStart = Date.now();
    try {
      await fastify.redis.ping();
      checks.redis = { status: "ok", latency: Date.now() - redisStart };
    } catch (err) {
      checks.redis = {
        status: "error",
        latency: Date.now() - redisStart,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }

    const allHealthy = Object.values(checks).every((c) => c.status === "ok");

    reply.code(allHealthy ? 200 : 503);
    return {
      status: allHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      checks,
    };
  });
}
