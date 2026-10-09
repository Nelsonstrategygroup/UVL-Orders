// Spreadsheet downloads for people (not the full backup in lib/export.ts):
// names instead of ID codes, one row per product ordered. CSV with a BOM so
// Excel opens it with the right characters.

import { billedThrough, mainContact, rolesLabel } from "./calc/contacts";
import { displayName } from "./calc/customers";
import { STATUS_LABEL } from "./orders";
import type { Customer, Order, OrderStatus, Qty, Units } from "./db/types";
import { lineUnit, toProductUnit } from "./calc/units";
import { csvCell } from "./import/csv";

type Cell = string | number | null | undefined;
type ProductLite = { id: string; name: string; unit: string; sort: number; lb_per_unit?: number | null };

/** Rows to a CSV file Excel opens cleanly. */
export function csvFile(header: string[], rows: Cell[][]): string {
  const line = (r: Cell[]) => r.map((v) => csvCell(v ?? "")).join(",");
  return "﻿" + [line(header), ...rows.map(line)].join("\r\n") + "\r\n";
}

/** A safe file name: "PCC Community Markets: Fremont" -> "PCC-Community-Markets-Fremont". */
export function fileSafe(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "customer";
}

/** Products in an order, in catalog order; unknown products last by id. */
function orderedLines(lines: Qty, products: ProductLite[]): { product: ProductLite | null; id: string; qty: number }[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return Object.entries(lines)
    .filter(([, q]) => q)
    .map(([id, qty]) => ({ id, qty, product: byId.get(id) ?? null }))
    .sort((a, b) => (a.product?.sort ?? 1e9) - (b.product?.sort ?? 1e9) || a.id.localeCompare(b.id));
}

export const HISTORY_COLUMNS = ["Customer", "Week of", "Answer", "Product", "Quantity", "Unit", "Packed", "Order notes"];

/** One customer's order history: a row per product per week, newest week first. */
export function customerHistoryCsv(
  name: string,
  orders: { week: string; status: OrderStatus; notes: string; lines: Qty; units?: Units; packed: Qty }[],
  products: ProductLite[],
): string {
  const rows: Cell[][] = [];
  for (const o of [...orders].sort((a, b) => b.week.localeCompare(a.week))) {
    const lines = orderedLines(o.lines, products);
    if (!lines.length) rows.push([name, o.week, STATUS_LABEL[o.status], "", "", "", "", o.notes]);
    for (const l of lines)
      rows.push([name, o.week, STATUS_LABEL[o.status], l.product?.name ?? l.id, l.qty, lineUnit(l.id, l.product ?? undefined, o.units), o.packed[l.id] ?? "", o.notes]);
  }
  return csvFile(HISTORY_COLUMNS, rows);
}

export const WEEK_COLUMNS = [
  "Week of",
  "Customer",
  "Chain",
  "Type",
  "Call day",
  "Contact",
  "Phone",
  "Email",
  "Bill to",
  "Answer",
  "Product",
  "Quantity",
  "Unit",
  "Packed",
  "Order notes",
  "Standing notes",
];

/**
 * The week's orders with customer details: a row per product ordered, and
 * one row for each customer with no products (no order, call back, not
 * called yet), so the list shows everyone. Sorted by customer name.
 */
export function weekOrdersCsv(
  week: string,
  customers: Customer[],
  byId: Map<string, Customer>,
  orders: Map<string, Order>,
  packed: Map<string, Qty>,
  products: ProductLite[],
): string {
  const rows: Cell[][] = [];
  const list = [...customers].sort((a, b) =>
    displayName(a, byId).localeCompare(displayName(b, byId), undefined, { sensitivity: "base" }),
  );
  for (const c of list) {
    const o = orders.get(c.id);
    const who = mainContact(c.contacts);
    const email = c.contacts.find((k) => k.name === who?.name && k.email)?.email ?? c.contacts.find((k) => k.email)?.email ?? "";
    const parent = c.parent_customer_id ? byId.get(c.parent_customer_id) : undefined;
    const billTo = billedThrough(c, byId)?.parent.name ?? "";
    const info: Cell[] = [week, c.name, parent?.name ?? "", c.type, c.call_day ?? "", who?.name ?? "", who?.phone ?? "", email, billTo];
    const status = STATUS_LABEL[o?.status ?? "todo"];
    const lines = o ? orderedLines(o.lines, products) : [];
    const got = o ? (packed.get(o.id) ?? {}) : {};
    if (!lines.length) rows.push([...info, status, "", "", "", "", o?.notes ?? "", c.notes]);
    for (const l of lines)
      rows.push([...info, status, l.product?.name ?? l.id, l.qty, lineUnit(l.id, l.product ?? undefined, o!.units), got[l.id] ?? "", o!.notes, c.notes]);
  }
  return csvFile(WEEK_COLUMNS, rows);
}

