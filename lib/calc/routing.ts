// Scan-to-pallet routing (change request 10/26/26). Boxes come off Mohawk's
// roller grouped by size, not by customer: Chris scans a box and the app
// suggests who it's for and which pallet it goes on. Pure, so it runs on the
// phone with no signal, from the copy Packing keeps.
//
// Who: customers this week that still need this product. Soonest ship date
// first (blank for now, so it makes no difference yet), then the one furthest
// behind on their whole order, then by name. Never assigned without a tap.
//
// Which pallet, for that customer's shipment:
//   a. a planned or open pallet with a planned box still to fill for this
//      customer and product (pallet_plan_lines; empty until the planner),
//   b. an open pallet for the shipment (the newest),
//   c. none: start a pallet for the shipment.

import { num } from "./num";
import type { SheetRow } from "./packSheet";

/** How much of one product a customer still needs. */
export type Need =
  /** Box count known: boxes packed and planned. */
  | { kind: "boxes"; done: number; total: number }
  /** No box size, but a weight is known: pounds packed and ordered. */
  | { kind: "lb"; done: number; total: number }
  /** No box size and no weight per piece (Heart today): open until the line is marked done. */
  | { kind: "open"; done: number; open: boolean };

/** The need for one row of the packing sheet. */
export function needFor(
  row: SheetRow,
  line: { ordered: number; unit: string; weight: number; shorted: boolean; count: number | null } | undefined,
  lbPerUnit: number | null,
): Need {
  const packed = row.blanks.filter((b) => b.weight).length;
  if (row.known) return { kind: "boxes", done: packed, total: row.boxCount };
  if (!line) return { kind: "open", done: packed, open: false };
  if (line.unit === "lb") return { kind: "lb", done: line.weight, total: line.ordered };
  if (lbPerUnit && lbPerUnit > 0) return { kind: "lb", done: line.weight, total: line.ordered * lbPerUnit };
  // Marked done on Packing: Not filled, or a piece count entered.
  return { kind: "open", done: packed, open: !line.shorted && line.count == null };
}

/** Still needs some. Pounds within half a pound count as done. */
export function stillNeeds(n: Need): boolean {
  if (n.kind === "open") return n.open;
  if (n.kind === "lb") return n.total - n.done > 0.5;
  return n.done < n.total;
}

/** "needs 2 of 3 boxes", "needs 40 of 120 lb", "needs some (6 packed)". */
export function needWords(n: Need): string {
  if (n.kind === "boxes") return `needs ${Math.max(0, n.total - n.done)} of ${n.total} box${n.total === 1 ? "" : "es"}`;
  if (n.kind === "lb") return `needs ${Math.max(0, Math.round(n.total - n.done))} of ${Math.round(n.total)} lb`;
  return n.done ? `still open (${n.done} box${n.done === 1 ? "" : "es"} so far)` : "still open";
}

/** One customer's order, as routing sees it. */
export type RouteOrder = {
  orderId: string;
  customerId: string;
  /** The name on the box label ("PCC #12 Redmond"). */
  name: string;
  /** Its shipment: "point:<id>" for a distributor, "customer:<id>" for Direct. */
  shipKey: string;
  /** The shipment's name: the distributor, or the customer. */
  shipName: string;
  /** Set when it ships through a distributor ("PCC distributor"). */
  via: string | null;
  shipDate: string | null;
  /** This product's need, when it's on the order. */
  need: Need | null;
  /** How far along the whole order is, 0 to 1 (boxes packed over boxes planned; pounds where boxes aren't known). */
  progress: number;
};

export type RoutePallet = {
  id: string;
  tag: string;
  status: "planned" | "open" | "full" | "shipped";
  shipKeys: string[];
  createdAt: string;
  /** Planned boxes on this pallet (empty until the planner). */
  plan: { customerId: string; productId: string; boxes: number }[];
  /** Boxes on it so far. */
  boxes: { customerId: string | null; productId: string }[];
};

/** Customers that still need this product: the suggestion first, then the runner-ups. */
export function candidates(orders: RouteOrder[]): RouteOrder[] {
  return orders
    .filter((o) => o.need && stillNeeds(o.need))
    .sort(
      (a, b) =>
        (a.shipDate ?? "9999").localeCompare(b.shipDate ?? "9999") ||
        a.progress - b.progress ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
    );
}

/** The pallet for a box for this customer and product: a pallet, or null to start one. */
export function palletFor(o: Pick<RouteOrder, "customerId" | "shipKey">, productId: string, pallets: RoutePallet[]): RoutePallet | null {
  // a. A planned box still to fill.
  const planned = pallets.find((p) => {
    if (p.status !== "planned" && p.status !== "open") return false;
    const want = p.plan.filter((l) => l.customerId === o.customerId && l.productId === productId).reduce((s, l) => s + l.boxes, 0);
    const have = p.boxes.filter((b) => b.customerId === o.customerId && b.productId === productId).length;
    return want > have;
  });
  if (planned) return planned;
  // b. The newest open pallet for the shipment.
  const open = pallets
    .filter((p) => p.status === "open" && p.shipKeys.includes(o.shipKey))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return open[0] ?? null;
}

/** A tag to offer for a new pallet: one more than the highest "P" number this week ("P4"). */
export function nextTag(pallets: { tag: string }[]): string {
  const n = Math.max(0, ...pallets.map((p) => Number(/^P(\d+)$/i.exec(p.tag.trim())?.[1] ?? 0)));
  return `P${n + 1}`;
}

/** Boxes and pounds on a pallet, and by customer (for a distributor's pallet). */
export function palletTotals(boxes: { customerId: string | null; weight: number }[]) {
  const by = new Map<string | null, { boxes: number; lb: number }>();
  for (const b of boxes) {
    const t = by.get(b.customerId) ?? { boxes: 0, lb: 0 };
    t.boxes += 1;
    t.lb += num(b.weight);
    by.set(b.customerId, t);
  }
  const lb = boxes.reduce((s, b) => s + num(b.weight), 0);
  return { boxes: boxes.length, lb: Math.round(lb * 100) / 100, byCustomer: by };
}
