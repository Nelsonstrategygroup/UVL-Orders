// Runs the assistant's query as the reader for the signed-in person's role.
// Server only. The connection string comes from that role's env var; the
// service role key is never used on this path.

import "server-only";
import postgres from "postgres";
import type { Role } from "@/lib/auth/roles";
import { checkSql, MAX_ROWS } from "./sqlGuard";
import { READERS, STATEMENT_TIMEOUT } from "./readers";

export type QueryResult =
  | { ok: true; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }
  | { ok: false; error: string };

/** Results sent back to the model are cut to about this many characters of JSON. */
const MAX_RESULT_CHARS = 60_000;

/** The reader's connection string, or null when its env var isn't set. */
export function readerUrl(role: Role): string | null {
  const v = process.env[READERS[role].envVar];
  return v && v.trim() ? v.trim() : null;
}

type Sql = ReturnType<typeof postgres>;

function connect(url: string): Sql {
  return postgres(url, {
    max: 1,
    prepare: false, // works through Supabase's transaction pooler
    idle_timeout: 5,
    connect_timeout: 10,
    query_timeout: 10,
    // Dates and times as the database writes them, not as JS Dates.
    types: {
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      timestamptz: { to: 1184, from: [1184, 1114], serialize: (x: string) => x, parse: (x: string) => x },
    },
    connection: { application_name: "uvl-ask" },
  });
}

/** One open connection for one question; close it with `end`. */
export function openReader(url: string) {
  const sql = connect(url);
  return {
    /** Check and run one query from the model, read only, at most MAX_ROWS rows. Never throws. */
    async run(query: string): Promise<QueryResult> {
      const check = await checkSql(query);
      if (!check.ok) return { ok: false, error: check.reason };
      try {
        const rows = (await sql.begin("read only", async (tx) => {
          await tx.unsafe(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`);
          return tx.unsafe(check.wrapped);
        })) as unknown as Record<string, unknown>[];
        let list = [...rows];
        let truncated = list.length > MAX_ROWS;
        if (truncated) list = list.slice(0, MAX_ROWS);
        while (list.length > 1 && JSON.stringify(list).length > MAX_RESULT_CHARS) {
          list = list.slice(0, Math.ceil(list.length / 2));
          truncated = true;
        }
        return { ok: true, rows: list, rowCount: list.length, truncated };
      } catch (e) {
        return { ok: false, error: dbError(e) };
      }
    },
    /** The ai views this reader can SELECT (for picking the data guide). */
    async views(): Promise<string[]> {
      const rows = await sql.unsafe(
        `select table_name::text as name from information_schema.tables where table_schema = 'ai' order by 1`,
      );
      return (rows as unknown as { name: string }[]).map((r) => r.name);
    },
    end: () => sql.end({ timeout: 2 }),
  };
}

/** The database's message, for the model to fix its query. Never includes the connection string. */
function dbError(e: unknown): string {
  const err = e as { message?: string; code?: string; hint?: string; position?: string };
  const parts = [err.message ?? "The query failed."];
  if (err.hint) parts.push(`Hint: ${err.hint}`);
  if (err.code === "57014") parts.push("(The 5 second limit was reached. Narrow the query.)");
  return parts.join(" ").replace(/postgres(ql)?:\/\/\S+/gi, "[connection]");
}
