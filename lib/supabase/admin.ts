// Supabase client with the service role key. Bypasses Row Level Security.
//
// SERVER ONLY. Use it only in Server Actions and Route Handlers, and only for
// things a normal session cannot do (creating logins, setting passwords,
// reading login emails). The "server-only" import makes the build fail if a
// Client Component ever imports this file.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set. See .env.example.");
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
