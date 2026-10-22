// Label numbers and the print log for the Box Label Report (change request
// 10/23/26; migration 20261023000200).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoredLabel } from "../calc/labels";

/**
 * Numbers for these box rows (keys in report order): rows without one get
 * the next numbers; numbers already given out never change. Null offline.
 */
export async function assignBoxLabels(db: SupabaseClient, week: string, keys: string[]): Promise<Map<string, StoredLabel> | null> {
  const { data, error } = await db.rpc("assign_box_labels", { p_week: week, p_keys: keys });
  if (error) return null;
  const out = new Map<string, StoredLabel>();
  for (const r of (data ?? []) as (StoredLabel & { key: string })[]) {
    out.set(r.key, { number: r.number, printed_at: r.printed_at, printed_print: r.printed_print, printed_by_name: r.printed_by_name });
  }
  return out;
}

/** After printing: log each label (first print or reprint) and remember what it said. */
export async function recordLabelPrint(db: SupabaseClient, week: string, items: { number: number; print: string }[]): Promise<string | null> {
  const { error } = await db.rpc("record_label_print", { p_week: week, p_items: items });
  return error ? error.message : null;
}
