const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3002";

interface ApiClientOptions {
  token?: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

async function request<T>(
  endpoint: string,
  options: RequestInit & ApiClientOptions = {}
): Promise<ApiResponse<T>> {
  const { token, ...fetchOptions } = options;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
    ...fetchOptions.headers,
  };

  try {
    const response = await fetch(`${apiUrl}${endpoint}`, {
      ...fetchOptions,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }));
      return { error: error.message || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error" };
  }
}

// User endpoints
export const userApi = {
  me: (token: string) => request<User>("/users/me", { token }),

  register: (token: string, data: { username: string; displayName?: string }) =>
    request<User>("/users/register", {
      method: "POST",
      token,
      body: JSON.stringify(data),
    }),

  getById: (token: string, id: string) => request<User>(`/users/${id}`, { token }),
};

// Conversation endpoints
export const conversationApi = {
  list: (token: string, params?: { limit?: number; cursor?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.cursor) searchParams.set("cursor", params.cursor);
    const query = searchParams.toString();
    return request<ConversationsResponse>(`/conversations${query ? `?${query}` : ""}`, { token });
  },

  get: (token: string, id: string) => request<Conversation>(`/conversations/${id}`, { token }),

  create: (token: string, data: { name?: string; type: "DIRECT" | "GROUP"; participantIds: string[] }) =>
    request<Conversation>("/conversations", {
      method: "POST",
      token,
      body: JSON.stringify(data),
    }),
};

// Message endpoints
export const messageApi = {
  list: (token: string, conversationId: string, params?: { limit?: number; before?: string }) => {
    const searchParams = new URLSearchParams();
    searchParams.set("conversationId", conversationId);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.before) searchParams.set("before", params.before);
    const query = searchParams.toString();
    return request<MessagesResponse>(`/messages?${query}`, { token });
  },

  send: (token: string, conversationId: string, data: { content: string; type?: "TEXT" | "IMAGE" | "FILE" }) =>
    request<Message>(`/messages`, {
      method: "POST",
      token,
      body: JSON.stringify({ ...data, conversationId }),
    }),
};

// Types
export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  status: "ONLINE" | "OFFLINE" | "AWAY" | "BUSY";
  lastSeenAt?: string;
}

export interface Conversation {
  id: string;
  name?: string;
  type: "DIRECT" | "GROUP";
  createdAt: string;
  updatedAt: string;
  participants: Array<{
    userId: string;
    user: User;
    role: "OWNER" | "ADMIN" | "MEMBER";
  }>;
  lastMessage?: Message;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: "TEXT" | "IMAGE" | "FILE";
  createdAt: string;
  sender?: User;
}

export interface ConversationsResponse {
  conversations: Conversation[];
  nextCursor?: string;
}

export interface MessagesResponse {
  messages: Message[];
  nextCursor?: string;
}
