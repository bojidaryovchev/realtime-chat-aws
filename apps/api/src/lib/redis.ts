import { Redis } from "ioredis";

export function createRedisClient(): Redis {
  const host = process.env.REDIS_HOST || "localhost";
  const port = parseInt(process.env.REDIS_PORT || "6379", 10);
  const useTls = process.env.REDIS_TLS === "true";

  const redis = new Redis({
    host,
    port,
    tls: useTls ? {} : undefined,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  redis.on("connect", () => {
    console.log("Redis connected");
  });

  redis.on("error", (err: Error) => {
    console.error("Redis error:", err);
  });

  return redis;
}

export type RedisClient = Redis;
