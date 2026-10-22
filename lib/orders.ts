// Order rules shared by Calls, the order editor, and the Orders grid.

import { fmt, num } from "./calc/num";
import { unitWord } from "./calc/units";
import type { Order, OrderStatus, Qty, Units } from "./db/types";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  todo: "Not called",
  ordered: "Ordered",
  none: "No order",
  callback: "Call back",
};

export const STATUSES: OrderStatus[] = ["todo", "ordered", "none", "callback"];

/** Drop zero and blank quantities. */
export function cleanLines(lines: Qty): Qty {
  const out: Qty = {};
  for (const k in lines) {
    const v = num(lines[k]);
    if (v > 0) out[k] = v;
  }
  return out;
}

export function hasLines(lines: Qty | undefined): boolean {
  return !!lines && Object.values(lines).some((v) => v > 0);
}

/** The status after saving lines without choosing a status (same rule as set_order). */
export function statusAfterLines(current: OrderStatus, lines: Qty): OrderStatus {
  return hasLines(lines) && (current === "todo" || current === "none") ? "ordered" : current;
}

/** What to restore on Undo: the order as it was, or a blank "todo" order. */
export function snapshot(order: Order | undefined): { status: OrderStatus; notes: string; lines: Qty; units: Units } {
  return order
    ? { status: order.status, notes: order.notes, lines: { ...order.lines }, units: { ...order.units } }
    : { status: "todo", notes: "", lines: {}, units: {} };
}

/** "16 lb", "2 packs", "3" (pieces need no word): a quantity as it's read back. */
export function qtyText(qty: number, unit: string): string {
  return unit === "each" ? fmt(qty) : `${fmt(qty)} ${unitWord(unit, qty)}`;
}

/** Units only for lines that are still on the order. */
export function cleanUnits(units: Units, lines: Qty): Units {
  const out: Units = {};
  for (const k in units) if ((lines[k] ?? 0) > 0) out[k] = units[k];
  return out;
}

/** Keep only digits and one decimal point while typing a quantity. */
export function cleanQtyInput(v: string): string {
  const s = v.replace(/[^0-9.]/g, "");
  const i = s.indexOf(".");
  return i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
}

/**
 * A quantity box after each key typed, the way the order screen handles it
 * (onChange: clean the text, keep it as typed, save its number): "80" -> 80.
 */
export function typeQty(keys: string, start = ""): { text: string; qty: number } {
  let text = start;
  for (const k of keys) text = cleanQtyInput(text + k);
  return { text, qty: num(text) };
}

/**
 * A gentle note when an amount isn't in the product's steps, instead of
 * changing what was typed: "Le Trim goes in 10 lb steps. Did you mean 80?"
 */
export function stepNote(name: string, qty: number, step: number, unit: string): string | null {
  if (!(step > 1) || !(qty > 0)) return null;
  const n = qty / step;
  if (Math.abs(n - Math.round(n)) < 1e-9) return null;
  const down = Math.floor(n) * step;
  const up = Math.ceil(n) * step;
  const guess = down === 0 ? fmt(up) : n - Math.floor(n) === 0.5 ? `${fmt(down)} or ${fmt(up)}` : fmt(Math.round(n) * step);
  return `${name} goes in ${fmt(step)} ${unitWord(unit, step)} steps. Did you mean ${guess}?`;
}
