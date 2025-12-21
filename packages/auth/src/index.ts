/**
 * @realtime-chat/auth
 *
 * Shared Auth0 authentication utilities for the realtime chat application.
 * This package provides JWT verification using the jose library.
 */

export { verifyAuth0Token, getAuth0Config } from "./server.js";
export type { Auth0Config, JWTPayload } from "./types.js";
