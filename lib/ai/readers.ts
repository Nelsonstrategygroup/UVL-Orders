// Which database reader Ask uses for each app role, and which roles can use
// Ask at all. The role always comes from the signed-in person's profile on
// the server, never from the browser or the model.

import type { Role } from "@/lib/auth/roles";

/** One Postgres login per app role (migration 20261126000100), and the env var holding its connection string. */
export const READERS: Record<Role, { dbRole: string; envVar: string }> = {
  admin: { dbRole: "ai_reader_admin", envVar: "AI_DB_URL_ADMIN" },
  billing: { dbRole: "ai_reader_billing", envVar: "AI_DB_URL_BILLING" },
  packing: { dbRole: "ai_reader_packing", envVar: "AI_DB_URL_PACKING" },
  office: { dbRole: "ai_reader_office", envVar: "AI_DB_URL_OFFICE" },
  viewer: { dbRole: "ai_reader_viewer", envVar: "AI_DB_URL_VIEWER" },
};

/** Roles that can use Ask for now (Lucas, 11/22/26: not Operations lead or Viewer yet). */
export const ASK_ROLES: readonly Role[] = ["admin", "billing", "packing"];

export function canAsk(role: Role): boolean {
  return ASK_ROLES.includes(role);
}

/** Statement limit inside each query's transaction (the reader roles also default to it). */
export const STATEMENT_TIMEOUT = "5s";
