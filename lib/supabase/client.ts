// Supabase client for Client Components (runs in the browser).
// Uses the publishable key; Row Level Security decides what each person can see.
//
// Never answered from the browser's cache (10/26/26): the database's answers
// come with no caching instructions, so a browser kept an error response and
// showed it again after the database was fixed. The data changes all the
// time, so every request goes to the server.

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

const noStore: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });

export function createClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey(), { global: { fetch: noStore } });
}
