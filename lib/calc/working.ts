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

/** Where one part's pieces go this week. */
export type PartBalance = {
  part: Part;
  /** What the week's lambs give. */
  supply: number;
  /** Each product that uses it (every product ordered, counted toward the lambs or not), in the part's pieces. */
  uses: WorkingLine[];
  /** A part others are cut from (whole loin): how many are cut into them. */
  cut: { into: Part[]; amount: number } | null;
  /** Taken by Le Trim (its saved plan, or the worked-out mix). */
  leTrim: number;
  /** supply - everything above. Negative: short. */
  left: number;
  /** The part this one is cut from, if any (rack and short loin: whole loin). */
  parent: Part | null;
};

/**
 * The carcass balance laid out part by part, for the Carcass balance report
 * (Lucas, 10/29/26): what the lambs give, where every piece goes (each
 * product, Le Trim, cut into racks and short loins), and what's left over or
 * short. `c` is from calcWeek with the Le Trim mix in it (lib/weekCalc.ts).
 */
export function partBalances(c: Pick<WeekCalc, "withShort" | "rows">, products: Product[]): PartBalance[] {
  const lines = new Map<string, WorkingLine[]>();
  for (const p of [...products].sort((a, b) => a.sort - b.sort)) {
    const q = num(c.withShort[p.id] ?? 0);
    if (!(q > EPS) || p.carcass || (p.fill_note ?? "").trim()) continue;
    for (const u of p.uses) {
      const each = num(u.qty);
      if (!each) continue;
      const list = lines.get(u.part_id) ?? [];
      list.push({ product: p.name, qty: round2(q), each, total: round2(q * each) });
      lines.set(u.part_id, list);
    }
  }
  const byId = new Map(c.rows.map((r) => [r.part.id, r]));
  return c.rows.map((r) => {
    const uses = lines.get(r.part.id) ?? [];
    const used = uses.reduce((s, l) => s + l.total, 0);
    const kids = c.rows.filter((k) => k.parent === r.part.id);
    // A parent's need is what's ordered whole plus the larger of its cut-from parts' needs.
    const cutAmount = kids.length ? kids.reduce((m, k) => Math.max(m, k.need), 0) : 0;
    const leTrim = round2(Math.max(0, r.need - used - cutAmount));
    return {
      part: r.part,
      supply: round2(r.supply),
      uses,
      cut: kids.length ? { into: kids.map((k) => k.part), amount: round2(cutAmount) } : null,
      leTrim,
      left: round2(r.left),
      parent: r.parent ? (byId.get(r.parent)?.part ?? null) : null,
    };
  });
}
