// Lamb cost (SPEC 16): what UVL pays producers for lambs. Stage 1 is the
// settings: the base rate and live weight factor from a date on, and a
// producer's own rate from a date on. A kill date uses the newest of each
// dated on or before it. Values stay decimal strings, never floats.

import { niceDate } from "../dates";
import { centsText, parsePrice, toFixedInt } from "./prices";

/** Base $ per lb live and the live weight factor, from a date on. */
export type LambCostSetting = {
  id: string;
  effective_from: string;
  base_rate: string | number;
  live_factor: string | number;
  note: string;
};

/** A producer's own $ per lb live, from a date on, instead of the base rate. */
export type ProducerRate = {
  id: string;
  producer_id: string;
  effective_from: string;
  rate: string | number;
  note: string;
};

export type Producer = {
  id: string;
  name: string;
  ranch_name: string;
  contact: string;
  active: boolean;
};

const newestOnOrBefore = <T extends { effective_from: string }>(rows: T[], date: string): T | null =>
  rows.filter((r) => r.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;

/** The pricing setting in effect on a date, or null if none starts on or before it. */
export function settingFor(settings: LambCostSetting[], date: string): LambCostSetting | null {
  return newestOnOrBefore(settings, date);
}

/** A producer's own rate in effect on a date, or null. */
export function producerRateFor(rates: ProducerRate[], producerId: string, date: string): ProducerRate | null {
  return newestOnOrBefore(
    rates.filter((r) => r.producer_id === producerId),
    date,
  );
}

/** The rate and factor for a producer's lambs on a date, and where the rate came from. */
export type RateUsed = {
  rate: string;
  factor: string;
  source: "override" | "base";
};

/**
 * What a lamb killed on `date` is paid at: the producer's own rate if one
 * applies that day, else the base rate; the factor always comes from the
 * pricing setting. Null when no pricing setting starts on or before the date.
 */
export function rateFor(
  settings: LambCostSetting[],
  rates: ProducerRate[],
  producerId: string | null,
  date: string,
): RateUsed | null {
  const s = settingFor(settings, date);
  if (!s) return null;
  const own = producerId ? producerRateFor(rates, producerId, date) : null;
  return own
    ? { rate: String(own.rate), factor: String(s.live_factor), source: "override" }
    : { rate: String(s.base_rate), factor: String(s.live_factor), source: "base" };
}

/** Newest first, for a history list. */
export function newestFirst<T extends { effective_from: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
}

/** A typed rate, "$3.00" or "3": a plain decimal string, or null. */
export function parseRate(text: string): string | null {
  return parsePrice(text);
}

/** A typed live weight factor, "2.02": a decimal above 0 with at most 4 places, or null. */
export function parseFactor(text: string): string | null {
  const v = parsePrice(text);
  return v != null && Number(v) > 0 ? v : null;
}

/** "$3.00", "$3.125": at least two decimals, as typed beyond that. */
export function rateText(v: string | number): string {
  const [w, f = ""] = String(v).split(".");
  return `$${w}.${f.replace(/0+$/, "").padEnd(2, "0")}`;
}

/** "2.02": the factor without trailing zeros. */
export function factorText(v: string | number): string {
  const s = String(v);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

// ---------------------------------------------------------------------------
// Stage 2: carcass weights (SPEC 16.3-16.5). Each lamb is worked out exactly
// (BigInt fixed point): carcass lb has 2 decimals, the factor and rates 4,
// so live lb has 6 and money 10. Only a sheet's total and the week's totals
// are rounded, half up to the cent.
// ---------------------------------------------------------------------------

const LB = 6; // live lb decimals
const MONEY = 10; // money decimals before rounding
const TEN = (p: number) => BigInt(10) ** BigInt(p);
const ZERO = BigInt(0);

/**
 * A sheet as stored. The rate and factor follow the dated settings while its
 * week is open (the database keeps them up to date); a closed week keeps its
 * numbers; an override is the sheet's own, with a reason (11/18/26).
 */
export type KillSheet = {
  id: string;
  producer_id: string;
  kill_date: string;
  week_id: string;
  base_rate: string | number;
  live_factor: string | number;
  rate_source: "base" | "producer" | "override";
  notes: string;
  override_reason?: string | null;
};

export type KillLamb = { id: string; sheet_id: string; position: number; carcass_lb: string | number };

export type AdjustmentKind = "dollars" | "per_live_lb";
export type AdjustmentReason = "premium" | "dock" | "hauling" | "other";
export const ADJUSTMENT_REASONS: AdjustmentReason[] = ["premium", "dock", "hauling", "other"];
export const REASON_LABEL: Record<AdjustmentReason, string> = { premium: "Premium", dock: "Dock", hauling: "Hauling", other: "Other" };

export type KillAdjustment = {
  id: string;
  sheet_id: string;
  lamb_id: string | null;
  kind: AdjustmentKind;
  amount: string | number;
  reason: AdjustmentReason;
  note: string;
};

/** Round a fixed-point value with `places` decimals to whole cents, half up (away from zero). */
export function roundToCents(v: bigint, places: number): bigint {
  if (places <= 2) return v * TEN(2 - places);
  const unit = TEN(places - 2);
  const half = unit / BigInt(2);
  const a = v < ZERO ? -v : v;
  const c = (a + half) / unit;
  return v < ZERO ? -c : c;
}

/** A fixed-point value shown to `digits` decimals, half up, with thousands commas ("1,262.40"). */
export function fixedRounded(v: bigint, places: number, digits: number): string {
  const unit = TEN(Math.max(0, places - digits));
  const half = places > digits ? unit / BigInt(2) : ZERO;
  const neg = v < ZERO;
  const scaled = places >= digits ? ((neg ? -v : v) + half) / unit : (neg ? -v : v) * TEN(digits - places);
  const whole = (scaled / TEN(digits)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = digits ? `.${(scaled % TEN(digits)).toString().padStart(digits, "0")}` : "";
  return `${neg && scaled !== ZERO ? "-" : ""}${whole}${frac}`;
}

/** Money with 10 decimals shown to the cent, for one lamb's line: "$378.15", "-$10.00". */
export function moneyText(v: bigint): string {
  const s = fixedRounded(v, MONEY, 2);
  return s.startsWith("-") ? `-$${s.slice(1)}` : `$${s}`;
}

/** What one adjustment adds (or takes off) in money (10 decimals), given the live lb (6 decimals) it applies to. */
export function adjustmentMoney(adj: Pick<KillAdjustment, "kind" | "amount">, liveLb: bigint): bigint {
  const amount = toFixedInt(adj.amount, 4);
  return adj.kind === "dollars" ? amount * TEN(MONEY - 4) : amount * liveLb; // 4 + 6 = 10 decimals
}

export type LambPay = {
  lamb: KillLamb;
  carcass: bigint; // 2 decimals
  live: bigint; // 6 decimals
  base: bigint; // 10 decimals
  adjustments: { adj: KillAdjustment; money: bigint }[];
  pay: bigint; // 10 decimals
};

export type SheetPay = {
  sheet: KillSheet;
  lambs: LambPay[];
  count: number;
  carcass: bigint; // 2 decimals
  live: bigint; // 6 decimals
  base: bigint; // 10 decimals
  lambAdjustments: bigint; // 10 decimals
  sheetAdjustments: { adj: KillAdjustment; money: bigint }[];
  /** Exact, 10 decimals. */
  exact: bigint;
  /** The sheet total, rounded to the cent. */
  cents: bigint;
};

/**
 * A sheet's pay, step by step: each lamb's carcass lb x factor = live lb;
 * live lb x rate = base pay; plus or minus that lamb's adjustments = pay.
 * Then the sheet's own adjustments (dollars, or $/live lb x the sheet's live
 * lb). Nothing is rounded until the sheet total.
 */
export function sheetPay(sheet: KillSheet, lambs: KillLamb[], adjustments: KillAdjustment[]): SheetPay {
  const factor = toFixedInt(sheet.live_factor, 4);
  const rate = toFixedInt(sheet.base_rate, 4);
  const mine = adjustments.filter((a) => a.sheet_id === sheet.id);
  const rows: LambPay[] = lambs
    .filter((l) => l.sheet_id === sheet.id)
    .sort((a, b) => a.position - b.position)
    .map((lamb) => {
      const carcass = toFixedInt(lamb.carcass_lb, 2);
      const live = carcass * factor; // 2 + 4 = 6 decimals
      const base = live * rate; // 6 + 4 = 10 decimals
      const adjs = mine.filter((a) => a.lamb_id === lamb.id).map((adj) => ({ adj, money: adjustmentMoney(adj, live) }));
      return { lamb, carcass, live, base, adjustments: adjs, pay: adjs.reduce((s, a) => s + a.money, base) };
    });
  const carcass = rows.reduce((s, r) => s + r.carcass, ZERO);
  const live = rows.reduce((s, r) => s + r.live, ZERO);
  const base = rows.reduce((s, r) => s + r.base, ZERO);
  const lambAdjustments = rows.reduce((s, r) => s + (r.pay - r.base), ZERO);
  const sheetAdjustments = mine.filter((a) => !a.lamb_id).map((adj) => ({ adj, money: adjustmentMoney(adj, live) }));
  const exact = sheetAdjustments.reduce((s, a) => s + a.money, base + lambAdjustments);
  return { sheet, lambs: rows, count: rows.length, carcass, live, base, lambAdjustments, sheetAdjustments, exact, cents: roundToCents(exact, MONEY) };
}

export type ProducerWeek = {
  producerId: string;
  sheets: number;
  head: number;
  carcass: bigint; // 2 decimals
  live: bigint; // 6 decimals
  exact: bigint; // 10 decimals
  /** Rounded once, from the exact sum. */
  cents: bigint;
};

export type WeekPay = {
  producers: ProducerWeek[];
  head: number;
  carcass: bigint;
  live: bigint;
  exact: bigint;
  /** The week total: the exact sum, rounded once to the cent. */
  cents: bigint;
};

/** A week's sheets added up per producer and in total. Weekly totals are rounded once, from the exact sums. */
export function weekPay(sheets: SheetPay[]): WeekPay {
  const by = new Map<string, ProducerWeek>();
  for (const s of sheets) {
    const p = by.get(s.sheet.producer_id) ?? { producerId: s.sheet.producer_id, sheets: 0, head: 0, carcass: ZERO, live: ZERO, exact: ZERO, cents: ZERO };
    p.sheets += 1;
    p.head += s.count;
    p.carcass += s.carcass;
    p.live += s.live;
    p.exact += s.exact;
    by.set(p.producerId, p);
  }
  const exact = sheets.reduce((s, x) => s + x.exact, ZERO);
  return {
    producers: [...by.values()].map((p) => ({ ...p, cents: roundToCents(p.exact, MONEY) })),
    head: sheets.reduce((s, x) => s + x.count, 0),
    carcass: sheets.reduce((s, x) => s + x.carcass, ZERO),
    live: sheets.reduce((s, x) => s + x.live, ZERO),
    exact,
    cents: roundToCents(exact, MONEY),
  };
}

/** Average carcass lb over a head count, to 1 decimal ("63.1"); "" with no lambs. */
export function averageLbText(carcass: bigint, head: number): string {
  if (!head) return "";
  // carcass has 2 decimals; scale to 5 before dividing so the average rounds right.
  return fixedRounded((carcass * BigInt(1000)) / BigInt(head), 5, 1);
}

/** Carcass lb (2 decimals) shown to 2 decimals with commas: "1,262.40". */
export function carcassText(v: bigint): string {
  return fixedRounded(v, 2, 2);
}

/** Live lb (6 decimals) shown to 2 decimals: "126.05". */
export function liveText(v: bigint): string {
  return fixedRounded(v, LB, 2);
}

/** Whole cents as "$1,234.56". */
export { centsText };

// ----- Where a kill's rate comes from, and what changing it does (11/18/26) -----

/** The dated settings and producer rates. */
export type RateBook = { settings: LambCostSetting[]; rates: ProducerRate[] };

const sameNumber = (a: string | number, b: string | number) => toFixedInt(a, 4) === toFixedInt(b, 4);

/** The sheet with another rate and factor (nothing is saved). */
export const withRates = (sheet: KillSheet, r: { rate?: string | number; factor?: string | number }): KillSheet => ({
  ...sheet,
  base_rate: r.rate ?? sheet.base_rate,
  live_factor: r.factor ?? sheet.live_factor,
});

/** A sheet's pay worked out again at another rate and factor, same weights and adjustments. */
export function repay(sp: SheetPay, r: { rate?: string | number; factor?: string | number }): SheetPay {
  return sheetPay(
    withRates(sp.sheet, r),
    sp.lambs.map((l) => l.lamb),
    [...sp.lambs.flatMap((l) => l.adjustments.map((a) => a.adj)), ...sp.sheetAdjustments.map((a) => a.adj)],
  );
}

/** "setting from Nov 1", "own rate from Nov 1", or "override: premium lot". */
export function rateOriginText(sheet: KillSheet, book: RateBook): string {
  if (sheet.rate_source === "override") return `override: ${sheet.override_reason ?? ""}`.trim();
  const used = rateFor(book.settings, book.rates, sheet.producer_id, sheet.kill_date);
  const set = settingFor(book.settings, sheet.kill_date);
  if (!used || !set || !sameNumber(used.rate, sheet.base_rate) || !sameNumber(used.factor, sheet.live_factor)) return "kept from before; the setting now differs";
  const own = used.source === "override" ? producerRateFor(book.rates, sheet.producer_id, sheet.kill_date) : null;
  return own ? `own rate from ${niceDate(own.effective_from)}` : `setting from ${niceDate(set.effective_from)}`;
}

/** "7,185 lb × 2.00 × $3.00 = $43,110.00, setting from Nov 1". Before adjustments. */
export function killMathText(sp: SheetPay, book: RateBook): string {
  const lb = carcassText(sp.carcass).replace(/\.00$/, "");
  return `${lb} lb × ${rateText(sp.sheet.live_factor).slice(1)} × ${rateText(sp.sheet.base_rate)} = ${moneyText(sp.base)}, ${rateOriginText(sp.sheet, book)}`;
}

/** Sheets whose rate or factor would change under these settings (overrides never do), and any no setting would cover. */
export function sheetsToChange(sheets: KillSheet[], next: RateBook): { sheet: KillSheet; rate: string; factor: string }[] {
  return sheets.flatMap((sheet) => {
    if (sheet.rate_source === "override") return [];
    const r = rateFor(next.settings, next.rates, sheet.producer_id, sheet.kill_date);
    if (!r || (sameNumber(r.rate, sheet.base_rate) && sameNumber(r.factor, sheet.live_factor))) return [];
    return [{ sheet, rate: r.rate, factor: r.factor }];
  });
}

export type KillChange = { sheet: KillSheet; before: bigint; after: bigint };
export type RateImpact = { changes: KillChange[]; closed: KillChange[] };

/** What a change to the settings does to existing kills, in cents. Kills in closed weeks are listed apart: they stay. */
export function rateChangeImpact(
  sheets: KillSheet[],
  lambs: KillLamb[],
  adjustments: KillAdjustment[],
  next: RateBook,
  closedWeeks: Set<string>,
): RateImpact {
  const out: RateImpact = { changes: [], closed: [] };
  for (const c of sheetsToChange(sheets, next)) {
    const row: KillChange = {
      sheet: c.sheet,
      before: sheetPay(c.sheet, lambs, adjustments).cents,
      after: sheetPay(withRates(c.sheet, c), lambs, adjustments).cents,
    };
    (closedWeeks.has(c.sheet.week_id) ? out.closed : out.changes).push(row);
  }
  return out;
}

/** The words shown before saving; empty when no kill is touched. */
export function rateImpactLines(i: RateImpact, producerName: (id: string) => string): string[] {
  const row = (c: KillChange) => `${producerName(c.sheet.producer_id)}, ${niceDate(c.sheet.kill_date)}: ${centsText(c.before)} → ${centsText(c.after)}`;
  const n = i.changes.length;
  return [
    ...(n ? [`This changes ${n} kill${n === 1 ? "" : "s"}:`, ...i.changes.map(row)] : []),
    ...(i.closed.length ? [`${n ? "\n" : ""}In closed weeks, so these stay as they are:`, ...i.closed.map(row)] : []),
  ];
}

// ----- Sizes -----

export type SizeClass = { id: string; label: string; weight_range: string; sort: number };

/** "50-60 Lbs" -> [50, 60]; "90+ Lbs" -> [90, Infinity]; null if it can't be read. Ends are included. */
export function parseSizeRange(text: string): [number, number] | null {
  const t = text.replace(/,/g, "");
  const plus = t.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (plus) return [Number(plus[1]), Infinity];
  const r = t.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/i);
  if (!r) return null;
  const a = Number(r[1]);
  const b = Number(r[2]);
  return a <= b ? [a, b] : [b, a];
}

/**
 * A lamb's size from its carcass weight: the one size whose range holds it.
 * In no range, or in more than one (they overlap), it's unassigned: null.
 * Nothing is guessed.
 */
export function sizeFor(carcassLb: number, sizes: SizeClass[]): SizeClass | null {
  const hits = sizes.filter((s) => {
    const r = parseSizeRange(s.weight_range);
    return r != null && carcassLb >= r[0] && carcassLb <= r[1];
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Lambs per size, in the sizes' order, then "Unassigned". */
export function sizeCounts(weights: number[], sizes: SizeClass[]): { label: string; count: number }[] {
  const sorted = [...sizes].sort((a, b) => a.sort - b.sort);
  const counts = new Map<string, number>();
  let unassigned = 0;
  for (const w of weights) {
    const s = sizeFor(w, sorted);
    if (s) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
    else unassigned++;
  }
  return [...sorted.map((s) => ({ label: s.label, count: counts.get(s.id) ?? 0 })), { label: "Unassigned", count: unassigned }];
}

// ----- The paper grid -----

/** Rows in one column of Mohawk's kill log; a heavier line after row 10. */
export const GRID_ROWS = 20;

/** Place on the sheet (1-based) as column and row (both 1-based). */
export function gridPlace(position: number): { column: number; row: number } {
  return { column: Math.floor((position - 1) / GRID_ROWS) + 1, row: ((position - 1) % GRID_ROWS) + 1 };
}

/** A typed carcass weight, "62.4": up to 2 decimals, above 0 and under 500, as a decimal string; null if not. */
export function parseCarcass(text: string): string | null {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d{0,2})?$|^\.\d{1,2}$/.test(t)) return null;
  const v = Number(t);
  if (!(v > 0 && v < 500)) return null;
  return t.replace(/\.$/, "").replace(/^\./, "0.");
}
