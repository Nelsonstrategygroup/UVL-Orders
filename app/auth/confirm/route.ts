// Where the "Forgot password?" email link lands.
//
// The email template sends ?token_hash=...&type=recovery, which works even
// when the link is opened on a different device from the one that asked.
// Supabase's default template sends ?code=... instead, which works only in
// the same browser; both are handled.
//
// On success the person is logged in for today (record_login) and goes to
// /password to set a new one. Turned-off logins are logged straight out.

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  // A good link replaces whoever was logged in on this device; a bad one leaves them be.
  const supabase = await createClient();

  let ok = false;
  if (tokenHash && type === "recovery") {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }
  if (!ok) return to("/login/forgot?m=expired");

  const { data: active, error } = await supabase.rpc("record_login");
  if (error || active !== true) {
    await supabase.auth.signOut({ scope: "local" });
    return to(error ? "/login?m=link" : "/login?m=off");
  }
  return to("/password");
}
