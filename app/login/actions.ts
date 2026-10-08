"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { homeFor, isRole } from "@/lib/auth/roles";

export type LoginState = { error?: string; email?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Please enter your email and password.", email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const wrongPassword = error.code === "invalid_credentials" || error.status === 400;
    return {
      error: wrongPassword
        ? "That email and password don't match. Please try again."
        : "Can't connect right now. Check the internet and try again.",
      email,
    };
  }

  // Stamp last_login_at (starts today's session) and check the login is turned on.
  const { data: active, error: rpcError } = await supabase.rpc("record_login");
  if (rpcError || active !== true) {
    await supabase.auth.signOut({ scope: "local" });
    return {
      error: rpcError
        ? "Something went wrong. Please try again."
        : "This login is turned off. Ask Kathy or Eric to turn it back on.",
      email,
    };
  }

  const { data: claims } = await supabase.auth.getClaims();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", claims?.claims?.sub ?? "")
    .maybeSingle();

  redirect(profile && isRole(profile.role) ? homeFor(profile.role) : "/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?m=out");
}

export type ResetState = { sent?: boolean; error?: string; email?: string };

/** The app's own address, for links in emails. Production sets NEXT_PUBLIC_SITE_URL. */
async function siteUrl(): Promise<string> {
  const fromEnv = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * "Forgot password?": email a reset link. The answer is always the same, so
 * the page never tells anyone whether an email has a login. Turned-off
 * logins get no link.
 */
export async function requestPasswordReset(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Please enter your full email address.", email };

  try {
    const admin = createAdminClient();
    let userId: string | null = null;
    for (let page = 1; page < 50 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      userId = data.users.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
      if (data.users.length < 200) break;
    }
    if (userId) {
      const { data: profile } = await admin.from("profiles").select("active").eq("id", userId).maybeSingle();
      if (profile?.active) {
        const supabase = await createClient();
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${await siteUrl()}/auth/confirm`,
        });
        if (error) console.error("Password reset email failed:", error.message);
      }
    }
  } catch (e) {
    // Logged for us; the person sees the same message either way.
    console.error("Password reset failed:", e instanceof Error ? e.message : e);
  }
  return { sent: true, email };
}
