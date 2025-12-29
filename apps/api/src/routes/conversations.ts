import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuthenticatedUser } from "../lib/authPlugin.js";

const createConversationSchema = z.object({
  type: z.enum(["DIRECT", "GROUP"]),
  name: z.string().max(100).optional(),
  participantIds: z.array(z.string().uuid()).min(1),
});

export async function conversationRoutes(fastify: FastifyInstance) {
  // Apply authentication to all routes in this plugin
  fastify.addHook("onRequest", fastify.authenticate);

  // Create conversation
  fastify.post("/", async (request, reply) => {
    const body = createConversationSchema.parse(request.body);
    const authUser = getAuthenticatedUser(request);

    // Get the authenticated user's ID
    const currentUser = await fastify.prisma.user.findFirst({
      where: { auth0Id: authUser.sub },
      select: { id: true },
    });

    if (!currentUser) {
      throw fastify.httpErrors.notFound("User not found");
    }

    // Ensure current user is included in participants
    const allParticipantIds = [...new Set([currentUser.id, ...body.participantIds])];

    const conversation = await fastify.prisma.conversation.create({
      data: {
        type: body.type,
        name: body.name,
        participants: {
          create: allParticipantIds.map((userId, index) => ({
            userId,
            role: index === 0 ? "ADMIN" : "MEMBER", // Creator is admin
          })),
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    reply.code(201);
    return { conversation };
  });

  // Get conversation by ID
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    const conversation = await fastify.prisma.conversation.findUnique({
      where: { id },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      return reply.notFound("Conversation not found");
    }

    return { conversation };
  });

  // Get user's conversations
  fastify.get("/", async (request) => {
    const { limit = "50", offset = "0" } = request.query as {
      limit?: string;
      offset?: string;
    };
    const authUser = getAuthenticatedUser(request);

    // Get the authenticated user's ID from their Auth0 sub
    const user = await fastify.prisma.user.findFirst({
      where: { auth0Id: authUser.sub },
      select: { id: true },
    });

    if (!user) {
      throw fastify.httpErrors.notFound("User not found");
    }

    const conversations = await fastify.prisma.conversation.findMany({
      where: {
        participants: {
          some: {
            userId: user.id,
          },
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            content: true,
            createdAt: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10),
    });

    return { conversations };
  });

  // Add participant to conversation (only admins can add)
  fastify.post<{ Params: { id: string } }>("/:id/participants", async (request, reply) => {
    const { id } = request.params;
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.body);
    const authUser = getAuthenticatedUser(request);

    // Get the authenticated user's ID
    const currentUser = await fastify.prisma.user.findFirst({
      where: { auth0Id: authUser.sub },
      select: { id: true },
    });

    if (!currentUser) {
      throw fastify.httpErrors.notFound("User not found");
    }

    // Check if current user is a participant with ADMIN role
    const currentParticipant = await fastify.prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId: id,
          userId: currentUser.id,
        },
      },
      select: { role: true },
    });

    if (!currentParticipant) {
      throw fastify.httpErrors.forbidden("You are not a participant in this conversation");
    }

    if (currentParticipant.role !== "ADMIN") {
      throw fastify.httpErrors.forbidden("Only admins can add participants");
    }

    await fastify.prisma.conversationParticipant.upsert({
      where: {
        conversationId_userId: {
          conversationId: id,
          userId,
        },
      },
      update: {},
      create: {
        conversationId: id,
        userId,
      },
    });

    reply.code(204);
  });

  // Remove participant from conversation (admins can remove anyone, users can leave themselves)
  fastify.delete<{ Params: { id: string; userId: string } }>("/:id/participants/:userId", async (request, reply) => {
    const { id, userId } = request.params;
    const authUser = getAuthenticatedUser(request);

    // Get the authenticated user's ID
    const currentUser = await fastify.prisma.user.findFirst({
      where: { auth0Id: authUser.sub },
      select: { id: true },
    });

    if (!currentUser) {
      throw fastify.httpErrors.notFound("User not found");
    }

    // Check if current user is a participant
    const currentParticipant = await fastify.prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId: id,
          userId: currentUser.id,
        },
      },
      select: { role: true },
    });

    if (!currentParticipant) {
      throw fastify.httpErrors.forbidden("You are not a participant in this conversation");
    }

    // Allow if: removing self OR current user is admin
    const isRemovingSelf = currentUser.id === userId;
    const isAdmin = currentParticipant.role === "ADMIN";

    if (!isRemovingSelf && !isAdmin) {
      throw fastify.httpErrors.forbidden("Only admins can remove other participants");
    }

    await fastify.prisma.conversationParticipant.delete({
      where: {
        conversationId_userId: {
          conversationId: id,
          userId,
        },
      },
    });

    reply.code(204);
  });
}
