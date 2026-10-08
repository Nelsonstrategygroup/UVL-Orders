// Spreadsheet downloads for people (not the full backup in lib/export.ts):
// names instead of ID codes, one row per product ordered. CSV with a BOM so
// Excel opens it with the right characters.

import { billedThrough, mainContact } from "./calc/contacts";
import { displayName } from "./calc/customers";
import { STATUS_LABEL } from "./orders";
import type { Customer, Order, OrderStatus, Qty } from "./db/types";
import { csvCell } from "./import/csv";

type Cell = string | number | null | undefined;
type ProductLite = { id: string; name: string; unit: string; sort: number };

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
  orders: { week: string; status: OrderStatus; notes: string; lines: Qty; packed: Qty }[],
  products: ProductLite[],
): string {
  const rows: Cell[][] = [];
  for (const o of [...orders].sort((a, b) => b.week.localeCompare(a.week))) {
    const lines = orderedLines(o.lines, products);
    if (!lines.length) rows.push([name, o.week, STATUS_LABEL[o.status], "", "", "", "", o.notes]);
    for (const l of lines)
      rows.push([name, o.week, STATUS_LABEL[o.status], l.product?.name ?? l.id, l.qty, l.product?.unit ?? "", o.packed[l.id] ?? "", o.notes]);
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
      rows.push([...info, status, l.product?.name ?? l.id, l.qty, l.product?.unit ?? "", got[l.id] ?? "", o!.notes, c.notes]);
  }
  return csvFile(WEEK_COLUMNS, rows);
}
