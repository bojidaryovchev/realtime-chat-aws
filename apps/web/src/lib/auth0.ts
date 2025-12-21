import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Auth0 client instance for server-side authentication.
 * Configuration is loaded from environment variables:
 * - AUTH0_DOMAIN
 * - AUTH0_CLIENT_ID
 * - AUTH0_CLIENT_SECRET
 * - AUTH0_SECRET
 * - APP_BASE_URL
 */
export const auth0 = new Auth0Client({
  authorizationParameters: {
    // Request access token for our API
    audience: process.env.AUTH0_AUDIENCE,
    scope: "openid profile email offline_access",
  },
});
