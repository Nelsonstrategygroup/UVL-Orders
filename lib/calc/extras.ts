// "Only if extra" order lines (Lucas, 11/8/26). Some customers want a
// product only if there's some left after every firm order (Emerson wants
// everything that way). These lines don't count toward the lamb count, the
// balance or Le Trim; after every firm line and Le Trim, they fill from
// what's left over, up to what they asked for.
//
// Decided 11/8/26:
// - Partial fills: a line gets what's there ("wants 54, 7 available"). A
//   setting (app_settings.extra_fill_partial) turns this into all or none.
// - Half and whole shortfalls stay firm (cut fresh, counted), so they come
//   before these lines. Freezer gets whatever's left after them, as before.
// - When lines compete for the same part and there isn't enough for all,
//   Kathy splits it (This week, "Extras to share"). Until she does, they
//   fill in the shared customer order and are marked "Kathy to decide".
// - Le Trim is firm: these lines get what's left after its plan (or, before
//   the plan is saved, after the app's estimate: marked "estimated").
//
// Whole loins: one whole loin gives one rack and one short loin, so a spare
// whole loin is also a spare rack and short loin. Taking a whole loin takes
// one of each; taking a rack leaves no more spare whole loins than racks.

import { EPS, num } from "./num";
import { wholeLeft, type PartRow } from "./week";
import type { Part, Product } from "./types";

/** Parts Le Trim uses: lines needing these wait on its plan. */
export const LE_TRIM_PARTS = new Set(["shoulder", "leg", "trim"]);

export type ExtraLine = {
  /** `${orderId}|${productId}` */
  key: string;
  orderId: string;
  customerId: string;
  productId: string;
  /** What was asked for, in the product's own unit. */
  asked: number;
  /** Place in the shared customer order: lower fills first while Kathy hasn't decided. */
  rank: number;
  /** Packing started: keeps what it was given (stored). */
  locked: boolean;
  /** What it was given before (order_lines.fill_qty). */
  stored: number | null;
  /** Kathy's share when lines compete (order_lines.fill_chosen). */
  chosen: number | null;
};

export type ExtraFill = {
  key: string;
  /** What it will get, in the product's own unit. */
  fill: number;
  asked: number;
  /** Competing with other lines for the same part. */
  contested: boolean;
  /** Contested and Kathy hasn't split it yet: filled in customer order for now. */
  toDecide: boolean;
  /** Waits on Le Trim, whose plan isn't saved yet: based on the app's estimate. */
  estimated: boolean;
  /** Packing started: no longer changes. */
  locked: boolean;
};

export type ExtraContest = {
  partId: string;
  partName: string;
  /** What's spare of this part for these lines (after firm lines, Le Trim and lines already packing). */
  available: number;
  /** The competing lines, in customer order. */
  keys: string[];
  /** Kathy's split covers every line and fits. */
  decided: boolean;
};

export type ExtrasResult = { fills: Map<string, ExtraFill>; contests: ExtraContest[] };

type Prod = Pick<Product, "id" | "uses" | "carcass" | "sort">;

/**
 * What each "only if extra" line will get from the week's balance (the rows
 * worked out from firm lines, with Le Trim). Pure: This week, Orders, the
 * order form and Le Trim all show the same numbers, and the app stores them
 * on the lines for packing, labels and invoices.
 */
