/**
 * Re-export logger from common package for Fastify compatibility.
 */
import { createFastifyLoggerOptions } from "@realtime-chat/common/logger";

export const loggerOptions = createFastifyLoggerOptions();
