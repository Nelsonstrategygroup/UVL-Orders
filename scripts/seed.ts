// Loads the starting data from reference/seed-data.json into Supabase.
//
//   npm run seed
//
// Safe to run more than once. It only adds rows that are missing, so it never
// overwrites changes made later on the Setup screen. The sample cut sheet
// (week of 2026-09-28) is added only if that week has no cut sheet yet.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env.local).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildSeed, type SeedData } from "../lib/seed/build-seed";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const data = JSON.parse(readFileSync(join(process.cwd(), "reference", "seed-data.json"), "utf8")) as SeedData;
const plan = buildSeed(data);

async function insertMissing(table: string, rows: object[], onConflict: string) {
  if (!rows.length) return;
  const { error } = await db.from(table).upsert(rows, { onConflict, ignoreDuplicates: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table}: ${rows.length} checked`);
}

async function insertRows(table: string, rows: object[]) {
  if (!rows.length) return;
  const { error } = await db.from(table).insert(rows);
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table}: ${rows.length} added`);
}

async function main() {
  console.log("Catalog");
  const c = plan.catalog;
  await insertMissing("parts", c.parts, "id");
  await insertMissing("size_classes", c.size_classes, "id");
  await insertMissing("cut_specs", c.cut_specs, "id");
  await insertMissing("products", c.products, "id");
  await insertMissing("product_part_uses", c.product_part_uses, "product_id,part_id");

  console.log("Saving goals");
  const { count, error: goalErr } = await db.from("saving_goals").select("id", { count: "exact", head: true });
  if (goalErr) throw new Error(`saving_goals: ${goalErr.message}`);
  if (!count) await insertRows("saving_goals", plan.saving_goals);
  else console.log("  saving_goals: already has rows, skipped");

  console.log("Processor settings");
  const { data: settings, error: setErr } = await db.from("app_settings").select("*").single();
  if (setErr) throw new Error(`app_settings: ${setErr.message}`);
  const p = plan.processor;
  const patch: Record<string, string> = {};
  if (p.email && !settings.processor_email) patch.processor_email = p.email;
  if (p.standing_instructions && !settings.standing_instructions) patch.standing_instructions = p.standing_instructions;
  if (Object.keys(patch).length) {
    const { error } = await db.from("app_settings").update(patch).eq("id", true);
    if (error) throw new Error(`app_settings: ${error.message}`);
    console.log("  app_settings: updated");
  } else {
    console.log("  app_settings: nothing to change");
  }

  console.log(`Sample cut sheet (week of ${plan.sample.week.id})`);
  const { data: existing, error: csErr } = await db
    .from("cut_sheets")
    .select("week_id")
    .eq("week_id", plan.sample.week.id)
    .maybeSingle();
  if (csErr) throw new Error(`cut_sheets: ${csErr.message}`);
  if (existing) {
    console.log("  already there, skipped");
  } else {
    const s = plan.sample;
    await insertMissing("weeks", [s.week], "id");
    await insertRows("cut_sheets", [s.cut_sheet]);
    await insertRows("cut_sheet_banners", s.banners);
    await insertRows("cut_sets", s.sets);
    await insertRows("cut_set_lines", s.lines);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
