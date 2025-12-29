/**
 * @realtime-chat/common
 *
 * Shared utilities for all realtime chat services.
 * Provides consistent logging, Redis client, and environment configuration.
 */

export { createFastifyLoggerOptions, createLogger } from "./logger.js";
export type { Logger } from "./logger.js";

export { createRedisClient } from "./redis.js";
export type { RedisClient, RedisConfig } from "./redis.js";

export { getEnv, getEnvBoolean, getEnvNumber, requireEnv } from "./env.js";
