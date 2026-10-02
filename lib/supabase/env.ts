// Public Supabase settings. Safe in the browser.
// Next.js inlines NEXT_PUBLIC_ values at build time, so they must be read
// with literal property names.

export function supabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set. See .env.example.");
  return v;
}

export function supabasePublishableKey(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set. See .env.example.");
  return v;
}
