import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuthenticatedUser } from "../lib/authPlugin.js";

const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  displayName: z.string().min(1).max(100),
});

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
  status: z.enum(["ONLINE", "OFFLINE", "AWAY"]).optional(),
});

export async function userRoutes(fastify: FastifyInstance) {
  // Apply authentication to all routes in this plugin
  fastify.addHook("onRequest", fastify.authenticate);

  // Get current authenticated user (or create if first login)
  fastify.get("/me", async (request, reply) => {
    const authUser = getAuthenticatedUser(request);
    const auth0Sub = authUser.sub;
    const email = authUser.email as string | undefined;

    let user = await fastify.prisma.user.findFirst({
      where: {
        OR: [{ auth0Id: auth0Sub }, ...(email ? [{ email }] : [])],
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        status: true,
        auth0Id: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      // User doesn't exist - they need to register first
      return reply.status(404).send({
        error: "User not found",
        message: "Please complete registration first",
        needsRegistration: true,
      });
    }

    // Link Auth0 ID if not already linked
    if (!user.auth0Id) {
      user = await fastify.prisma.user.update({
        where: { id: user.id },
        data: { auth0Id: auth0Sub },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          status: true,
          auth0Id: true,
          lastSeenAt: true,
          createdAt: true,
        },
      });
    }

    return { user };
  });

  // Register new user (creates user and links to Auth0)
  fastify.post("/register", async (request, reply) => {
    const body = createUserSchema.parse(request.body);
    const authUser = getAuthenticatedUser(request);
    const auth0Sub = authUser.sub;
    const email = authUser.email as string;

    if (!email) {
      return reply.status(400).send({
        error: "Email required",
        message: "Auth0 token must include email claim",
      });
    }

    // Check if user already exists
    const existingUser = await fastify.prisma.user.findFirst({
      where: {
        OR: [{ auth0Id: auth0Sub }, { email }, { username: body.username }],
      },
    });

    if (existingUser) {
      if (existingUser.auth0Id === auth0Sub) {
        return reply.status(409).send({
          error: "Conflict",
          message: "User already registered",
        });
      }
      if (existingUser.email === email) {
        return reply.status(409).send({
          error: "Conflict",
          message: "Email already in use",
        });
      }
      if (existingUser.username === body.username) {
        return reply.status(409).send({
          error: "Conflict",
          message: "Username already taken",
        });
      }
    }

    const user = await fastify.prisma.user.create({
      data: {
        email,
        username: body.username,
        displayName: body.displayName,
        auth0Id: auth0Sub,
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        createdAt: true,
      },
    });

    reply.code(201);
    return { user };
  });

  // Get user by ID
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    const user = await fastify.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      return reply.notFound("User not found");
    }

    return { user };
  });

  // Update current user
  fastify.patch("/me", async (request, reply) => {
    const authUser = getAuthenticatedUser(request);
    const auth0Sub = authUser.sub;
    const body = updateUserSchema.parse(request.body);

    if (Object.keys(body).length === 0) {
      return reply.badRequest("No updates provided");
    }

    const user = await fastify.prisma.user.findFirst({
      where: { auth0Id: auth0Sub },
    });

    if (!user) {
      return reply.notFound("User not found");
    }

    const updatedUser = await fastify.prisma.user.update({
      where: { id: user.id },
      data: body,
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        status: true,
      },
    });

    return { user: updatedUser };
  });

  // Search users
  fastify.get("/", async (request) => {
    const { q, limit = "20" } = request.query as { q?: string; limit?: string };

    const users = await fastify.prisma.user.findMany({
      where: q
        ? {
            OR: [
              { username: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      take: parseInt(limit, 10),
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
    });

    return { users };
  });
}
