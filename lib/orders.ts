// Order rules shared by Calls, the order editor, and the Orders grid.

import { num } from "./calc/num";
import type { Order, OrderStatus, Qty } from "./db/types";

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
export function snapshot(order: Order | undefined): { status: OrderStatus; notes: string; lines: Qty } {
  return order
    ? { status: order.status, notes: order.notes, lines: { ...order.lines } }
    : { status: "todo", notes: "", lines: {} };
}

/** Keep only digits and one decimal point while typing a quantity. */
export function cleanQtyInput(v: string): string {
  const s = v.replace(/[^0-9.]/g, "");
  const i = s.indexOf(".");
  return i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
}
