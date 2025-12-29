import type { JWTPayload } from "@realtime-chat/auth";
import { getAuth0Config, verifyAuth0Token } from "@realtime-chat/auth";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

// Extend FastifyRequest to include user info
declare module "fastify" {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

/**
 * Gets the authenticated user from the request.
 * Use this in protected routes after the authenticate hook has run.
 * Throws an error if user is not authenticated, providing better error messages
 * and TypeScript type safety.
 */
export function getAuthenticatedUser(request: FastifyRequest): JWTPayload {
  if (!request.user) {
    throw new Error("Unauthorized: User not authenticated");
  }
  return request.user;
}

async function authPlugin(fastify: FastifyInstance) {
  const auth0Config = getAuth0Config();

  // Decorator to verify JWT on protected routes
  fastify.decorate("authenticate", async function (request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Missing Authorization header",
      });
    }

    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Invalid Authorization header format. Expected: Bearer <token>",
      });
    }

    try {
      const payload = await verifyAuth0Token(token, auth0Config);
      request.user = payload;
    } catch (err) {
      fastify.log.error(err, "JWT verification failed");
      return reply.status(401).send({
        error: "Unauthorized",
        message: err instanceof Error ? err.message : "Invalid token",
      });
    }
  });
}

export default fp(authPlugin, {
  name: "auth",
});
