import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { MessageType, Prisma, UserStatus } from "@realtime-chat/database";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuthenticatedUser } from "../lib/authPlugin.js";

const createMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(5000),
  type: z.enum(["TEXT", "IMAGE", "FILE"]).default("TEXT"),
  metadata: z.record(z.unknown()).optional(),
});

const sqsClient = new SQSClient({ region: process.env.AWS_REGION });

export async function messageRoutes(fastify: FastifyInstance) {
  // Apply authentication to all routes in this plugin
  fastify.addHook("onRequest", fastify.authenticate);

  // Send message
  fastify.post("/", async (request, reply) => {
    const body = createMessageSchema.parse(request.body);
    const authUser = getAuthenticatedUser(request);

    // Get sender ID from authenticated user
    const user = await fastify.prisma.user.findFirst({
      where: { auth0Id: authUser.sub },
      select: { id: true },
    });

    if (!user) {
      return reply.status(404).send({
        error: "Not Found",
        message: "User not found",
      });
    }

    const senderId = user.id;

    // Insert message into database
    const message = await fastify.prisma.message.create({
      data: {
        conversationId: body.conversationId,
        senderId,
        content: body.content,
        type: body.type as MessageType,
        metadata: body.metadata as Prisma.InputJsonValue,
      },
    });

    // Update conversation timestamp
    await fastify.prisma.conversation.update({
      where: { id: body.conversationId },
      data: { updatedAt: new Date() },
    });

    // Get offline participants for push notifications
    const offlineParticipants = await fastify.prisma.conversationParticipant.findMany({
      where: {
        conversationId: body.conversationId,
        userId: { not: senderId },
        user: {
          status: UserStatus.OFFLINE,
          pushToken: { not: null },
        },
      },
      include: {
        user: {
          select: { id: true, pushToken: true },
        },
      },
    });

    // Queue push notifications for offline users
    if (offlineParticipants.length > 0 && process.env.SQS_PUSH_QUEUE_URL) {
      for (const participant of offlineParticipants) {
        await sqsClient.send(
          new SendMessageCommand({
            QueueUrl: process.env.SQS_PUSH_QUEUE_URL,
            MessageBody: JSON.stringify({
              type: "new_message",
              userId: participant.user.id,
              pushToken: participant.user.pushToken,
              messageId: message.id,
              conversationId: body.conversationId,
              senderId,
              preview: body.content.substring(0, 100),
            }),
          }),
        );
      }
    }

    // Publish to Redis for realtime delivery
    await fastify.redis.publish(
      `conversation:${body.conversationId}`,
      JSON.stringify({
        type: "new_message",
        message,
      }),
    );

    reply.code(201);
    return { message };
  });

  // Get messages in conversation
  fastify.get("/", async (request) => {
    const {
      conversationId,
      limit = "50",
      before,
    } = request.query as {
      conversationId: string;
      limit?: string;
      before?: string;
    };

    const messages = await fastify.prisma.message.findMany({
      where: {
        conversationId,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: parseInt(limit, 10),
    });

    // Transform to expected format and return in chronological order
    const formattedMessages = messages.reverse().map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      content: m.content,
      type: m.type,
      metadata: m.metadata,
      createdAt: m.createdAt,
      senderUsername: m.sender.username,
      senderDisplayName: m.sender.displayName,
      senderAvatar: m.sender.avatarUrl,
    }));

    return { messages: formattedMessages };
  });

  // Mark messages as read
  fastify.post<{ Params: { id: string } }>("/:id/read", async (request, reply) => {
    const { id } = request.params;
    const authUser = getAuthenticatedUser(request);

    // Get the authenticated user's ID (prevent impersonation)
    const currentUser = await fastify.prisma.user.findFirst({
      where: { auth0Id: authUser.sub },
      select: { id: true },
    });

    if (!currentUser) {
      throw fastify.httpErrors.notFound("User not found");
    }

    const userId = currentUser.id;

    await fastify.prisma.messageReceipt.upsert({
      where: {
        messageId_userId: { messageId: id, userId },
      },
      update: { readAt: new Date() },
      create: { messageId: id, userId, readAt: new Date() },
    });

    // Get message details for realtime update
    const message = await fastify.prisma.message.findUnique({
      where: { id },
      select: { conversationId: true, senderId: true },
    });

    if (message) {
      // Publish read receipt to realtime
      await fastify.redis.publish(
        `conversation:${message.conversationId}`,
        JSON.stringify({
          type: "message_read",
          messageId: id,
          userId,
          readAt: new Date().toISOString(),
        }),
      );
    }

    reply.code(204);
  });

  // Mark messages as delivered
  fastify.post<{ Params: { id: string } }>("/:id/delivered", async (request, reply) => {
    const { id } = request.params;
    const authUser = getAuthenticatedUser(request);

    // Get the authenticated user's ID (prevent impersonation)
    const currentUser = await fastify.prisma.user.findFirst({
      where: { auth0Id: authUser.sub },
      select: { id: true },
    });

    if (!currentUser) {
      throw fastify.httpErrors.notFound("User not found");
    }

    const userId = currentUser.id;

    await fastify.prisma.messageReceipt.upsert({
      where: {
        messageId_userId: { messageId: id, userId },
      },
      update: { deliveredAt: new Date() },
      create: { messageId: id, userId, deliveredAt: new Date() },
    });

    reply.code(204);
  });
}
