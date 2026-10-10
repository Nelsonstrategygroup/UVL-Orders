// Runs before every page request (Next.js 16 calls middleware "proxy").
//
// 1. Refreshes the Supabase session cookie.
// 2. Sends anyone not logged in to /login.
// 3. Signs out people who are turned off, or who last logged in before
//    this morning's 3:00 AM Pacific cutoff (lib/auth/session.ts).
// 4. Keeps each person on the screens they may open (role defaults plus
//    their own changes, from my_permissions).

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { needsDailyLogin } from "@/lib/auth/session";
import { ALL_ACCESS, canOpen, homeFor, isRole, permsFrom } from "@/lib/auth/roles";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Do not run other code between createServerClient and getClaims:
  // getClaims refreshes an expired session and writes the new cookies.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  const path = request.nextUrl.pathname;
  // Pages for people who aren't logged in: log in, and "Forgot password?".
  const onLogin = path === "/login" || path === "/login/forgot";

  // The reset link signs the person in itself (app/auth/confirm), so let it
  // through whether or not someone is logged in on this device.
  if (path === "/auth/confirm") return response;

  // Redirect while keeping any refreshed or cleared auth cookies.
  const redirectTo = (pathname: string, message?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = message ? `?m=${message}` : "";
    const r = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) r.cookies.set(c);
    return r;
  };

  if (!userId) return onLogin ? response : redirectTo("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, active, last_login_at")
    .eq("id", userId)
    .maybeSingle();

  // If the database can't be reached, don't log anyone out mid-day.
  // Row Level Security still protects the data.
  if (error) return response;

  let reason: "off" | "morning" | null = null;
  if (!profile || !profile.active || !isRole(profile.role)) reason = "off";
  else if (needsDailyLogin(profile.last_login_at)) reason = "morning";

  if (reason) {
    await supabase.auth.signOut({ scope: "local" });
    return onLogin ? response : redirectTo("/login", reason);
  }

  // What this person may open: their role's defaults plus their own changes.
  const role = profile!.role;
  let perms = ALL_ACCESS;
  if (role !== "admin") {
    const { data, error: permErr } = await supabase.rpc("my_permissions");
    if (permErr) return response; // RLS still protects the data
    perms = permsFrom(data);
  }
  if (onLogin || path === "/" || !canOpen(perms, role, path)) return redirectTo(homeFor(perms, role));

  return response;
}

export const config = {
  matcher: [
    // Every page except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
