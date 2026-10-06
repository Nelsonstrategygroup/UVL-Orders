// What an admin may do to a login on the Users screen. The screen uses this to
// hide buttons, and the server actions check it again before doing anything.
// The database also refuses to leave no active admin (see the migration
// "keep_an_admin").

import type { Role } from "./roles";

export type UserLite = { id: string; role: Role; active: boolean; lastLoginAt: string | null };

export type UserAction = "turnOff" | "delete" | "changeRole" | "changeEmail";

/** Active admins other than `id`. */
function otherActiveAdmins(users: UserLite[], id: string) {
  return users.filter((u) => u.id !== id && u.role === "admin" && u.active).length;
}

/**
 * Why `actorId` can't do `action` to `target`, in plain words, or null if
 * they can. For "changeRole", `newRole` is the role being picked.
 */
export function blockedReason(
  action: UserAction,
  target: UserLite,
  users: UserLite[],
  actorId: string,
  newRole?: Role,
): string | null {
  const isMe = target.id === actorId;
  const lastAdmin = target.role === "admin" && target.active && otherActiveAdmins(users, target.id) === 0;
  switch (action) {
    case "turnOff":
      if (isMe) return "You can't turn off your own login.";
      if (lastAdmin) return "This is the only admin who can log in. Make someone else an admin first.";
      return null;
    case "delete":
      if (isMe) return "You can't delete your own login.";
      if (target.lastLoginAt) return "They have logged in before, so their login can only be turned off.";
      if (lastAdmin) return "This is the only admin who can log in. Make someone else an admin first.";
      return null;
    case "changeRole":
      if (isMe) return "You can't change your own role. Ask another admin.";
      if (lastAdmin && newRole !== "admin")
        return "This is the only admin who can log in. Make someone else an admin first.";
      return null;
    case "changeEmail":
      if (target.lastLoginAt) return "They have logged in before, so their email can't be changed here.";
      return null;
  }
}

/** Sort by name, ignoring case; people without a name go by email. */
export function byName<T extends { name: string; email: string }>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    (a.name || a.email).localeCompare(b.name || b.email, undefined, { sensitivity: "base" }),
  );
}
