import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Log in · Umpqua Valley Lamb" };

const MESSAGES: Record<string, { text: string; bad?: boolean }> = {
  morning: { text: "Good morning. Please log in for today." },
  off: { text: "This login is turned off. Ask Kathy or Eric to turn it back on.", bad: true },
  out: { text: "You are logged out." },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const message = m ? MESSAGES[m] : undefined;

  return (
    <main className="mx-auto min-h-screen max-w-[460px] px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="brandmark h-12! w-12! border-forest! text-lg text-forest" aria-hidden="true">
          UV
        </div>
        <h1 className="text-2xl!">Umpqua Valley Lamb</h1>
      </div>

      <div className="panel p-5!">
        <h2 className="mb-1">Log in</h2>
        <p className="muted mb-2">Once you log in, you stay logged in until 3 in the morning.</p>
        {message && <p className={message.bad ? "note bad" : "note"}>{message.text}</p>}
        <LoginForm />
      </div>
    </main>
  );
}
