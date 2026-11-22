// The real protection: the database. Runs every migration on a local Postgres
// (PGlite) and checks, as each reader role, that writes fail at the database
// whatever SQL gets through, that nothing outside schema `ai` can be read,
// and that each role sees the views its app permissions allow.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migratedDb } from "./testing/migratedDb";
import { READERS, STATEMENT_TIMEOUT } from "./readers";
import { wrapForRows } from "./sqlGuard";

let db: PGlite;

beforeAll(async () => {
  db = await migratedDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const readers = Object.values(READERS).map((r) => r.dbRole);

/** Run statements as a reader; returns the error message, or null if it worked. */
async function asReader(reader: string, sql: string): Promise<string | null> {
  try {
    await db.exec(`set role ${reader}`);
    await db.exec(sql);
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    await db.exec("rollback; reset role;").catch(() => db.exec("reset role"));
  }
}

async function canSelect(reader: string, view: string): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(`select has_table_privilege($1, $2, 'SELECT') as ok`, [reader, `ai.${view}`]);
  return r.rows[0].ok;
}

describe("writes fail at the database, even past the SQL check", () => {
  test.each(readers)("%s cannot INSERT, UPDATE or DELETE through the ai views", async (reader) => {
    expect(await asReader(reader, "delete from ai.orders")).toMatch(/permission denied/);
    expect(await asReader(reader, "update ai.weeks set notes = 'x'")).toMatch(/permission denied/);
    expect(await asReader(reader, "insert into ai.saving_goals (text) values ('x')")).toMatch(/permission denied/);
    expect(await asReader(reader, "truncate public.orders")).toMatch(/permission denied/);
  });

  test.each(readers)("%s cannot read or write the public tables, auth, storage or ai_private", async (reader) => {
    expect(await asReader(reader, "select * from public.orders")).toMatch(/permission denied/);
    expect(await asReader(reader, "delete from public.order_lines")).toMatch(/permission denied/);
    expect(await asReader(reader, "insert into public.audit_log (table_name) values ('x')")).toMatch(/permission denied/);
    expect(await asReader(reader, "select * from auth.users")).toMatch(/permission denied/);
    expect(await asReader(reader, "select * from storage.objects")).toMatch(/permission denied/);
    expect(await asReader(reader, "select * from ai_private.view_areas")).toMatch(/permission denied/);
    expect(await asReader(reader, "select ai_private.sync_reader_grants()")).toMatch(/permission denied/);
    expect(await asReader(reader, "create table ai.x (a int)")).toMatch(/permission denied/);
  });

  test("no reader holds any privilege on a table outside schema ai", async () => {
    const r = await db.query<{ reader: string; tbl: string }>(
      `select r.reader, n.nspname || '.' || c.relname as tbl
       from unnest($1::text[]) r(reader)
       cross join pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'v', 'm', 'p', 'f') and n.nspname not in ('ai', 'pg_catalog', 'information_schema')
         and has_table_privilege(r.reader, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')`,
      [readers],
    );
    expect(r.rows).toEqual([]);
  });

  test("a read-only transaction refuses writes even to someone allowed to write", async () => {
    // As the migration owner, who may write: the transaction Ask opens still refuses.
    await db.exec("begin read only");
    await expect(db.exec("delete from public.saving_goals")).rejects.toThrow(/read-only transaction/);
    await db.exec("rollback");
  });

  test.each(readers)("%s logs in read-only, with a 5 second limit and only schema ai on its path", async (reader) => {
    const r = await db.query<{ setconfig: string[] }>(
      `select s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole where r.rolname = $1`,
      [reader],
    );
    const config = r.rows.flatMap((x) => x.setconfig);
    expect(config).toContain("default_transaction_read_only=on");
    expect(config).toContain(`statement_timeout=${STATEMENT_TIMEOUT}`);
    expect(config).toContain("search_path=ai");
    const role = await db.query<{ rolsuper: boolean; rolcreaterole: boolean; rolbypassrls: boolean; rolinherit: boolean }>(
      `select rolsuper, rolcreaterole, rolbypassrls, rolinherit from pg_roles where rolname = $1`,
      [reader],
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolcreaterole: false, rolbypassrls: false, rolinherit: false });
  });

  test("Ask's own query plan runs as a reader: read only, row cap", async () => {
    await db.exec("set role ai_reader_admin");
    try {
      await db.exec(`begin read only; set local statement_timeout = '${STATEMENT_TIMEOUT}'`);
      const rows = await db.query(wrapForRows("select g from generate_series(1, 900) g"));
      expect(rows.rows.length).toBe(501);
      await expect(db.exec("delete from ai.orders")).rejects.toThrow();
    } finally {
      await db.exec("rollback; reset role;");
    }
  });
});

