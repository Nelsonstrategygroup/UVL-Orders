// Customer names, grouping, and the Calls queue (SPEC 4.3, 5.1, 5.3, 6.6).

import type { DayName } from "../dates";
import type { OrderStatus } from "./types";

export type CustomerLite = {
  id: string;
  name: string;
  active: boolean;
  call_day: string | null;
  parent_customer_id: string | null;
};

/** "PCC: Fremont" for a location, or the plain name. */
export function displayName<T extends CustomerLite>(c: T, byId: Map<string, T>): string {
  const parent = c.parent_customer_id ? byId.get(c.parent_customer_id) : undefined;
  return parent ? `${parent.name}: ${c.name}` : c.name;
}

/**
 * Customers who place orders: active, and not a parent of active locations.
 * A parent such as "PCC Community Markets" groups its stores; each store
 * orders on its own.
 */
export function orderingCustomers<T extends CustomerLite>(all: T[]): T[] {
  const parentsWithActiveKids = new Set(
    all.filter((c) => c.active && c.parent_customer_id).map((c) => c.parent_customer_id as string),
  );
  return all.filter((c) => c.active && !parentsWithActiveKids.has(c.id));
}

/** Sort so locations sit together under their parent's name. */
export function sortByDisplayName<T extends CustomerLite>(list: T[], byId: Map<string, T>): T[] {
  return [...list].sort((a, b) =>
    displayName(a, byId).localeCompare(displayName(b, byId), undefined, { sensitivity: "base" }),
  );
}

/** Done for the week: ordered, or said no order (6.6). */
export function isDone(status: OrderStatus | undefined): boolean {
  return status === "ordered" || status === "none";
}

/**
 * The Calls queue (5.1): call day is today and not done, then call-backs,
 * then everyone else not done, then done. Alphabetical within each group.
 */
export function callQueue<T extends CustomerLite>(
  customers: T[],
  statusOf: (id: string) => OrderStatus | undefined,
  today: DayName,
  byId: Map<string, T>,
): T[] {
  const rank = (c: T) => {
    const st = statusOf(c.id) ?? "todo";
    if (isDone(st)) return 3;
    if (st === "callback") return 1;
    if (c.call_day === today) return 0;
    return 2;
  };
  return sortByDisplayName(customers, byId).sort((a, b) => rank(a) - rank(b));
}

/**
 * Find as you type: the name starts with what was typed, ignoring case and
 * extra spaces. A store matches by its own name ("Fremont") or by its full
 * name ("PCC: Fremont"). An empty search matches everyone.
 */
export function matchesSearch<T extends CustomerLite>(query: string, c: T, byId: Map<string, T>): boolean {
  const q = query.trim().replace(/\s+/g, " ").toLowerCase();
  if (!q) return true;
  return [c.name, displayName(c, byId)].some((n) => n.trim().replace(/\s+/g, " ").toLowerCase().startsWith(q));
}
