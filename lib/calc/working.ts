// How the week's lamb count was worked out (Lucas, 10/29/26), step by step
// for This week: each part's need from the orders, product by product, over
// what one lamb gives; the part that sets the count; then carcass and extra
// lambs; then Your number or the cut sheet. The same rules as calcWeek
// (lib/calc/week.ts), laid out to read; the count itself always comes from
// calcWeek.

import { ceilSafe, EPS, num } from "./num";
import type { Part, Product, Qty } from "./types";
import type { WeekCalc } from "./week";

/** One product's share of a part: "BI Shoulder 30 x 1 = 30". */
export type WorkingLine = { product: string; qty: number; each: number; total: number };

export type PartWorking = {
  part: Part;
  /** Products that set the count, with what each needs of this part. */
  lines: WorkingLine[];
  /** For a part others are cut from (whole loin): the parts cut from it and what each needs. */
  cutFrom: { part: Part; need: number }[];
  /** What sets the count: the sum of the lines (plus the largest cut-from need). */
  need: number;
  perLamb: number;
  lambs: number;
  /** Sets the count this week. */
  sets: boolean;
};

export type CountWorking = {
  /** Parts that can set the count, in order. */
  parts: PartWorking[];
  /** Parts that never set the count, and why. */
  never: { part: Part; why: string }[];
  /** Products ordered that never set the count (not lamb, or set not to). */
  notCounted: { product: string; qty: number }[];
  carcass: { product: string; qty: number }[];
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The working behind `c` (from calcWeek with these parts and products). Uses
 * c.withShort: each product's total in its own unit, half and whole
 * shortfall included.
 */
export function countWorking(c: Pick<WeekCalc, "withShort" | "orderLambs">, parts: Part[], products: Product[]): CountWorking {
  const sorted = [...parts].sort((a, b) => a.sort - b.sort);
  const byId = new Map(sorted.map((p) => [p.id, p]));
  const parentOf = (p: Part) => (p.made_from && p.made_from !== p.id && byId.has(p.made_from) ? p.made_from : null);
  const lines = new Map<string, WorkingLine[]>();
  const notCounted: CountWorking["notCounted"] = [];
  const carcass: CountWorking["carcass"] = [];
  const qtys: Qty = c.withShort;

  for (const p of [...products].sort((a, b) => a.sort - b.sort)) {
    const q = num(qtys[p.id] ?? 0);
    if (!(q > EPS)) continue;
    if (p.carcass) {
      carcass.push({ product: p.name, qty: q });
      continue;
    }
    if ((p.fill_note ?? "").trim()) continue; // Le Trim: its own section
    if (p.counts_toward_lambs === false || p.not_lamb) {
      notCounted.push({ product: p.name, qty: q });
      continue;
    }
    for (const u of p.uses) {
      const each = num(u.qty);
      if (!each) continue;
      const list = lines.get(u.part_id) ?? [];
      list.push({ product: p.name, qty: round2(q), each, total: round2(q * each) });
      lines.set(u.part_id, list);
    }
  }
  const sum = (id: string) => (lines.get(id) ?? []).reduce((s, l) => s + l.total, 0);

  const out: PartWorking[] = [];
  const never: CountWorking["never"] = [];
  for (const part of sorted) {
    const up = parentOf(part);
    if (up) {
      never.push({ part, why: `cut from ${byId.get(up)!.name.toLowerCase()}s` });
      continue;
    }
    if (part.drives_count === false) {
      never.push({ part, why: "never sets the count" });
      continue;
    }
    const kids = sorted.filter((k) => parentOf(k) === part.id).map((k) => ({ part: k, need: round2(sum(k.id)) }));
    const most = kids.reduce((m, k) => Math.max(m, k.need), 0);
    const need = round2(sum(part.id) + most);
    const per = num(part.per_lamb);
    const lambs = need > EPS && per > 0 ? ceilSafe(need / per) : 0;
    out.push({ part, lines: lines.get(part.id) ?? [], cutFrom: kids, need, perLamb: per, lambs, sets: false });
  }
  const top = out.reduce((m, r) => Math.max(m, r.lambs), 0);
  for (const r of out) r.sets = top > 0 && r.lambs === top && r.lambs === c.orderLambs;
  return { parts: out, never, notCounted, carcass };
}
