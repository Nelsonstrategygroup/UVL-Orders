// "Last order" and "Scheduled delivery" (change request 10/22/26). Pure, so
// the order screen and the paper order sheets agree.

import { addDays, DAYS } from "../dates";
import type { Qty, Units } from "./types";

export type PastOrder = { customer_id: string; week: string; status: string; lines: Qty; units: Units };
export type LastOrder = { week: string; lines: Qty; units: Units };

const hasLines = (lines: Qty) => Object.values(lines).some((q) => q > 0);

/**
 * Each customer's most recent week with an order before `week` (usually last
 * week): status "ordered" with at least one product. Customers who never
 * ordered aren't in the map.
 */
export function lastOrders(orders: PastOrder[], week: string): Map<string, LastOrder> {
  const out = new Map<string, LastOrder>();
  for (const o of orders) {
    if (o.week >= week || o.status !== "ordered" || !hasLines(o.lines)) continue;
    const have = out.get(o.customer_id);
    if (!have || o.week > have.week) out.set(o.customer_id, { week: o.week, lines: o.lines, units: o.units });
  }
  return out;
}

/** A customer's delivery day: its own, or its chain's ("PCC" stores: Saturday). */
export function deliveryDayOf(
  c: { delivery_day?: string | null; parent_customer_id: string | null },
  byId: Map<string, { delivery_day?: string | null }>,
): string | null {
  if (c.delivery_day) return c.delivery_day;
  return (c.parent_customer_id && byId.get(c.parent_customer_id)?.delivery_day) || null;
}

/**
 * The delivery date in a week: the first `day` after its packing Monday
 * (packing Mon Oct 26, Saturday: Sat Oct 31). Null with no delivery day.
 */
export function deliveryDate(week: string, day: string | null | undefined): string | null {
  const want = day ? DAYS.indexOf(day as (typeof DAYS)[number]) : -1;
  if (want < 0) return null;
  // The week is named by its Monday (weekday 1), so day i after it is weekday (1 + i) % 7.
  for (let i = 1; i <= 7; i++) if ((1 + i) % 7 === want) return addDays(week, i);
  return null;
}
