// Lamb cost data (SPEC 16, stage 1): producers, pricing settings and
// producer rates. Admins only (Row Level Security). Nothing else in the app
// reads these tables. Money and factors go to the database as decimal
// strings, never floats.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LambCostSetting, Producer, ProducerRate } from "../calc/lambCost";

export type LambCostSetup = {
  producers: Producer[];
  settings: LambCostSetting[];
  rates: ProducerRate[];
};

/** Database errors in plain words. */
function plain(e: { message: string; code?: string } | null): string | null {
  if (!e) return null;
  if (e.code === "23505" && /lamb_cost_settings/.test(e.message)) return "There's already a setting starting that day.";
  if (e.code === "23505" && /producer_rates/.test(e.message)) return "This producer already has a rate starting that day.";
  if (e.code === "23514" && /name/.test(e.message)) return "Type the producer's name.";
  if (e.code === "42501") return "Only an admin can change this.";
  return e.message;
}

export async function loadLambCostSetup(db: SupabaseClient): Promise<LambCostSetup> {
  const [p, s, r] = await Promise.all([
    db.from("producers").select("id, name, ranch_name, contact, active").order("name"),
    db.from("lamb_cost_settings").select("id, effective_from, base_rate, live_factor, note").order("effective_from", { ascending: false }),
    db.from("producer_rates").select("id, producer_id, effective_from, rate, note").order("effective_from", { ascending: false }),
  ]);
  const err = p.error ?? s.error ?? r.error;
  if (err) throw new Error(err.message);
  return {
    producers: (p.data ?? []) as Producer[],
    settings: (s.data ?? []) as LambCostSetting[],
    rates: (r.data ?? []) as ProducerRate[],
  };
}

/** Add a producer (no id) or change one. */
export async function saveProducer(
  db: SupabaseClient,
  p: { id?: string; name: string; ranch_name: string; contact: string; active: boolean },
): Promise<string | null> {
  const row = { name: p.name.trim(), ranch_name: p.ranch_name.trim(), contact: p.contact.trim(), active: p.active };
  const { error } = p.id ? await db.from("producers").update(row).eq("id", p.id) : await db.from("producers").insert(row);
  return plain(error);
}

/** Add a pricing setting from a date on. */
export async function addLambCostSetting(
  db: SupabaseClient,
  s: { from: string; baseRate: string; liveFactor: string; note: string },
): Promise<string | null> {
  const { error } = await db
    .from("lamb_cost_settings")
    .insert({ effective_from: s.from, base_rate: s.baseRate, live_factor: s.liveFactor, note: s.note.trim() });
  return plain(error);
}

export async function deleteLambCostSetting(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.from("lamb_cost_settings").delete().eq("id", id);
  return plain(error);
}

/** Add a producer's own rate from a date on. */
export async function addProducerRate(
  db: SupabaseClient,
  r: { producerId: string; from: string; rate: string; note: string },
): Promise<string | null> {
  const { error } = await db
    .from("producer_rates")
    .insert({ producer_id: r.producerId, effective_from: r.from, rate: r.rate, note: r.note.trim() });
  return plain(error);
}

export async function deleteProducerRate(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.from("producer_rates").delete().eq("id", id);
  return plain(error);
}
