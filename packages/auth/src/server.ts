import * as jose from "jose";
import type { Auth0Config, JWTPayload } from "./types.js";

// Cache JWKS to avoid fetching on every request
let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
let cachedDomain: string | null = null;

function getJWKS(domain: string) {
  // Reset cache if domain changes
  if (cachedDomain !== domain) {
    jwks = null;
    cachedDomain = domain;
  }

  if (!jwks) {
    const jwksUrl = new URL(`https://${domain}/.well-known/jwks.json`);
    jwks = jose.createRemoteJWKSet(jwksUrl);
  }
  return jwks;
}

/**
 * Verify an Auth0 JWT access token
 *
 * Uses RS256 algorithm and fetches public keys from Auth0's JWKS endpoint.
 * The JWKS is cached to avoid fetching on every request.
 *
 * @param token - The JWT access token to verify
 * @param config - Auth0 configuration (domain and audience)
 * @returns The decoded JWT payload
 * @throws JOSEError if token is invalid, expired, or verification fails
 *
 * @example
 * ```ts
 * const payload = await verifyAuth0Token(token, {
 *   domain: "your-tenant.auth0.com",
 *   audience: "https://api.example.com"
 * });
 * console.log(payload.sub); // "auth0|123456"
 * ```
 */
export async function verifyAuth0Token(
  token: string,
  config: Auth0Config
): Promise<JWTPayload> {
  const { domain, audience } = config;

  const JWKS = getJWKS(domain);

  const { payload } = await jose.jwtVerify(token, JWKS, {
    issuer: `https://${domain}/`,
    audience,
    algorithms: ["RS256"],
  });

  return payload as JWTPayload;
}

/**
 * Get Auth0 configuration from environment variables
 *
 * @returns Auth0 configuration object
 * @throws Error if required environment variables are not set
 *
 * @example
 * ```ts
 * // Ensure AUTH0_DOMAIN and AUTH0_AUDIENCE are set
 * const config = getAuth0Config();
 * const payload = await verifyAuth0Token(token, config);
 * ```
 */
export function getAuth0Config(): Auth0Config {
  const domain = process.env.AUTH0_DOMAIN;
  const audience = process.env.AUTH0_AUDIENCE;

  if (!domain) {
    throw new Error("AUTH0_DOMAIN environment variable is not set");
  }

  if (!audience) {
    throw new Error("AUTH0_AUDIENCE environment variable is not set");
  }

  return { domain, audience };
}

// Re-export types for convenience
export type { Auth0Config, JWTPayload } from "./types.js";
