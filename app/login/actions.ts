"use server";

import { redirect } from "next/navigation";
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
