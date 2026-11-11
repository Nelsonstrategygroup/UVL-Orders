// Packing by weight (change requests 10/2026, stage 3). Chris enters the
// actual weight of each line, in one or more boxes; he can mark a line not
// filled (the X on the paper sheet) or flag it with a note.

import { EPS, fmt } from "./num";
import { unitWord } from "./units";

export type PackLine = {
  /** How much was ordered, in the line's unit. */
  ordered: number;
  /** The line's unit: "lb", "each", "pack", "case". */
  unit: string;
  /** Total weight packed, lb. */
  weight: number;
  /** Pieces packed, if counted (orders taken in pieces or packs). */
  count: number | null;
  shorted: boolean;
  flagged: boolean;
  flagNote: string;
  /** Packed in one box with these ("Liver, Kidney"): the weight is that box's. */
  together?: string;
  /** A piece product taken in pounds: the whole pieces it comes to, and their unit (Lucas, 11/7/26). */
  pieces?: number;
  pieceUnit?: string;
};

/**
 * What was ordered, in words: "6", "8 packs", "45 lb". A piece product taken
 * in pounds shows its whole pieces, then the pounds: "27 (120 lb ordered)"
 * (Lucas, 11/7/26), the same count as its box labels.
 */
export function orderedWords(l: Pick<PackLine, "ordered" | "unit" | "pieces" | "pieceUnit">): string {
  const words = (q: number, unit: string) => (unit === "each" ? fmt(q) : `${fmt(q)} ${unitWord(unit, q)}`);
  if (l.pieces != null) return `${words(l.pieces, l.pieceUnit ?? "each")} (${fmt(l.ordered)} lb ordered)`;
  return words(l.ordered, l.unit);
}

/** Done once it has a weight, or it's marked not filled. */
export function lineDone(l: PackLine): boolean {
  return l.shorted || l.weight > EPS;
}

export type LineLook = "todo" | "done" | "short" | "over" | "flag";

/** How the row looks. A flag wins, then not filled, then short or over. */
export function lineLook(l: PackLine): LineLook {
  if (l.flagged) return "flag";
  if (l.shorted) return "short";
  if (l.weight <= EPS) return "todo";
  const packed = l.unit === "lb" ? l.weight : l.count;
  if (packed != null) {
    if (packed < l.ordered - EPS) return "short";
    if (packed > l.ordered + EPS) return "over";
  }
  return "done";
}

/** What the row says under the product name. */
export function lineWords(l: PackLine): string {
  const flag = l.flagged ? ` · Flag${l.flagNote ? `: ${l.flagNote}` : ""}` : "";
  if (l.shorted) return `Not filled${flag}`;
  if (l.weight <= EPS) return `Tap to weigh${flag}`;
  const parts = [`Packed ${fmt(l.weight)} lb${l.together ? ` in one box with ${l.together}` : ""}`];
  if (l.unit === "lb" && !l.together) {
    if (l.weight < l.ordered - EPS) parts.push(`short ${fmt(l.ordered - l.weight)} lb`);
    else if (l.weight > l.ordered + EPS) parts.push(`over ${fmt(l.weight - l.ordered)} lb`);
  } else if (l.count != null) {
    parts.push(`${fmt(l.count)} of ${fmt(l.ordered)}`);
  }
  return parts.join(", ") + flag;
}

export function orderPacked(lines: PackLine[]): boolean {
  return lines.length > 0 && lines.every(lineDone);
}

/** Lines done out of lines ordered, across the week. */
export function packStats(orders: { lines: PackLine[] }[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const o of orders) {
    for (const l of o.lines) {
      total++;
      if (lineDone(l)) done++;
    }
  }
  return { done, total };
}

export type PackFilter = "todo" | "done" | "all";

export function showOrder(lines: PackLine[], filter: PackFilter): boolean {
  if (filter === "all") return true;
  return filter === "done" ? orderPacked(lines) : !orderPacked(lines);
}

export type Weight = { id?: string; product_id: string; weight: number; box_no: number | null };
export type Box = { box_no: number; weight: number; products: string[]; mixed: boolean };

