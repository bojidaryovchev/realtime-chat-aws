import type { FastifyLoggerOptions } from "fastify";
import type { PinoLoggerOptions } from "fastify/types/logger.js";

const isDev = process.env.NODE_ENV !== "production";

export const loggerOptions: FastifyLoggerOptions & PinoLoggerOptions = {
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
};
