import pino from "pino";
import type { Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

const isDev = process.env.NODE_ENV !== "production";

/**
 * Creates a Pino logger instance with environment-aware configuration.
 * - Development: Pretty-printed, colorized output
 * - Production: Structured JSON for CloudWatch
 */
export function createLogger(name?: string): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
            },
          },
        }
      : {
          // Structured JSON logging for production (CloudWatch)
          formatters: {
            level: (label: string) => ({ level: label }),
          },
        }),
  });
}

/**
 * Creates Fastify-compatible logger options.
 * Use this when initializing Fastify with logging.
 * 
 * @example
 * const fastify = Fastify({ logger: createFastifyLoggerOptions() });
 */
export function createFastifyLoggerOptions() {
  return {
    level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
            },
          },
        }
      : {
          formatters: {
            level: (label: string) => ({ level: label }),
          },
        }),
  };
}
