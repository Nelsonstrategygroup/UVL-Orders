// Packing by weight (change requests 10/2026, stage 3). Chris enters the
// actual weight of each line, in one or more boxes; he can mark a line not
// filled (the X on the paper sheet) or flag it with a note.

import { EPS, fmt } from "./num";

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
};

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
  const parts = [`Packed ${fmt(l.weight)} lb`];
  if (l.unit === "lb") {
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
