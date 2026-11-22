// The second lock on the assistant's SQL (the first is the database: the
// reader roles can only SELECT their own views, in read-only sessions).
//
// Parses with Postgres's own parser (libpg-query) and allows exactly one
// SELECT (WITH ... SELECT included) that reads only schema `ai`, and calls no
// function that sleeps, reaches other databases, reads files or settings, or
// touches sequences. Then wraps it so no more than MAX_ROWS come back.

import { parse } from "libpg-query";

export const MAX_ROWS = 500;

export type SqlCheck = { ok: true; statement: string; wrapped: string } | { ok: false; reason: string };

/** Functions never allowed, by exact (lowercase) name. Anything starting with pg_ is refused too. */
const DENIED_FUNCTIONS = new Set([
  "current_setting",
  "set_config",
  "nextval",
  "setval",
  "currval",
  "lastval",
  "query_to_xml",
  "query_to_xmlschema",
  "query_to_xml_and_xmlschema",
  "cursor_to_xml",
  "cursor_to_xmlschema",
  "table_to_xml",
  "table_to_xmlschema",
  "table_to_xml_and_xmlschema",
  "schema_to_xml",
  "schema_to_xmlschema",
  "schema_to_xml_and_xmlschema",
  "database_to_xml",
  "database_to_xmlschema",
  "database_to_xml_and_xmlschema",
  "txid_current",
  "txid_current_if_assigned",
  "inet_server_addr",
  "inet_server_port",
]);
const DENIED_PREFIXES = ["pg_", "dblink", "lo_", "binary_upgrade_"];

/** Statement node types allowed anywhere in the tree (everything else ending in "Stmt" is refused). */
const ALLOWED_STATEMENTS = new Set(["SelectStmt"]);

function deniedFunction(name: string): boolean {
  const n = name.toLowerCase();
  return DENIED_FUNCTIONS.has(n) || DENIED_PREFIXES.some((p) => n.startsWith(p));
}

type Node = Record<string, unknown>;

function sval(v: unknown): string | undefined {
  const s = (v as { String?: { sval?: string } })?.String?.sval;
  return typeof s === "string" ? s : undefined;
}

/** Walk the parse tree; return the first reason to refuse it, or null. */
function problem(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const p = problem(item);
      if (p) return p;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;

  for (const [key, value] of Object.entries(node as Node)) {
    if (key.endsWith("Stmt") && !ALLOWED_STATEMENTS.has(key)) {
      return `Only SELECT is allowed (found ${key.replace(/Stmt$/, "").toUpperCase()}).`;
    }
    const v = value as Node;
    if (key === "SelectStmt") {
      if (v.intoClause) return "SELECT INTO is not allowed.";
      if (v.lockingClause) return "FOR UPDATE / FOR SHARE is not allowed.";
    }
    if (key === "RangeVar") {
      if (v.catalogname) return "Database-qualified names are not allowed.";
      const schema = typeof v.schemaname === "string" ? v.schemaname : undefined;
      if (schema && schema !== "ai") return `Only the ai views can be read (not ${schema}.${v.relname}).`;
      if (typeof v.relname === "string" && v.relname.toLowerCase().startsWith("pg_")) {
        return `System catalogs can't be read (${v.relname}).`;
      }
    }
    if (key === "FuncCall") {
      const parts = (Array.isArray(v.funcname) ? v.funcname : []).map(sval).filter(Boolean) as string[];
      const name = parts[parts.length - 1] ?? "";
      if (parts.length > 1 && !(parts.length === 2 && parts[0] === "pg_catalog")) {
        return `Schema-qualified function calls are not allowed (${parts.join(".")}).`;
      }
      if (deniedFunction(name)) return `The function ${name}() is not allowed.`;
    }
    const p = problem(value);
    if (p) return p;
  }
  return null;
}

/** Check one query from the model. Never throws. */
export async function checkSql(sql: string): Promise<SqlCheck> {
  if (typeof sql !== "string" || !sql.trim()) return { ok: false, reason: "The query is empty." };
  if (sql.length > 20000) return { ok: false, reason: "The query is too long." };

  let tree: { stmts?: { stmt?: Node; stmt_location?: number; stmt_len?: number }[] };
  try {
    tree = await parse(sql);
  } catch (e) {
    return { ok: false, reason: `SQL syntax error: ${(e as Error).message}` };
  }
  const stmts = tree.stmts ?? [];
  if (stmts.length !== 1) return { ok: false, reason: "Send exactly one SELECT statement." };
  const { stmt, stmt_location = 0, stmt_len = 0 } = stmts[0];
  if (!stmt || !("SelectStmt" in stmt)) return { ok: false, reason: "Only a single SELECT is allowed." };

  const p = problem(stmt);
  if (p) return { ok: false, reason: p };

  const statement = (stmt_len > 0 ? sql.slice(stmt_location, stmt_location + stmt_len) : sql.slice(stmt_location)).trim();
  return { ok: true, statement, wrapped: wrapForRows(statement) };
}

/**
 * The query inside a row cap: one more than MAX_ROWS is fetched so a cut-off
 * result can be told apart from one that just fits. Newlines around the query
 * keep a trailing "-- comment" from swallowing the wrapper.
 */
export function wrapForRows(statement: string): string {
  return `select * from (\n${statement}\n) as ask_result limit ${MAX_ROWS + 1}`;
}
