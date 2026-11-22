import { describe, expect, test } from "vitest";
import { checkSql, MAX_ROWS } from "./sqlGuard";

async function refused(sql: string): Promise<string> {
  const r = await checkSql(sql);
  expect(r.ok, sql).toBe(false);
  return r.ok ? "" : r.reason;
}

describe("checkSql allows", () => {
  test("a plain select, with or without the ai schema", async () => {
    for (const sql of [
      "select * from orders",
      "select o.id from ai.orders o join ai.customers c on c.id = o.customer_id where o.week_id = '2026-11-16'",
      "select count(*), sum(weight) from packing_weights group by product_id order by 1 desc",
    ]) {
      const r = await checkSql(sql);
      expect(r.ok, sql).toBe(true);
    }
  });

  test("WITH ... SELECT, window functions, generate_series, a trailing semicolon and comment", async () => {
    const r = await checkSql(
      "with w as (select id, invoice_number from weeks) select *, row_number() over (order by id) from w; -- done",
    );
    expect(r.ok).toBe(true);
    expect((await checkSql("select d::date from generate_series('2026-11-01'::date, '2026-11-30', '1 day') d")).ok).toBe(true);
  });

  test("wraps the query with a row cap of 501, dropping the semicolon", async () => {
    const r = await checkSql("select id from weeks -- last weeks\n;");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.statement).toBe("select id from weeks -- last weeks");
    expect(r.wrapped).toBe(`select * from (\nselect id from weeks -- last weeks\n) as ask_result limit ${MAX_ROWS + 1}`);
  });
});

describe("checkSql refuses", () => {
  test("writes and other statements", async () => {
    expect(await refused("delete from orders")).toMatch(/SELECT/);
    expect(await refused("update orders set status = 'none'")).toMatch(/SELECT/);
    expect(await refused("insert into orders (id) values (gen_random_uuid())")).toMatch(/SELECT/);
    expect(await refused("truncate orders")).toMatch(/SELECT/);
    expect(await refused("drop view ai.orders")).toMatch(/SELECT/);
    expect(await refused("set role postgres")).toMatch(/SELECT/);
    expect(await refused("copy (select 1) to '/tmp/x'")).toMatch(/SELECT/);
    expect(await refused("begin")).toMatch(/SELECT/);
  });

  test("a write hidden in a CTE, SELECT INTO, FOR UPDATE", async () => {
    expect(await refused("with d as (delete from orders returning *) select * from d")).toMatch(/DELETE/);
    expect(await refused("with u as (update weeks set notes = '' returning id) select * from u")).toMatch(/UPDATE/);
    expect(await refused("select * into new_table from orders")).toMatch(/INTO/);
    expect(await refused("select * from orders for update")).toMatch(/FOR UPDATE/);
  });

  test("more than one statement", async () => {
    expect(await refused("select 1; select 2")).toMatch(/exactly one/);
    expect(await refused("select 1; delete from orders")).toMatch(/exactly one/);
  });

  test("other schemas and system catalogs", async () => {
    expect(await refused("select * from public.orders")).toMatch(/public\.orders/);
    expect(await refused("select * from auth.users")).toMatch(/auth\.users/);
    expect(await refused("select * from storage.objects")).toMatch(/storage/);
    expect(await refused("select * from information_schema.tables")).toMatch(/information_schema/);
    expect(await refused("select * from pg_catalog.pg_roles")).toMatch(/pg_catalog/);
    expect(await refused("select * from pg_settings")).toMatch(/System catalogs/);
    expect(await refused("select * from orders where id in (select oid::text::uuid from pg_class)")).toMatch(/System/);
  });

  test("sleeping, other databases, files, settings and sequences", async () => {
    expect(await refused("select pg_sleep(10)")).toMatch(/pg_sleep/);
    expect(await refused("select * from orders where pg_sleep(1) is null")).toMatch(/pg_sleep/);
    expect(await refused("select pg_read_file('/etc/passwd')")).toMatch(/pg_read_file/);
    expect(await refused("select pg_ls_dir('.')")).toMatch(/pg_ls_dir/);
    expect(await refused("select * from dblink('host=x', 'select 1') as t(a int)")).toMatch(/dblink/);
    expect(await refused("select lo_import('/etc/passwd')")).toMatch(/lo_import/);
    expect(await refused("select current_setting('request.jwt.claims')")).toMatch(/current_setting/);
    expect(await refused("select set_config('search_path', 'public', false)")).toMatch(/set_config/);
    expect(await refused("select nextval('some_seq')")).toMatch(/nextval/);
    expect(await refused("select query_to_xml('select 1', true, true, '')")).toMatch(/query_to_xml/);
    expect(await refused("select public.is_admin()")).toMatch(/Schema-qualified/);
    expect(await refused("select pg_catalog.pg_sleep(1)")).toMatch(/pg_sleep/);
  });

  test("bad syntax and empty input, with the parser's message", async () => {
    expect(await refused("selec * from orders")).toMatch(/syntax error/);
    expect(await refused("   ")).toMatch(/empty/);
  });
});
