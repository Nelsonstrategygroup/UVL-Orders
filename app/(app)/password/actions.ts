"use server";

// "Change my password" (asks for the current one) and the page a reset link
// opens (doesn't, for one hour). Runs as the logged-in person.

import { createClient as createPlainClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth/current-user";
import { isFreshResetSession, newPasswordProblem } from "@/lib/auth/password";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type PasswordState = { ok?: boolean; error?: string };

/** Whether this session may set a password without the current one. */
export async function cameFromResetLink(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const amr = data?.claims?.amr as { method?: string; timestamp?: number }[] | undefined;
  return isFreshResetSession(amr);
}

/** True if `password` is this person's current password. Doesn't touch their session. */
async function isCurrentPassword(email: string, password: string): Promise<boolean> {
  const check = createPlainClient(supabaseUrl(), supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await check.auth.signInWithPassword({ email, password });
  if (error) return false;
  await check.auth.signOut({ scope: "local" }); // ends only the check's own session
  return true;
}

export async function changeMyPassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const me = await requireUser();
  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const again = String(formData.get("again") ?? "");

  const problem = newPasswordProblem(password, again);
  if (problem) return { error: problem };

  if (!(await cameFromResetLink())) {
    if (!current) return { error: "Please type your current password." };
    if (!(await isCurrentPassword(me.email, current)))
      return { error: "That isn't your current password. Please try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { error: "That's the password you have now. Please pick a new one." };
    if (error.code === "weak_password") return { error: "That password is too easy to guess. Please pick a longer one." };
    return { error: "Couldn't save. Check the internet and try again." };
  }
  return { ok: true };
}
