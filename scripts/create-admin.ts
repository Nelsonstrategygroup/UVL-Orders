// Creates the first admin login, so someone can log in and use the Users screen.
//
//   npm run create-admin -- "Lucas Nelson" lucas@example.com
//
// It asks for nothing else: it prints a strong temporary password. Log in with
// it, then set your own from the Users screen. If the email already has a
// login, it is made an active admin and its password is left alone.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env.local).

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const [name, emailArg] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
if (!name || !email) {
  console.error('Usage: npm run create-admin -- "Full Name" email@example.com');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserId(target: string): Promise<string | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  let id = await findUserId(email);
  let password: string | null = null;

  if (!id) {
    password = randomBytes(12).toString("base64url");
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    if (error || !data.user) throw error ?? new Error("Could not create the login.");
    id = data.user.id;
  }

  const { error } = await db
    .from("profiles")
    .upsert({ id, display_name: name, role: "admin", active: true }, { onConflict: "id" });
  if (error) throw error;

  console.log(`${name} <${email}> is an admin.`);
  if (password) console.log(`Temporary password: ${password}\nLog in, then set a new password on the Users screen.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
