import { auth0 } from "../lib/auth0";
import { ChatApp } from "./chat-app";

export default async function Home() {
  const session = await auth0.getSession();

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-linear-to-br from-slate-900 to-slate-800">
        <div className="space-y-8 text-center">
          <h1 className="text-5xl font-bold text-white">Realtime Chat</h1>
          <p className="max-w-md text-lg text-slate-400">
            Connect with friends and colleagues in real-time. Secure, fast, and built for modern communication.
          </p>
          <div className="flex justify-center gap-4">
            <a
              href="/auth/login?screen_hint=signup"
              className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700"
            >
              Sign up
            </a>
            <a
              href="/auth/login"
              className="rounded-lg bg-slate-700 px-6 py-3 font-medium text-white transition-colors hover:bg-slate-600"
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
