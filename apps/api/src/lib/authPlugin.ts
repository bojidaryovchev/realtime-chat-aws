import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { verifyAuth0Token, getAuth0Config } from "@realtime-chat/auth";
import type { JWTPayload } from "@realtime-chat/auth";

// Extend FastifyRequest to include user info
declare module "fastify" {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

async function authPlugin(fastify: FastifyInstance) {
  const auth0Config = getAuth0Config();

  // Decorator to verify JWT on protected routes
  fastify.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
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
    }
  );
}

export default fp(authPlugin, {
  name: "auth",
});