/** Each numbered box: its total weight and what's in it. Mixed = more than one product. */
export function boxes(weights: Weight[]): Box[] {
  const by = new Map<number, Box>();
  for (const w of weights) {
    if (w.box_no == null) continue;
    const b = by.get(w.box_no) ?? { box_no: w.box_no, weight: 0, products: [], mixed: false };
    b.weight += w.weight;
    if (!b.products.includes(w.product_id)) b.products.push(w.product_id);
    b.mixed = b.products.length > 1;
    by.set(w.box_no, b);
  }
  return [...by.values()].sort((a, b) => a.box_no - b.box_no);
}

/** The next box number for this customer. */
export function nextBox(weights: Weight[]): number {
  return weights.reduce((m, w) => Math.max(m, w.box_no ?? 0), 0) + 1;
}

/** One row of a store's packing card: a line, or the lines packed in one box as one row. */
export type PackRow = {
  /** The product to open the weigh panel with: the line's, or the first one in the box on this order. */
  pid: string;
  /** The order's products in this row (more than one: packed in one box). */
  members: string[];
  name: string;
  /** The row as the packing rules see it; for one box, the box. */
  line: PackLine;
  /** The big text on the right: what was ordered ("8 packs"), or "1 box". */
  ordered: string;
  /** Under the name: "Tap to weigh", "Packed 10.95 lb, 2 Heart, 5 Liver"... */
  words: string;
  /** One box: what was ordered of each, under the words ("Ordered: 3 Heart, 3 Liver, 3 Kidney"). */
  orderedEach?: string;
};

/**
 * A store's lines as rows for Packing (Lucas, 11/10/26): products packed in
 * one box (Heart, Liver, Kidney) are one row and count as one line, named
 * for the ones this store ordered. Burien showed "9 of 9" lines with 8 boxes
 * because its HLK box counted three times. `group` gives the products packed
 * with one (packedWith), `name` a product's name.
 */
export function packRows(lines: [string, PackLine][], group: (pid: string) => string[], name: (pid: string) => string): PackRow[] {
  const byId = new Map(lines);
  const used = new Set<string>();
  const rows: PackRow[] = [];
  for (const [pid, l] of lines) {
    if (used.has(pid)) continue;
    const g = group(pid);
    if (g.length < 2) {
      rows.push({ pid, members: [pid], name: name(pid), line: l, ordered: orderedWords(l), words: lineWords(l) });
      continue;
    }
    // In the group's own order, so the name reads the same everywhere.
    const members = g.filter((id) => byId.has(id));
    for (const id of members) used.add(id);
    const ls = members.map((id) => byId.get(id)!);
    const flagged = ls.find((x) => x.flagged);
    const box: PackLine = {
      ordered: 1,
      unit: "box",
      weight: Math.max(...ls.map((x) => x.weight)),
      count: null,
      shorted: ls.every((x) => x.shorted),
      flagged: !!flagged,
      flagNote: flagged?.flagNote ?? "",
    };
    const flag = box.flagged ? ` · Flag${box.flagNote ? `: ${box.flagNote}` : ""}` : "";
    const counted = members.filter((id) => byId.get(id)!.count != null).map((id) => `${fmt(byId.get(id)!.count!)} ${name(id)}`);
    const words = box.shorted
      ? `Not filled${flag}`
      : box.weight <= EPS
        ? `Tap to weigh${flag}`
        : `Packed ${fmt(box.weight)} lb in one box${counted.length ? `, ${counted.join(", ")}` : ""}${flag}`;
    rows.push({
      pid: members[0],
      members,
      name: members.map(name).join(" / "),
      line: box,
      ordered: "1 box",
      words,
      orderedEach: `Ordered: ${members.map((id) => `${fmt(byId.get(id)!.ordered)} ${name(id)}`).join(", ")}`,
    });
  }
  return rows;
}

/** One product row of a store's order, as the box count needs it (a sheet row and its line). */
export type BoxCountRow = {
  name: string;
  /** On the order (false: boxes for a product the store didn't order). */
  onOrder: boolean;
  /** Boxes planned from the box labels; null when the product has no box size. */
  planned: number | null;
  /** Boxes with a weight so far, scanned or typed. */
  packed: number;
  /** Ordered by weight (Le Trim): the planned boxes are only an estimate. Pounds ordered and packed. */
  byWeight?: { ordered: number; packed: number };
  /** Marked Not filled. */
  shorted: boolean;
  /** A piece count was typed for it on Packing. */
  counted: boolean;
};

