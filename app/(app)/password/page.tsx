import { requireUser } from "@/lib/auth/current-user";
import { homeFor } from "@/lib/auth/roles";
import { cameFromResetLink } from "./actions";
import PasswordForm from "./PasswordForm";

export const metadata = { title: "Password · Umpqua Valley Lamb" };

export default async function PasswordPage() {
  const me = await requireUser();
  const reset = await cameFromResetLink();
  return (
    <div className="mx-auto max-w-[460px]">
      <h2 className="mb-1">{reset ? "Set a new password" : "Change my password"}</h2>
      <p className="muted mt-0">
        {reset ? `You're logged in as ${me.email}. Pick a new password.` : `For ${me.email}.`}
      </p>
      <PasswordForm askCurrent={!reset} home={homeFor(me.perms, me.role)} />
    </div>
  );
}
