import type { Metadata } from "next";
import ForgotForm from "./ForgotForm";

export const metadata: Metadata = { title: "Forgot password · Umpqua Valley Lamb" };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  return (
    <main className="mx-auto min-h-screen max-w-[460px] px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="brandmark h-12! w-12! border-forest! text-lg text-forest" aria-hidden="true">
          UV
        </div>
        <h1 className="text-2xl!">Umpqua Valley Lamb</h1>
      </div>

      <div className="panel p-5!">
        <h2 className="mb-1">Forgot your password?</h2>
        <p className="muted mb-2">Type the email you log in with. We&apos;ll email you a link to set a new password.</p>
        {m === "expired" && (
          <p className="note bad">That link has expired or was already used. Ask for a new one below.</p>
        )}
        <ForgotForm />
      </div>
    </main>
  );
}
