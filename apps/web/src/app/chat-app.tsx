"use client";

import { useEffect, useState } from "react";
import { useSocket } from "../lib/socket";
import { conversationApi, type Conversation } from "../lib/api";

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

  // Connect to Socket.IO on mount
  useEffect(() => {
    if (accessToken) {
      connect(accessToken);
    }
  }, [accessToken, connect]);

  // Fetch conversations
  useEffect(() => {
    async function fetchConversations() {
      const result = await conversationApi.list(accessToken);
      if (result.data) {
        setConversations(result.data.conversations);
      }
      setIsLoading(false);
    }

    if (accessToken) {
      fetchConversations();
    }
  }, [accessToken]);

  return (
    <div className="min-h-screen flex bg-slate-900">
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

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
              Conversations
            </h2>
            {isLoading ? (
              <div className="text-slate-500 text-sm">Loading...</div>
            ) : conversations.length === 0 ? (
              <div className="text-slate-500 text-sm">No conversations yet</div>
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
      <main className="flex-1 flex flex-col">
        {selectedConversation ? (
          <ChatRoom
            conversationId={selectedConversation}
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
}

function ChatRoom({ conversationId }: ChatRoomProps) {
  const { socket, isConnected } = useSocket();
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      content: string;
      senderId: string;
      sender?: { displayName: string };
      createdAt: string;
    }>
  >([]);
  const [inputValue, setInputValue] = useState("");

  // Join conversation
  useEffect(() => {
    if (socket && isConnected) {
      socket.emit("join_conversation", { conversationId });

      socket.on("new_message", (message) => {
        if (message.conversationId === conversationId) {
          setMessages((prev) => [...prev, message]);
        }
      });

      return () => {
        socket.emit("leave_conversation", { conversationId });
        socket.off("new_message");
      };
    }
  }, [socket, isConnected, conversationId]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !socket || !isConnected) return;

    socket.emit("send_message", {
      conversationId,
      content: inputValue.trim(),
      type: "TEXT",
    });

    setInputValue("");
  };

  return (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white text-sm">
              {msg.sender?.displayName?.[0] || "?"}
            </div>
            <div>
              <p className="text-slate-400 text-sm">
                {msg.sender?.displayName || "Unknown"}
              </p>
              <p className="text-white">{msg.content}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 border-t border-slate-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!isConnected}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </>
  );
}
