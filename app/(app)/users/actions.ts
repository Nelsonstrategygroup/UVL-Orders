"use server";

// Admin-only actions for the Users screen.
// Login accounts (email, password) need the service role key, so those calls
// use the admin client. Profile changes (name, role, on/off) go through the
// admin's own session so the audit log records who made them.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/current-user";
import { isRole } from "@/lib/auth/roles";
import { blockedReason, type UserAction, type UserLite } from "@/lib/auth/userRules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

const MIN_PASSWORD = 8;

function fail(message: string): ActionResult {
  return { ok: false, message };
}

const EMAIL = /^\S+@\S+\.\S+$/;

/** Everyone, fresh from the database, for the safety rules in userRules. */
async function check(
  supabase: Awaited<ReturnType<typeof createClient>>,
  action: UserAction,
  actorId: string,
  userId: string,
  newRole?: string,
): Promise<string | null> {
  const { data, error } = await supabase.from("profiles").select("id, role, active, last_login_at");
  if (error) return `Could not check: ${error.message}`;
  const users: UserLite[] = (data ?? [])
    .filter((p) => isRole(p.role))
    .map((p) => ({ id: p.id, role: p.role, active: p.active, lastLoginAt: p.last_login_at }));
  const target = users.find((u) => u.id === userId);
  if (!target) return "That person isn't in the list any more.";
  return blockedReason(action, target, users, actorId, isRole(newRole) ? newRole : undefined);
}

/** Pass on the database's own "only admin" refusal as it is. */
function saveError(message: string): ActionResult {
  return fail(/only admin/i.test(message) ? message : `Could not save: ${message}`);
}

export async function addUser(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = formData.get("role");

  if (!name) return fail("Please enter their name.");
  if (!EMAIL.test(email)) return fail("Please enter a full email address.");
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
  if (!isRole(role)) return fail("Please choose a role.");
  const supabase = await createClient();
  const blocked = await check(supabase, "changeRole", me.id, userId, role);
  if (blocked) return fail(blocked);
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return saveError(error.message);
  revalidatePath("/users");
  return { ok: true, message: "Role saved." };
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  const me = await requireAdmin();
  const supabase = await createClient();
  if (!active) {
    const blocked = await check(supabase, "turnOff", me.id, userId);
    if (blocked) return fail(blocked);
  }
  const { error } = await supabase.from("profiles").update({ active }).eq("id", userId);
  if (error) return saveError(error.message);
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

/**
 * Fix the email of someone who has never logged in (a typo when adding them).
 * Their password stays the same.
 */
export async function setUserEmail(userId: string, email: string): Promise<ActionResult> {
  const me = await requireAdmin();
  const clean = email.trim().toLowerCase();
  if (!EMAIL.test(clean)) return fail("Please enter a full email address.");
  const supabase = await createClient();
  const blocked = await check(supabase, "changeEmail", me.id, userId);
  if (blocked) return fail(blocked);
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { email: clean, email_confirm: true });
  if (error) {
    const taken = /already|registered|exists/i.test(error.message);
    return fail(taken ? "Someone already has that email." : `Could not save: ${error.message}`);
  }
  revalidatePath("/users");
  return { ok: true, message: `Email saved. They log in with ${clean}.` };
}

/**
 * Delete the login of someone who has never logged in: the app's record and
 * the Supabase login account. People who have logged in can only be turned off.
 */
export async function deleteUser(userId: string): Promise<ActionResult> {
  const me = await requireAdmin();
  const supabase = await createClient();
  const blocked = await check(supabase, "delete", me.id, userId);
  if (blocked) return fail(blocked);

  // The profile goes first, through the admin's session, so the audit log
  // records who deleted it. Then the login account.
  const { data: saved, error: readErr } = await supabase
    .from("profiles")
    .select("id, display_name, role, active")
    .eq("id", userId)
    .single();
  if (readErr || !saved) return fail(`Could not delete: ${readErr?.message ?? "not found"}`);
  const { error: delErr } = await supabase.from("profiles").delete().eq("id", userId);
  if (delErr) return saveError(delErr.message);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // Put the profile back so nothing is left half done.
    await supabase.from("profiles").insert(saved);
    return fail(`Could not delete the login: ${error.message}`);
  }
  revalidatePath("/users");
  return { ok: true, message: `Deleted ${saved.display_name || "this login"}.` };
}
