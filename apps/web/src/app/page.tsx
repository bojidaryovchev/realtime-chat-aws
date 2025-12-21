import { auth0 } from "../lib/auth0";
import { ChatApp } from "./chat-app";

export default async function Home() {
  const session = await auth0.getSession();

  if (!session) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-center space-y-8">
          <h1 className="text-5xl font-bold text-white">Realtime Chat</h1>
          <p className="text-slate-400 text-lg max-w-md">
            Connect with friends and colleagues in real-time. Secure, fast, and built for modern communication.
          </p>
          <div className="flex gap-4 justify-center">
            <a
              href="/auth/login?screen_hint=signup"
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Sign up
            </a>
            <a
              href="/auth/login"
              className="px-6 py-3 bg-slate-700 text-white rounded-lg font-medium hover:bg-slate-600 transition-colors"
            >
              Log in
            </a>
          </div>
        </div>
      </main>
    );
  }

  // Get access token for API calls
  const tokenResponse = await auth0.getAccessToken();
  const accessToken = tokenResponse?.token;

  return (
    <ChatApp
      user={{
        name: session.user.name || "User",
        email: session.user.email || "",
        picture: session.user.picture,
      }}
      accessToken={accessToken || ""}
    />
  );
}
