import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { prisma } from "@realtime-chat/database";

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
  // Sync user to database after successful Auth0 authentication
  async beforeSessionSaved(session) {
    const { sub, email, name, picture } = session.user;

    if (sub && email) {
      try {
        // Upsert user - create if not exists, update if exists
        await prisma.user.upsert({
          where: { auth0Id: sub },
          update: {
            // Update profile info from Auth0 on each login
            displayName: name || email.split("@")[0],
            avatarUrl: picture || undefined,
          },
          create: {
            auth0Id: sub,
            email: email,
            // Generate username from email prefix
            username: email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "") + 
              Math.floor(Math.random() * 1000),
            displayName: name || email.split("@")[0],
            avatarUrl: picture || undefined,
          },
        });
      } catch (err) {
        console.error("Failed to sync user to database:", err);
        // Don't block authentication if DB sync fails
      }
    }
    return session;
  },
});