// ---------------------------------------------------------------------------
// Product totals for a week: a pick list, and what to check Mohawk's cut against.
// ---------------------------------------------------------------------------

export const PRODUCT_TOTAL_COLUMNS = [
  "Week of",
  "Product",
  "Group",
  "Unit",
  "Customers",
  "Ordered",
  "For half and whole",
  "Total to cut",
  "Packed",
  "Short",
];

export function productTotalsCsv(
  week: string,
  products: (ProductLite & { group_name: string })[],
  orders: Order[],
  packed: Map<string, Qty>,
  halfWholeShort: Qty,
): string {
  const rows: Cell[][] = [];
  for (const p of [...products].sort((a, b) => a.sort - b.sort)) {
    let ordered = 0;
    let got = 0;
    let customers = 0;
    for (const o of orders) {
      // In the product's own unit (pounds of a piece product become pieces).
      const q = toProductUnit(o.lines[p.id] ?? 0, o.units?.[p.id], p);
      if (!q) continue;
      customers++;
      ordered += q;
      got += packed.get(o.id)?.[p.id] ?? 0;
    }
    const hw = halfWholeShort[p.id] ?? 0;
    if (!ordered && !hw) continue;
    rows.push([week, p.name, p.group_name, p.unit, customers, ordered, hw || "", ordered + hw, got, Math.max(0, ordered - got) || ""]);
  }
  return csvFile(PRODUCT_TOTAL_COLUMNS, rows);
}

// ---------------------------------------------------------------------------
// Customer list: an address book, one row per contact.
// ---------------------------------------------------------------------------

export const CUSTOMER_LIST_COLUMNS = [
  "Customer",
  "Chain",
  "Type",
  "Call day",
  "Active",
  "Bills for all locations",
  "Bill to",
  "Contact",
  "Handles",
  "Phone",
  "Email",
  "Standing notes",
];

export function customerListCsv(customers: Customer[], byId: Map<string, Customer>): string {
  const rows: Cell[][] = [];
  const list = [...customers].sort((a, b) =>
    displayName(a, byId).localeCompare(displayName(b, byId), undefined, { sensitivity: "base" }),
  );
  for (const c of list) {
    const parent = c.parent_customer_id ? byId.get(c.parent_customer_id) : undefined;
    const info: Cell[] = [
      c.name,
      parent?.name ?? "",
      c.type,
      c.call_day ?? "",
      c.active ? "Yes" : "No",
      c.bills_for_locations ? "Yes" : "",
      billedThrough(c, byId)?.parent.name ?? "",
    ];
    if (!c.contacts.length) rows.push([...info, "", "", "", "", c.notes]);
    for (const k of c.contacts) rows.push([...info, k.name, rolesLabel(k.roles), k.phone, k.email, c.notes]);
  }
  return csvFile(CUSTOMER_LIST_COLUMNS, rows);
}

// ---------------------------------------------------------------------------
// Sales over a date range: quantities by customer and product (no prices yet).
// ---------------------------------------------------------------------------

export const SALES_COLUMNS = ["From week", "To week", "Customer", "Chain", "Product", "Unit", "Total", "Weeks ordered", "First week", "Last week"];