describe("each role sees what its screens allow (role defaults)", () => {
  test("admin reads every view", async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'ai' and c.relkind = 'v' and not has_table_privilege('ai_reader_admin', c.oid, 'SELECT')`,
    );
    expect(r.rows[0].n).toBe(0);
  });

  test("every ai view is listed in ai_private.view_areas", async () => {
    const r = await db.query<{ viewname: string }>(
      `select viewname from pg_views where schemaname = 'ai'
       except select view_name from ai_private.view_areas`,
    );
    expect(r.rows).toEqual([]);
  });

  test("packing: orders, packing, boxes, lots, pallets, manifests, freezer; no households, prices, P&L or producer pay", async () => {
    for (const v of ["orders", "order_lines", "products", "customers", "weeks", "packing_weights", "lots", "pallets", "shipments", "manifest_boxes", "freezer_boxes", "freezer_log", "half_whole_orders"]) {
      expect(await canSelect("ai_reader_packing", v), v).toBe(true);
    }
    for (const v of ["half_whole_contacts", "customer_contacts", "contact_log", "prices", "invoices", "invoice_lines", "pnl_income", "pnl_expenses", "freezer_box_values", "kill_lambs", "producers", "truck_runs", "cut_sets"]) {
      expect(await canSelect("ai_reader_packing", v), v).toBe(false);
    }
  });

  test("Accountant (billing) matches the app: invoices, orders, P&L, carcass weights, truck runs", async () => {
    for (const v of ["invoices", "invoice_lines", "payments", "prices", "orders", "manifest_boxes", "pnl_income", "pnl_expenses", "kill_lambs", "producers", "truck_runs"]) {
      expect(await canSelect("ai_reader_billing", v), v).toBe(true);
    }
    // (The cut sheet is open to the Accountant through Print and download, as in the app.)
    for (const v of ["contact_log", "freezer_counts", "gtin_products"]) {
      expect(await canSelect("ai_reader_billing", v), v).toBe(false);
    }
  });

  test("Operations lead (office): no money", async () => {
    expect(await canSelect("ai_reader_office", "orders")).toBe(true);
    for (const v of ["prices", "invoices", "pnl_income", "kill_lambs", "freezer_box_values"]) {
      expect(await canSelect("ai_reader_office", v), v).toBe(false);
    }
  });

  test("changing a role's defaults on the Users screen re-grants at once", async () => {
    expect(await canSelect("ai_reader_packing", "prices")).toBe(false);
    await db.exec(`update public.role_permissions set level = 1 where role = 'packing' and area = 'prices'`);
    expect(await canSelect("ai_reader_packing", "prices")).toBe(true);
    await db.exec(`update public.role_permissions set level = 0 where role = 'packing' and area = 'prices'`);
    expect(await canSelect("ai_reader_packing", "prices")).toBe(false);
  });

  test("anon and authenticated get nothing in schema ai", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ ok: boolean }>(`select has_schema_privilege($1, 'ai', 'USAGE') as ok`, [role]);
      expect(r.rows[0].ok, role).toBe(false);
    }
  });
});
