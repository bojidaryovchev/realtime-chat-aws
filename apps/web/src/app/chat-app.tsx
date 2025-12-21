"use client";

import { useEffect, useState, useRef } from "react";
import { useSocket } from "../lib/socket";
import { conversationApi, messageApi, userApi, type Conversation, type User } from "../lib/api";

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
    <div className="h-screen flex bg-slate-900 overflow-hidden">
      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-96 shadow-xl">
            <h3 className="text-white text-lg font-semibold mb-4">Create New Chat</h3>
            <input
              type="text"
              value={newChatName}
              onChange={(e) => setNewChatName(e.target.value)}
              placeholder="Chat name (optional)"
              className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowNewChatModal(false)}
                className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateConversation}
                disabled={isCreating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-80 bg-slate-800 border-r border-slate-700 flex flex-col">
        {/* User header */}
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {user.picture ? (
              <img
                src={user.picture}
                alt={user.name}
                className="w-10 h-10 rounded-full"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">
                {user.name[0]}
              </div>
            )}
            <div>
              <p className="text-white font-medium">{user.name}</p>
              <p className="text-slate-400 text-sm flex items-center gap-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isConnected ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                {isConnected ? "Online" : "Connecting..."}
              </p>
            </div>
          </div>
          <a
            href="/auth/logout"
            className="text-slate-400 hover:text-white transition-colors text-sm"
          >
            Logout
          </a>
        </div>

        {/* New Chat Button */}
        <div className="p-4 border-b border-slate-700">
          <button
            onClick={() => setShowNewChatModal(true)}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
              Conversations
            </h2>
            {isLoading ? (
              <div className="text-slate-500 text-sm">Loading...</div>
            ) : conversations.length === 0 ? (
              <div className="text-slate-500 text-sm">No conversations yet. Create one to get started!</div>
            ) : (
              <ul className="space-y-1">
                {conversations.map((conv) => (
                  <li key={conv.id}>
                    <button
                      onClick={() => setSelectedConversation(conv.id)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        selectedConversation === conv.id
                          ? "bg-blue-600"
                          : "hover:bg-slate-700"
                      }`}
                    >
                      <p className="text-white font-medium truncate">
                        {conv.name ||
                          conv.participants
                            .map((p) => p.user.displayName)
                            .join(", ")}
                      </p>
                      {conv.lastMessage && (
                        <p className="text-slate-400 text-sm truncate">
                          {conv.lastMessage.content}
                        </p>
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
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {selectedConversation ? (
          <ChatRoom
            conversationId={selectedConversation}
            accessToken={accessToken}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-slate-500">
              <p className="text-xl">Select a conversation to start chatting</p>
              <p className="text-sm mt-2">
                Or create a new conversation to get started
              </p>
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (isToday) {
      return time;
    } else if (isYesterday) {
      return `Yesterday ${time}`;
    } else {
      return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0">
        {isLoading ? (
          <div className="text-slate-500 text-center py-8">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="text-slate-500 text-center py-8">No messages yet. Start the conversation!</div>
        ) : (
          <>
            {messages.map((msg) => {
              const avatar = getSenderAvatar(msg);
              const name = getSenderName(msg);
              return (
                <div key={msg.id} className="flex gap-4 group hover:bg-slate-800/50 -mx-4 px-4 py-2 rounded-lg transition-colors">
                  {avatar ? (
                    <img 
                      src={avatar} 
                      alt={name}
                      className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-medium flex-shrink-0">
                      {name[0]?.toUpperCase() || "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-white">{name}</span>
                      <span className="text-xs text-slate-500">{formatTime(msg.createdAt)}</span>
                    </div>
                    <p className="text-slate-300 mt-0.5 break-words">{msg.content}</p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 border-t border-slate-700 bg-slate-800/50">
        <div className="flex gap-3">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400"
          />
          <button
            type="submit"
            disabled={!isConnected}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
