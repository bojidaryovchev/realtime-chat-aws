import { Server as SocketIOServer, Socket } from "socket.io";
import { PrismaClient, UserStatus, MessageType, Prisma } from "@realtime-chat/database";
import type { RedisClient } from "../lib/redis.js";
import { verifyAuth0Token, getAuth0Config } from "@realtime-chat/auth";

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  auth0Sub?: string; // Auth0 user ID (sub claim)
}

interface JoinConversationPayload {
  conversationId: string;
}

interface LeaveConversationPayload {
  conversationId: string;
}

interface SendMessagePayload {
  conversationId: string;
  content: string;
  type?: "TEXT" | "IMAGE" | "FILE";
  metadata?: Record<string, unknown>;
}

interface TypingPayload {
  conversationId: string;
  isTyping: boolean;
}

interface ReadReceiptPayload {
  messageId: string;
  conversationId: string;
}

export function setupSocketHandlers(io: SocketIOServer, prisma: PrismaClient, redis: RedisClient): () => Promise<void> {
  // Get Auth0 config at startup
  const auth0Config = getAuth0Config();

  // Authentication middleware - verifies Auth0 JWT token
  io.use(async (socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error("Authentication required: No token provided"));
    }

    try {
      // Verify the JWT token with Auth0
      const payload = await verifyAuth0Token(token, auth0Config);

      if (!payload.sub) {
        return next(new Error("Invalid token: Missing sub claim"));
      }

      // Find user by Auth0 sub (stored in auth0Id field) or email
      let user = await prisma.user.findFirst({
        where: {
          OR: [
            { auth0Id: payload.sub },
            ...(payload.email ? [{ email: payload.email }] : []),
          ],
        },
        select: { id: true, username: true, displayName: true, avatarUrl: true, auth0Id: true },
      });

      // If user exists but doesn't have auth0Id linked, update it
      if (user && !user.auth0Id && payload.email) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { auth0Id: payload.sub },
          select: { id: true, username: true, displayName: true, avatarUrl: true, auth0Id: true },
        });
      }

      if (!user) {
        return next(new Error("User not found. Please register first."));
      }

      socket.userId = user.id;
      socket.username = user.username;
      socket.displayName = user.displayName;
      socket.avatarUrl = user.avatarUrl || undefined;
      socket.auth0Sub = payload.sub;
      next();
    } catch (err) {
      console.error("Socket authentication error:", err);
      const message = err instanceof Error ? err.message : "Authentication failed";
      return next(new Error(`Authentication failed: ${message}`));
    }
  });

  io.on("connection", async (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    console.log(`User ${userId} connected via socket ${socket.id}`);

    // Update user online status
    await prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ONLINE, lastSeenAt: new Date() },
    });

    // Store socket mapping in Redis for direct messaging
    await redis.set(`socket:user:${userId}`, socket.id, "EX", 86400);
    await redis.sadd(`user:sockets:${userId}`, socket.id);

    // Join user's personal room (for direct notifications)
    socket.join(`user:${userId}`);

    // Broadcast online status
    socket.broadcast.emit("user:status", {
      userId,
      status: "online",
      timestamp: new Date().toISOString(),
    });

    // Handle joining conversation rooms
    socket.on("conversation:join", async (payload: JoinConversationPayload) => {
      const { conversationId } = payload;

      // Verify user is participant
      const participant = await prisma.conversationParticipant.findUnique({
        where: {
          conversationId_userId: { conversationId, userId },
        },
      });

      if (!participant) {
        socket.emit("error", { message: "Not a participant of this conversation" });
        return;
      }

      socket.join(`conversation:${conversationId}`);
      console.log(`User ${userId} joined conversation ${conversationId}`);

      // Notify others in conversation
      socket.to(`conversation:${conversationId}`).emit("user:joined", {
        conversationId,
        userId,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle leaving conversation rooms
    socket.on("conversation:leave", (payload: LeaveConversationPayload) => {
      const { conversationId } = payload;
      socket.leave(`conversation:${conversationId}`);

      socket.to(`conversation:${conversationId}`).emit("user:left", {
        conversationId,
        userId,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle sending messages (realtime delivery)
    socket.on("message:send", async (payload: SendMessagePayload, callback) => {
      const { conversationId, content, type = "TEXT", metadata } = payload;

      try {
        // Verify user is participant
        const participant = await prisma.conversationParticipant.findUnique({
          where: {
            conversationId_userId: { conversationId, userId },
          },
        });

        if (!participant) {
          callback?.({ error: "Not a participant" });
          return;
        }

        // Insert message
        const message = await prisma.message.create({
          data: {
            conversationId,
            senderId: userId,
            content,
            type: type as MessageType,
            metadata: metadata as Prisma.InputJsonValue,
          },
        });

        // Update conversation timestamp
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });

        // Broadcast to conversation room
        io.to(`conversation:${conversationId}`).emit("message:new", {
          message: {
            ...message,
            senderUsername: socket.username,
            senderDisplayName: socket.displayName,
            senderAvatar: socket.avatarUrl,
          },
        });

        callback?.({ success: true, messageId: message.id });
      } catch (err) {
        console.error("Error sending message:", err);
        callback?.({ error: "Failed to send message" });
      }
    });

    // Handle typing indicators
    socket.on("typing:start", (payload: TypingPayload) => {
      socket.to(`conversation:${payload.conversationId}`).emit("typing:update", {
        conversationId: payload.conversationId,
        userId,
        isTyping: true,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("typing:stop", (payload: TypingPayload) => {
      socket.to(`conversation:${payload.conversationId}`).emit("typing:update", {
        conversationId: payload.conversationId,
        userId,
        isTyping: false,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle read receipts
    socket.on("message:read", async (payload: ReadReceiptPayload) => {
      const { messageId, conversationId } = payload;

      await prisma.messageReceipt.upsert({
        where: {
          messageId_userId: { messageId, userId },
        },
        update: { readAt: new Date() },
        create: { messageId, userId, readAt: new Date() },
      });

      socket.to(`conversation:${conversationId}`).emit("message:read:ack", {
        messageId,
        conversationId,
        userId,
        readAt: new Date().toISOString(),
      });
    });

    // Handle presence updates
    socket.on("presence:update", async (payload: { status: "ONLINE" | "AWAY" | "OFFLINE" }) => {
      await prisma.user.update({
        where: { id: userId },
        data: { status: payload.status as UserStatus, lastSeenAt: new Date() },
      });

      socket.broadcast.emit("user:status", {
        userId,
        status: payload.status.toLowerCase(),
        timestamp: new Date().toISOString(),
      });
    });

    // Handle disconnection
    socket.on("disconnect", async (reason) => {
      console.log(`User ${userId} disconnected: ${reason}`);

      // Remove socket from Redis
      await redis.del(`socket:user:${userId}`);
      await redis.srem(`user:sockets:${userId}`, socket.id);

      // Check if user has other active sockets
      const remainingSockets = await redis.scard(`user:sockets:${userId}`);

      if (remainingSockets === 0) {
        // Update user offline status
        await prisma.user.update({
          where: { id: userId },
          data: { status: UserStatus.OFFLINE, lastSeenAt: new Date() },
        });

        // Broadcast offline status
        socket.broadcast.emit("user:status", {
          userId,
          status: "offline",
          timestamp: new Date().toISOString(),
        });
      }
    });
  });

  // Subscribe to Redis pub/sub for cross-instance messaging
  const subscriber = redis.duplicate();
  subscriber.psubscribe("conversation:*");

  subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
    const conversationId = channel.split(":")[1];
    const data = JSON.parse(message);

    // Emit to all sockets in the conversation room on this instance
    io.to(`conversation:${conversationId}`).emit(data.type, data);
  });

  // Return cleanup function for graceful shutdown
  return async () => {
    await subscriber.punsubscribe("conversation:*");
    await subscriber.quit();
  };
}
