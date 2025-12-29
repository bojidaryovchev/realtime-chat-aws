"use client";

import { useEffect, useCallback, useState } from "react";
import { useSocket } from "./socket";

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: "TEXT" | "IMAGE" | "FILE";
  createdAt: string;
  sender?: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
  };
}

interface TypingUser {
  id: string;
  username: string;
}

interface UseChatOptions {
  conversationId: string;
  onNewMessage?: (message: Message) => void;
  onTyping?: (user: TypingUser, isTyping: boolean) => void;
  onUserJoined?: (userId: string) => void;
  onUserLeft?: (userId: string) => void;
}

export function useChat(options: UseChatOptions) {
  const { socket, isConnected } = useSocket();
  const { conversationId, onNewMessage, onTyping, onUserJoined, onUserLeft } = options;
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);

  // Join conversation when connected
  useEffect(() => {
    if (!socket || !isConnected || !conversationId) return;

    socket.emit("conversation:join", { conversationId });

    return () => {
      socket.emit("conversation:leave", { conversationId });
    };
  }, [socket, isConnected, conversationId]);

  // Set up event listeners
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (data: { message: Message }) => {
      if (data.message.conversationId === conversationId) {
        setMessages((prev) => [...prev, data.message]);
        onNewMessage?.(data.message);
      }
    };

    const handleTyping = ({ conversationId: convId, userId, isTyping }: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (convId !== conversationId) return;
      setTypingUsers((prev) => {
        if (isTyping) {
          if (!prev.find((u) => u.id === userId)) {
            return [...prev, { id: userId, username: userId }]; // username comes from server
          }
        } else {
          return prev.filter((u) => u.id !== userId);
        }
        return prev;
      });
      onTyping?.({ id: userId, username: userId }, isTyping);
    };

    const handleUserJoined = ({ conversationId: convId, userId }: { conversationId: string; userId: string }) => {
      if (convId === conversationId) {
        onUserJoined?.(userId);
      }
    };

    const handleUserLeft = ({ conversationId: convId, userId }: { conversationId: string; userId: string }) => {
      if (convId === conversationId) {
        onUserLeft?.(userId);
      }
    };

    // Event names matching server-side handlers.ts
    socket.on("message:new", handleNewMessage);
    socket.on("typing:update", handleTyping);
    socket.on("user:joined", handleUserJoined);
    socket.on("user:left", handleUserLeft);

    return () => {
      socket.off("message:new", handleNewMessage);
      socket.off("typing:update", handleTyping);
      socket.off("user:joined", handleUserJoined);
      socket.off("user:left", handleUserLeft);
    };
  }, [socket, conversationId, onNewMessage, onTyping, onUserJoined, onUserLeft]);

  const sendMessage = useCallback(
    (content: string, type: "TEXT" | "IMAGE" | "FILE" = "TEXT") => {
      if (!socket || !isConnected) return;

      socket.emit("message:send", {
        conversationId,
        content,
        type,
      });
    },
    [socket, isConnected, conversationId]
  );

  const setTyping = useCallback(
    (isTyping: boolean) => {
      if (!socket || !isConnected) return;

      socket.emit(isTyping ? "typing:start" : "typing:stop", {
        conversationId,
        isTyping,
      });
    },
    [socket, isConnected, conversationId]
  );

  const markAsRead = useCallback(
    (messageId: string) => {
      if (!socket || !isConnected) return;

      socket.emit("message:read", {
        messageId,
        conversationId,
      });
    },
    [socket, isConnected, conversationId]
  );

  return {
    messages,
    setMessages,
    typingUsers,
    sendMessage,
    setTyping,
    markAsRead,
    isConnected,
  };
}
