// Supabase client for Client Components (runs in the browser).
// Uses the publishable key; Row Level Security decides what each person can see.

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

export function createClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
