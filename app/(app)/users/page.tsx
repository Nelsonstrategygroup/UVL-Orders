import { requireAdmin } from "@/lib/auth/current-user";
import { isRole } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import UsersScreen, { type UserRow } from "./UsersScreen";

export const metadata = { title: "Users · Umpqua Valley Lamb" };

export default async function UsersPage() {
  const me = await requireAdmin();

  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, display_name, role, active, last_login_at")
    .order("active", { ascending: false })
    .order("display_name");

  // Emails live in Supabase Auth, which only the service role can list.
  const emails = new Map<string, string>();
  const admin = createAdminClient();
  for (let page = 1; page < 50; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    for (const u of data?.users ?? []) emails.set(u.id, u.email ?? "");
    if (!data || data.users.length < 200) break;
  }

  const users: UserRow[] = (profiles ?? [])
    .filter((p) => isRole(p.role))
    .map((p) => ({
      id: p.id,
      name: p.display_name,
      email: emails.get(p.id) ?? "",
      role: p.role,
      active: p.active,
      lastLoginAt: p.last_login_at,
    }));

  return (
    <div className="mx-auto max-w-[720px]">
      <h2 className="mb-1">Users</h2>
      <p className="muted mb-4">Who can log in, and what they can do.</p>
      {error ? (
        <p className="note bad">Could not load users: {error.message}</p>
      ) : (
        <UsersScreen users={users} myId={me.id} />
      )}
    </div>
  );
}
