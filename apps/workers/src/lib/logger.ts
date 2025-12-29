/**
 * Re-export logger from common package.
 */
import { createLogger } from "@realtime-chat/common/logger";

export { createLogger };
export const logger = createLogger("workers");
