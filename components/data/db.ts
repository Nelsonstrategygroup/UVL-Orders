"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

let browserClient: SupabaseClient | null = null;

/** One browser Supabase client for the whole app (office and packing screens). */
export function getDb(): SupabaseClient {
  browserClient ??= createClient();
  return browserClient;
}