export type BoxCount = {
  /** Boxes expected for the products whose count is settled. */
  expected: number;
  /** Boxes packed for those products. */
  packed: number;
  /** Products whose box count isn't known until they're packed. */
  waiting: { name: string; about: number | null; packed: number; lb?: { ordered: number; packed: number } }[];
  /** Boxes for products not on the order. */
  offOrder: number;
  /**
   * "ok": every count settled and each product matches. "extra": boxes over
   * what a product expected, with the products. "short": boxes still missing,
   * with the products (only once every line is done). null: still packing.
   */
  state: { kind: "ok" } | { kind: "short" | "extra"; n: number; products: string[] } | null;
};

/** Pounds within half a pound of the order count as all of it (as on Scan boxes). */
const LB_SLACK = 0.5;

/**
 * A store's boxes expected against boxes packed (Lucas, 11/10/26, replacing
 * "at least 7 boxes", "9/9" and "8 boxes weighed", which counted three
 * different things). Expected comes from the box labels. A product ordered by
 * weight (Le Trim) or with no box size has no sure count: it's named and
 * kept apart ("count when packed", with the estimate by weight) until it's
 * packed, and then the boxes actually packed are its count. More boxes than
 * expected is flagged at once; fewer only when every line is done
 * (`orderDone`), since until then the order is just still being packed.
 */
export function boxCount(rows: BoxCountRow[], orderDone: boolean): BoxCount {
  let expected = 0;
  let packed = 0;
  let offOrder = 0;
  // Product by product, so an extra box of one never hides a missing box of another.
  const over: { name: string; n: number }[] = [];
  const under: { name: string; n: number }[] = [];
  const waiting: BoxCount["waiting"] = [];
  for (const r of rows) {
    if (!r.onOrder) {
      offOrder += r.packed;
      continue;
    }
    if (r.shorted) {
      packed += r.packed;
      continue;
    }
    // By weight: once its pounds are packed, or it has as many boxes as the
    // estimate (Bothell's 80 lb of Le Trim weighed 79.45 in its 2 boxes).
    // No box size: once it has a box (or a count typed), since nothing says
    // how many more there could be.
    const allPacked = r.byWeight
      ? r.byWeight.packed >= r.byWeight.ordered - LB_SLACK || (r.planned != null && r.packed >= r.planned)
      : r.planned == null && (r.packed > 0 || r.counted);
    if (r.byWeight || r.planned == null) {
      if (allPacked) {
        // Packed: its count is the boxes it took.
        expected += r.packed;
        packed += r.packed;
      } else waiting.push({ name: r.name, about: r.planned, packed: r.packed, lb: r.byWeight });
      continue;
    }
    expected += r.planned;
    packed += r.packed;
    if (r.packed > r.planned) over.push({ name: r.name, n: r.packed - r.planned });
    if (r.packed < r.planned) under.push({ name: r.name, n: r.planned - r.packed });
  }
  const total = (l: { n: number }[]) => l.reduce((n, x) => n + x.n, 0);
  let state: BoxCount["state"] = null;
  if (over.length) state = { kind: "extra", n: total(over), products: over.map((x) => x.name) };
  else if (waiting.length) state = null;
  else if (!under.length) state = { kind: "ok" };
  else if (orderDone) state = { kind: "short", n: total(under), products: under.map((x) => x.name) };
  return { expected, packed, waiting, offOrder, state };
}

/**
 * "Boxes: 7 expected · 6 packed", then each product still to count: "plus Le
 * Trim (about 3 boxes by weight; 2 so far, 82 of 120 lb)", or "plus Necks
 * (count when packed)" for a product with no box size.
 */
export function boxCountWords(c: BoxCount): string {
  const parts = [`Boxes: ${c.expected} expected · ${c.packed} packed`];
  for (const w of c.waiting)
    parts.push(
      w.lb
        ? `plus ${w.name} (${w.about ? `about ${w.about} box${w.about === 1 ? "" : "es"} by weight` : "count when packed"}; ${w.packed} so far, ${fmt(w.lb.packed)} of ${fmt(w.lb.ordered)} lb)`
        : `plus ${w.name} (count when packed)`,
    );
  if (c.offOrder) parts.push(`${c.offOrder} not on the order`);
  return parts.join(", ");
}
