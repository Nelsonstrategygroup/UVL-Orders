// Checks Ask's database readers once their connection strings are set
// (lib/ai/README.md, step 4). For each AI_DB_URL_* in .env.local: connects,
// reads, and makes sure a write and a read of a public table are refused.
// Prints no connection strings or passwords.
//
//   npm run ai:check

import postgres from "postgres";
import { READERS } from "../lib/ai/readers";

async function checkOne(role: string, envVar: string, url: string) {
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 2 });
  const line = (ok: boolean, what: string) => console.log(`  ${ok ? "OK  " : "FAIL"} ${what}`);
  console.log(`${role} (${envVar})`);
  try {
    const [who] = await sql`select current_user as u, current_setting('default_transaction_read_only') as ro,
                                   current_setting('statement_timeout') as t`;
    line(who.u === READERS[role as keyof typeof READERS].dbRole, `logged in as ${who.u}`);
    line(who.ro === "on", `read-only by default (${who.ro})`);
    line(who.t === "5s", `statement limit ${who.t}`);
    const views = await sql`select count(*)::int n from information_schema.tables where table_schema = 'ai'`;
    line(views[0].n > 0, `can read ${views[0].n} views`);
    const weeks = await sql`select count(*)::int n from ai.weeks`.catch(() => null);
    if (weeks) line(true, `read ai.weeks (${weeks[0].n} rows)`);
    const refused = async (q: string) => sql.unsafe(q).then(() => false, () => true);
    line(await refused("delete from ai.saving_goals where false"), "DELETE refused");
    line(await refused("select 1 from public.orders limit 1"), "public tables refused");
  } catch (e) {
    console.log(`  FAIL could not connect or query: ${(e as Error).message.replace(/postgres(ql)?:\/\/\S+/gi, "[connection]")}`);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function main() {
  let any = false;
  for (const [role, { envVar }] of Object.entries(READERS)) {
    const url = process.env[envVar]?.trim();
    if (!url) continue;
    any = true;
    await checkOne(role, envVar, url);
  }
  for (const v of ["ANTHROPIC_API_KEY", "AI_MODEL"]) console.log(`${v}: ${process.env[v]?.trim() ? "set" : "MISSING"}`);
  if (!any) console.log("No AI_DB_URL_* variables are set in .env.local yet.");
}

main();
