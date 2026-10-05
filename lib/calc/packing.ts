// Packing (SPEC 5.6), ported from the prototype's renderPack and packStats.

import { EPS, fmt } from "./num";
import type { Qty } from "./types";

/** A line counts as packed once at least the ordered amount is packed. */
export function isPacked(ordered: number, packed: number): boolean {
  return ordered > 0 && packed >= ordered - EPS;
}

export type LineLook = "todo" | "part" | "done";

export function lineLook(ordered: number, packed: number): LineLook {
  if (isPacked(ordered, packed)) return "done";
  return packed > 0 ? "part" : "todo";
}

/** What the row says under the product name. Partial and over are said in words. */
export function lineWords(ordered: number, packed: number, unit: string): string {
  const pounds = unit === "lb" ? "Pounds. " : "";
  if (packed > 0 && packed < ordered - EPS) return `${pounds}Packed ${fmt(packed)}, short ${fmt(ordered - packed)}`;
  if (packed > ordered + EPS) return `${pounds}Packed ${fmt(packed)}, over ${fmt(packed - ordered)}`;
  if (isPacked(ordered, packed)) return `${pounds}Packed`;
  return `${pounds}Tap when packed`;
}

/** What tapping a row saves: packed rows go back to 0, anything else becomes fully packed. */
export function afterTap(ordered: number, packed: number): number {
  return isPacked(ordered, packed) ? 0 : ordered;
}

export type PackOrder = { lines: Qty; packed: Qty };

/** Lines with something ordered. */
export function orderedLines(o: PackOrder): [string, number][] {
  return Object.entries(o.lines).filter(([, q]) => q > 0);
}

export function orderPacked(o: PackOrder): boolean {
  const lines = orderedLines(o);
  return lines.length > 0 && lines.every(([pid, q]) => isPacked(q, o.packed[pid] ?? 0));
}

/** Lines packed out of lines ordered, across the week. */
export function packStats(orders: PackOrder[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const o of orders) {
    for (const [pid, q] of orderedLines(o)) {
      total++;
      if (isPacked(q, o.packed[pid] ?? 0)) done++;
    }
  }
  return { done, total };
}

export type PackFilter = "todo" | "done" | "all";

export function showOrder(o: PackOrder, filter: PackFilter): boolean {
  if (filter === "all") return true;
  return filter === "done" ? orderPacked(o) : !orderPacked(o);
}