export function salesCsv(
  from: string,
  to: string,
  orders: { customer_id: string; week: string; lines: Qty; units?: Units }[],
  byId: Map<string, Customer>,
  products: ProductLite[],
): string {
  const prodBy = new Map(products.map((p) => [p.id, p]));
  type Acc = { total: number; weeks: Set<string>; first: string; last: string };
  const acc = new Map<string, Acc>(); // customer|product
  for (const o of orders) {
    for (const [pid, raw] of Object.entries(o.lines)) {
      const prod = prodBy.get(pid);
      const q = prod ? toProductUnit(raw, o.units?.[pid], prod) : raw;
      if (!q) continue;
      const k = `${o.customer_id}|${pid}`;
      const a = acc.get(k) ?? { total: 0, weeks: new Set<string>(), first: o.week, last: o.week };
      a.total += q;
      a.weeks.add(o.week);
      if (o.week < a.first) a.first = o.week;
      if (o.week > a.last) a.last = o.week;
      acc.set(k, a);
    }
  }
  const prodById = new Map(products.map((p) => [p.id, p]));
  const rows = [...acc.entries()].map(([k, a]) => {
    const [cid, pid] = k.split("|");
    const c = byId.get(cid);
    const p = prodById.get(pid);
    const parent = c?.parent_customer_id ? byId.get(c.parent_customer_id) : undefined;
    return {
      sortName: c ? displayName(c, byId) : cid,
      sortProduct: p?.sort ?? 1e9,
      row: [from, to, c?.name ?? "(deleted customer)", parent?.name ?? "", p?.name ?? pid, p?.unit ?? "", a.total, a.weeks.size, a.first, a.last] as Cell[],
    };
  });
  rows.sort((x, y) => x.sortName.localeCompare(y.sortName, undefined, { sensitivity: "base" }) || x.sortProduct - y.sortProduct);
  return csvFile(SALES_COLUMNS, rows.map((r) => r.row));
}

// ---------------------------------------------------------------------------
// Packing record for a week: ordered against packed, with who and when.
// ---------------------------------------------------------------------------

export const PACKING_COLUMNS = [
  "Week of",
  "Customer",
  "Chain",
  "Product",
  "Unit",
  "Ordered",
  "Packed",
  "Short",
  "Over",
  "Packed by",
  "Packed at",
  "Boxes",
  "Pallet",
  "Boxes and pallet by",
];

export function packingRecordCsv(
  week: string,
  records: {
    customer_id: string;
    status: OrderStatus;
    lines: Qty;
    units?: Units;
    packed: Record<string, { qty: number; by: string; at: string }>;
    boxes: number | null;
    pallet: string;
    stampedBy: string;
  }[],
  byId: Map<string, Customer>,
  products: ProductLite[],
  formatTime: (iso: string) => string,
): string {
  const rows: Cell[][] = [];
  const name = (id: string) => {
    const c = byId.get(id);
    return c ? displayName(c, byId) : "(deleted customer)";
  };
  const list = records
    .filter((r) => r.status === "ordered" && Object.values(r.lines).some(Boolean))
    .sort((a, b) => name(a.customer_id).localeCompare(name(b.customer_id), undefined, { sensitivity: "base" }));
  for (const r of list) {
    const c = byId.get(r.customer_id);
    const parent = c?.parent_customer_id ? byId.get(c.parent_customer_id) : undefined;
    for (const l of orderedLines(r.lines, products)) {
      const p = r.packed[l.id];
      const got = p?.qty;
      const diff = got == null ? 0 : got - l.qty;
      rows.push([
        week,
        c?.name ?? "(deleted customer)",
        parent?.name ?? "",
        l.product?.name ?? l.id,
        lineUnit(l.id, l.product ?? undefined, r.units),
        l.qty,
        got ?? "",
        diff < 0 ? -diff : "",
        diff > 0 ? diff : "",
        p?.by ?? "",
        p ? formatTime(p.at) : "",
        r.boxes ?? "",
        r.pallet,
        r.stampedBy,
      ]);
    }
  }
  return csvFile(PACKING_COLUMNS, rows);
}

// ---------------------------------------------------------------------------
// Freezer on hand.
// ---------------------------------------------------------------------------

export const FREEZER_COLUMNS = ["As of", "Product", "Group", "Counted in", "On hand", "Held for half and whole", "Free"];

export function freezerCsv(
  asOf: string,
  products: (ProductLite & { group_name: string; countUnit: string })[],
  onHand: Qty,
  held: Qty,
): string {
  const rows: Cell[][] = [...products]
    .sort((a, b) => a.sort - b.sort)
    .map((p) => {
      const oh = onHand[p.id] ?? 0;
      const h = held[p.id] ?? 0;
      return [asOf, p.name, p.group_name, p.countUnit, oh, h || "", oh - h];
    });
  return csvFile(FREEZER_COLUMNS, rows);
}