export function fillExtras(input: {
  rows: PartRow[];
  parts: Part[];
  products: Map<string, Prod>;
  lines: ExtraLine[];
  /** Partial fills allowed (app_settings.extra_fill_partial); false: all or none. */
  partial?: boolean;
  /** Le Trim is ordered and its plan isn't saved: lines on its parts are estimates. */
  leTrimEstimated?: boolean;
  /** What's spare of a part, known better than the balance (trim from the kill sheet, less Le Trim's). */
  spare?: Record<string, number>;
}): ExtrasResult {
  const partial = input.partial !== false;
  const byId = new Map(input.parts.map((p) => [p.id, p]));
  const parentOf = (id: string) => {
    const m = byId.get(id)?.made_from;
    return m && m !== id && byId.has(m) ? m : null;
  };
  const childrenOf = (id: string) => input.parts.filter((p) => parentOf(p.id) === id).map((p) => p.id);

  // What's spare of each part: whole pieces (pounds as they are), never below 0.
  const avail = new Map<string, number>();
  for (const r of input.rows) avail.set(r.part.id, Math.max(0, wholeLeft(r)));
  for (const [id, v] of Object.entries(input.spare ?? {})) avail.set(id, Math.max(0, v));
  const get = (id: string) => avail.get(id) ?? 0;

  const takePart = (id: string, amt: number) => {
    avail.set(id, get(id) - amt);
    // A whole loin taken is a rack and a short loin gone too.
    for (const k of childrenOf(id)) avail.set(k, get(k) - amt);
    // A rack taken leaves no more spare whole loins than spare racks.
    const up = parentOf(id);
    if (up) avail.set(up, Math.min(get(up), get(id)));
  };
  const usesOf = (p: Prod | undefined) => (p?.uses ?? []).filter((u) => num(u.qty) > 0);
  /** Not from the lamb's parts (pepper sticks): nothing to wait for. */
  const fromLamb = (p: Prod | undefined) => !!p && (usesOf(p).length > 0 || !!p.carcass);
  /** The most of a product the spare parts make, in whole units. */
  const most = (p: Prod | undefined): number => {
    if (!p) return 0;
    if (p.carcass) return 0; // a whole lamb is never spare
    const uses = usesOf(p);
    if (!uses.length) return Infinity;
    return uses.reduce((m, u) => Math.min(m, Math.floor(Math.max(0, get(u.part_id)) / num(u.qty) + EPS)), Infinity);
  };
  const take = (p: Prod | undefined, n: number) => {
    if (!p || n <= 0) return;
    for (const u of usesOf(p)) takePart(u.part_id, n * num(u.qty));
  };
  const estimatedFor = (p: Prod | undefined) => !!input.leTrimEstimated && usesOf(p).some((u) => LE_TRIM_PARTS.has(u.part_id));

  const fills = new Map<string, ExtraFill>();
  const base = (l: ExtraLine, fill: number, extra: Partial<ExtraFill> = {}): ExtraFill => ({
    key: l.key,
    fill,
    asked: l.asked,
    contested: false,
    toDecide: false,
    estimated: estimatedFor(input.products.get(l.productId)),
    locked: l.locked,
    ...extra,
  });

  // Lines already being packed keep what they were given, first.
  for (const l of input.lines.filter((x) => x.locked)) {
    const f = Math.max(0, num(l.stored ?? 0));
    take(input.products.get(l.productId), f);
    fills.set(l.key, base(l, f, { locked: true }));
  }

  const open = input.lines
    .filter((x) => !x.locked)
    .sort((a, b) => a.rank - b.rank || (input.products.get(a.productId)?.sort ?? 0) - (input.products.get(b.productId)?.sort ?? 0) || a.key.localeCompare(b.key));

  // Which parts more is asked of than there is: those lines compete.
  const demand = new Map<string, number>();
  for (const l of open) {
    const p = input.products.get(l.productId);
    if (!fromLamb(p) || p?.carcass) continue;
    for (const u of usesOf(p)) demand.set(u.part_id, (demand.get(u.part_id) ?? 0) + Math.max(0, l.asked) * num(u.qty));
  }
  const contestedParts = [...demand.entries()].filter(([id, d]) => d > get(id) + EPS).map(([id]) => id);
  const linesOn = (partId: string) => open.filter((l) => usesOf(input.products.get(l.productId)).some((u) => u.part_id === partId));
  const contests: ExtraContest[] = contestedParts
    .map((partId) => {
      const ls = linesOn(partId);
      const usePer = (l: ExtraLine) => num(usesOf(input.products.get(l.productId)).find((u) => u.part_id === partId)?.qty ?? 0);
      const chosenUse = ls.reduce((s, l) => s + Math.min(Math.max(0, num(l.chosen ?? 0)), l.asked) * usePer(l), 0);
      const decided = ls.every((l) => l.chosen != null) && chosenUse <= get(partId) + EPS;
      return { partId, partName: byId.get(partId)?.name ?? partId, available: get(partId), keys: ls.map((l) => l.key), decided };
    })
    .sort((a, b) => (byId.get(a.partId)?.sort ?? 0) - (byId.get(b.partId)?.sort ?? 0));
  const contestsOf = (l: ExtraLine) => contests.filter((c) => c.keys.includes(l.key));

  for (const l of open) {
    const p = input.products.get(l.productId);
    const mine = contestsOf(l);
    const contested = mine.length > 0;
    const decided = contested && mine.every((c) => c.decided);
    const want = decided ? Math.min(l.asked, Math.max(0, num(l.chosen ?? 0))) : Math.max(0, l.asked);
    let n = Math.min(want, most(p));
    if (!Number.isFinite(n)) n = want;
    // All or none (when partial fills are off): Kathy's own share always stands.
    if (!partial && !decided && n < want - EPS) n = 0;
    n = Math.max(0, n);
    take(p, n);
    fills.set(l.key, base(l, n, { contested, toDecide: contested && !decided }));
  }

  return { fills, contests };
}

/** "Wants 54 packs Front Shanks, 7 available" style words for a line. */
export function wantsText(asked: string, fill: string): string {
  return `Wants ${asked}, ${fill} available`;
}

/** "7 packs Front Shanks", "20 lb Ground Lamb", "4 BNLS Shoulder": an amount in the product's own unit. */
export function amountText(n: number, product: { name: string; unit: string } | undefined): string {
  const q = Math.round(n * 100) / 100;
  const name = product?.name ?? "";
  if (!product) return String(q);
  if (product.unit === "lb") return `${q} lb ${name}`;
  if (product.unit === "pack") return `${q} ${q === 1 ? "pack" : "packs"} ${name}`;
  if (product.unit === "case") return `${q} ${q === 1 ? "case" : "cases"} ${name}`;
  return `${q} ${name}`;
}
