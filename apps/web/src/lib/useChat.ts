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

    socket.emit("join_conversation", { conversationId });

    return () => {
      socket.emit("leave_conversation", { conversationId });
    };
  }, [socket, isConnected, conversationId]);

  // Set up event listeners
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (message: Message) => {
      if (message.conversationId === conversationId) {
        setMessages((prev) => [...prev, message]);
        onNewMessage?.(message);
      }
    };

    const handleTyping = ({ userId, username, isTyping }: { userId: string; username: string; isTyping: boolean }) => {
      setTypingUsers((prev) => {
        if (isTyping) {
          if (!prev.find((u) => u.id === userId)) {
            return [...prev, { id: userId, username }];
          }
        } else {
          return prev.filter((u) => u.id !== userId);
        }
        return prev;
      });
      onTyping?.({ id: userId, username }, isTyping);
    };

    const handleUserJoined = ({ userId }: { conversationId: string; userId: string }) => {
      onUserJoined?.(userId);
    };

    const handleUserLeft = ({ userId }: { conversationId: string; userId: string }) => {
      onUserLeft?.(userId);
    };

    socket.on("new_message", handleNewMessage);
    socket.on("user_typing", handleTyping);
    socket.on("user_joined", handleUserJoined);
    socket.on("user_left", handleUserLeft);

    return () => {
      socket.off("new_message", handleNewMessage);
      socket.off("user_typing", handleTyping);
      socket.off("user_joined", handleUserJoined);
      socket.off("user_left", handleUserLeft);
    };
  }, [socket, conversationId, onNewMessage, onTyping, onUserJoined, onUserLeft]);

  const sendMessage = useCallback(
    (content: string, type: "TEXT" | "IMAGE" | "FILE" = "TEXT") => {
      if (!socket || !isConnected) return;

      socket.emit("send_message", {
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

      socket.emit("typing", {
        conversationId,
        isTyping,
      });
    },
    [socket, isConnected, conversationId]
  );

  const markAsRead = useCallback(
    (messageId: string) => {
      if (!socket || !isConnected) return;

      socket.emit("read_receipt", {
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
