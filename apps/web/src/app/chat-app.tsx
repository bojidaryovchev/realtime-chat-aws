"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { conversationApi, messageApi, userApi, type Conversation, type User } from "../lib/api";
import { useSocket } from "../lib/socket";

interface ChatAppProps {
  user: {
    name: string;
    email: string;
    picture?: string;
  };
  accessToken: string;
}

export function ChatApp({ user, accessToken }: ChatAppProps) {
  const { connect, isConnected } = useSocket();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatName, setNewChatName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Connect to Socket.IO on mount
  useEffect(() => {
    if (accessToken) {
      connect(accessToken);
    }
  }, [accessToken, connect]);

  // Fetch current user and conversations
  useEffect(() => {
    async function fetchData() {
      // Get current user ID
      const meResult = await userApi.me(accessToken);
      console.log("userApi.me result:", meResult);

      if (meResult.error) {
        console.error("Failed to get user:", meResult.error);
      }

      if (meResult.data) {
        // Handle both { user: User } and User response shapes
        const data = meResult.data as unknown as { user?: User } & User;
        console.log("User data:", data);
        const userId = data.user?.id || data.id;
        console.log("Setting currentUserId:", userId);
        setCurrentUserId(userId);
      }

      // Get conversations
      const result = await conversationApi.list(accessToken);
      if (result.data) {
        setConversations(result.data.conversations);
      }
      setIsLoading(false);
    }

    if (accessToken) {
      fetchData();
    }
  }, [accessToken]);

  const handleCreateConversation = async () => {
    if (!currentUserId) {
      console.error("No current user ID available");
      return;
    }

    setIsCreating(true);
    try {
      const result = await conversationApi.create(accessToken, {
        name: newChatName || "New Chat",
        type: "GROUP",
        participantIds: [currentUserId],
      });

      console.log("Create conversation result:", result);

      if (result.error) {
        console.error("API error:", result.error);
        return;
      }

      if (result.data) {
        // API returns { conversation: Conversation }
        const conversation = (result.data as unknown as { conversation: Conversation }).conversation || result.data;
        setConversations((prev) => [conversation, ...prev]);
        setSelectedConversation(conversation.id);
        setShowNewChatModal(false);
        setNewChatName("");
      }
    } catch (err) {
      console.error("Failed to create conversation:", err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-900">
      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-lg bg-slate-800 p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-white">Create New Chat</h3>
            <input
              type="text"
              value={newChatName}
              onChange={(e) => setNewChatName(e.target.value)}
              placeholder="Chat name (optional)"
              className="mb-4 w-full rounded-lg bg-slate-700 px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewChatModal(false)}
                className="px-4 py-2 text-slate-400 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateConversation}
                disabled={isCreating}
                className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="flex w-80 flex-col border-r border-slate-700 bg-slate-800">
        {/* User header */}
        <div className="flex items-center justify-between border-b border-slate-700 p-4">
          <div className="flex items-center gap-3">
            {user.picture ? (
              <Image src={user.picture} alt={user.name} width={40} height={40} className="rounded-full" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-medium text-white">
                {user.name[0]}
              </div>
            )}
            <div>
              <p className="font-medium text-white">{user.name}</p>
              <p className="flex items-center gap-1 text-sm text-slate-400">
                <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
                {isConnected ? "Online" : "Connecting..."}
              </p>
            </div>
          </div>
          <a href="/auth/logout" className="text-sm text-slate-400 transition-colors hover:text-white">
            Logout
          </a>
        </div>

        {/* New Chat Button */}
        <div className="border-b border-slate-700 p-4">
          <button
            onClick={() => setShowNewChatModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
            New Chat
          </button>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4">
            <h2 className="mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">Conversations</h2>
            {isLoading ? (
              <div className="text-sm text-slate-500">Loading...</div>
            ) : conversations.length === 0 ? (
              <div className="text-sm text-slate-500">No conversations yet. Create one to get started!</div>
            ) : (
              <ul className="space-y-1">
                {conversations.map((conv) => (
                  <li key={conv.id}>
                    <button
                      onClick={() => setSelectedConversation(conv.id)}
                      className={`w-full rounded-lg p-3 text-left transition-colors ${
                        selectedConversation === conv.id ? "bg-blue-600" : "hover:bg-slate-700"
                      }`}
                    >
                      <p className="truncate font-medium text-white">
                        {conv.name || conv.participants.map((p) => p.user.displayName).join(", ")}
                      </p>
                      {conv.lastMessage && (
                        <p className="truncate text-sm text-slate-400">{conv.lastMessage.content}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {selectedConversation ? (
          <ChatRoom conversationId={selectedConversation} accessToken={accessToken} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center text-slate-500">
              <p className="text-xl">Select a conversation to start chatting</p>
              <p className="mt-2 text-sm">Or create a new conversation to get started</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

interface ChatRoomProps {
  conversationId: string;
  accessToken: string;
}

interface ChatMessage {
  id: string;
  content: string;
  senderId: string;
  conversationId: string;
  createdAt: string;
  senderDisplayName?: string;
  senderUsername?: string;
  senderAvatar?: string;
  sender?: { displayName: string; avatarUrl?: string };
}

function ChatRoom({ conversationId, accessToken }: ChatRoomProps) {
  const { socket, isConnected } = useSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load existing messages
  useEffect(() => {
    async function loadMessages() {
      setIsLoading(true);
      const result = await messageApi.list(accessToken, conversationId);
      console.log("Loaded messages:", result);
      if (result.data?.messages) {
        setMessages(result.data.messages as unknown as ChatMessage[]);
      }
      setIsLoading(false);
    }
    loadMessages();
  }, [accessToken, conversationId]);

  // Join conversation and listen for new messages
  useEffect(() => {
    if (socket && isConnected) {
      socket.emit("conversation:join", { conversationId });

      socket.on("message:new", (data) => {
        console.log("Received message:new", data);
        const message = data.message || data;
        if (message.conversationId === conversationId) {
          setMessages((prev) => [...prev, message]);
        }
      });

      return () => {
        socket.emit("conversation:leave", { conversationId });
        socket.off("message:new");
      };
    }
  }, [socket, isConnected, conversationId]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !socket || !isConnected) return;

    socket.emit("message:send", {
      conversationId,
      content: inputValue.trim(),
      type: "TEXT",
    });

    setInputValue("");
  };

  const getSenderName = (msg: ChatMessage) => {
    return msg.senderDisplayName || msg.senderUsername || msg.sender?.displayName || "Unknown";
  };

  const getSenderAvatar = (msg: ChatMessage) => {
    return msg.senderAvatar || msg.sender?.avatarUrl;
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === date.toDateString();

    const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    if (isToday) {
      return time;
    } else if (isYesterday) {
      return `Yesterday ${time}`;
    } else {
      return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
        {isLoading ? (
          <div className="py-8 text-center text-slate-500">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="py-8 text-center text-slate-500">No messages yet. Start the conversation!</div>
        ) : (
          <>
            {messages.map((msg) => {
              const avatar = getSenderAvatar(msg);
              const name = getSenderName(msg);
              return (
                <div
                  key={msg.id}
                  className="group -mx-4 flex gap-4 rounded-lg px-4 py-2 transition-colors hover:bg-slate-800/50"
                >
                  {avatar ? (
                    <Image
                      src={avatar}
                      alt={name}
                      width={40}
                      height={40}
                      className="shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 to-purple-600 font-medium text-white">
                      {name[0]?.toUpperCase() || "?"}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-white">{name}</span>
                      <span className="text-xs text-slate-500">{formatTime(msg.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 wrap-break-word text-slate-300">{msg.content}</p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="border-t border-slate-700 bg-slate-800/50 p-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-xl bg-slate-700 px-4 py-3 text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!isConnected}
            className="rounded-xl bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
