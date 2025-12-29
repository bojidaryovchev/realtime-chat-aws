/**
 * Auth0 configuration options
 */
export interface Auth0Config {
  /** Auth0 domain (e.g., "your-tenant.auth0.com") */
  domain: string;
  /** API audience identifier configured in Auth0 */
  audience: string;
}

/**
 * Decoded JWT payload from Auth0
 */
export interface JWTPayload {
  /** Auth0 user ID (e.g., "auth0|123456") */
  sub: string;
  /** User's email address */
  email?: string;
  /** User's display name */
  name?: string;
  /** URL to user's profile picture */
  picture?: string;
  /** Token issuer */
  iss?: string;
  /** Token audience */
  aud?: string | string[];
  /** Expiration time (Unix timestamp) */
  exp?: number;
  /** Issued at time (Unix timestamp) */
  iat?: number;
  /** Additional custom claims */
  [key: string]: unknown;
}
