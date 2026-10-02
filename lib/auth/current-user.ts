import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isRole, type Role } from "./roles";

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
};

/** The logged-in, active person, or null. Cached for one request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role, active")
    .eq("id", claims.sub)
    .maybeSingle();
  if (!profile || !profile.active || !isRole(profile.role)) return null;

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    displayName: profile.display_name,
    role: profile.role,
  };
});

/** For pages and actions: the current person, or send them to /login. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For admin-only pages and actions. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
