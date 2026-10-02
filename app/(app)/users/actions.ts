"use server";

// Admin-only actions for the Users screen.
// Login accounts (email, password) need the service role key, so those calls
// use the admin client. Profile changes (name, role, on/off) go through the
// admin's own session so the audit log records who made them.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/current-user";
import { isRole } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

const MIN_PASSWORD = 8;

function fail(message: string): ActionResult {
  return { ok: false, message };
}

export async function addUser(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = formData.get("role");

  if (!name) return fail("Please enter their name.");
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail("Please enter a full email address.");
  if (password.length < MIN_PASSWORD) return fail(`The password needs at least ${MIN_PASSWORD} characters.`);
  if (!isRole(role)) return fail("Please choose what they do.");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error || !data.user) {
    const taken = error && /already|registered|exists/i.test(error.message);
    return fail(taken ? "Someone already has that email." : `Could not add them: ${error?.message ?? "unknown error"}`);
  }

  const supabase = await createClient();
  const { error: profileError } = await supabase
    .from("profiles")
    .insert({ id: data.user.id, display_name: name, role });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return fail(`Could not add them: ${profileError.message}`);
  }

  revalidatePath("/users");
  return { ok: true, message: `${name} can now log in with ${email}.` };
}

export async function renameUser(userId: string, name: string): Promise<ActionResult> {
  await requireAdmin();
  const clean = name.trim();
  if (!clean) return fail("Please enter a name.");
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ display_name: clean }).eq("id", userId);
  if (error) return fail(`Could not save: ${error.message}`);
  revalidatePath("/users");
  return { ok: true, message: "Name saved." };
}

export async function setUserRole(userId: string, role: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (userId === me.id) return fail("You can't change your own role. Ask another admin.");
  if (!isRole(role)) return fail("Please choose a role.");
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return fail(`Could not save: ${error.message}`);
  revalidatePath("/users");
  return { ok: true, message: "Role saved." };
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  const me = await requireAdmin();
  if (userId === me.id) return fail("You can't turn off your own login.");
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ active }).eq("id", userId);
  if (error) return fail(`Could not save: ${error.message}`);
  revalidatePath("/users");
  return { ok: true, message: active ? "Turned back on. They can log in again." : "Turned off. They are logged out now." };
}

export async function setUserPassword(userId: string, password: string): Promise<ActionResult> {
  await requireAdmin();
  if (password.length < MIN_PASSWORD) return fail(`The password needs at least ${MIN_PASSWORD} characters.`);
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return fail(`Could not set the password: ${error.message}`);
  return { ok: true, message: "New password saved. Tell them in person or by phone." };
}
