import { Redis } from "ioredis";

export type RedisClient = Redis;

export interface RedisConfig {
  host?: string;
  port?: number;
  password?: string;
  tls?: boolean;
  url?: string;
  lazyConnect?: boolean;
  keyPrefix?: string;
}

/**
 * Creates a configured ioredis client.
 * 
 * Supports both URL-based and individual parameter configuration.
 * Includes sensible defaults for retry strategy and error handling.
 * 
 * @example
 * // From environment variables (default)
 * const redis = createRedisClient();
 * 
 * // With explicit config
 * const redis = createRedisClient({ host: 'localhost', port: 6379 });
 * 
 * // With URL
 * const redis = createRedisClient({ url: 'redis://localhost:6379' });
 */
export function createRedisClient(config: RedisConfig = {}): RedisClient {
  // Support URL-based connection
  const url = config.url || process.env.REDIS_URL;
  if (url) {
    return new Redis(url, {
      lazyConnect: config.lazyConnect ?? false,
      keyPrefix: config.keyPrefix,
      retryStrategy: createRetryStrategy(),
      maxRetriesPerRequest: 3,
    });
  }

  // Individual parameters
  const host = config.host || process.env.REDIS_HOST || "localhost";
  const port = config.port || parseInt(process.env.REDIS_PORT || "6379", 10);
  const password = config.password || process.env.REDIS_PASSWORD || undefined;
  const useTls = config.tls ?? process.env.REDIS_TLS === "true";

  const redis = new Redis({
    host,
    port,
    password,
    tls: useTls ? {} : undefined,
    lazyConnect: config.lazyConnect ?? false,
    keyPrefix: config.keyPrefix,
    retryStrategy: createRetryStrategy(),
    maxRetriesPerRequest: 3,
  });

  redis.on("connect", () => {
    console.log(`Redis connected to ${host}:${port}`);
  });

  redis.on("error", (err: Error) => {
    console.error("Redis error:", err.message);
  });

  redis.on("close", () => {
    console.log("Redis connection closed");
  });

  return redis;
}

function createRetryStrategy() {
  return (times: number) => {
    // Exponential backoff with max 2 second delay
    const delay = Math.min(times * 50, 2000);
    return delay;
  };
}
