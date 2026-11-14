// Every report on Print and download that has a spreadsheet (change request
// 10/21/26): how to build its table, and how it reads as a page. The Download
// button and the Open page both build the table here, so they always match.

import { orderGridReportPrint, type GridReportPrint } from "@/lib/orderGridReportPrint";
import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName, orderingCustomers, sortByDisplayName } from "@/lib/calc/customers";
import { halfWholeNeeds } from "@/lib/calc/halfWhole";
import { groupProducts } from "@/lib/calc/products";
import { countUnit } from "@/lib/calc/units";
import { currentWeek, packingMonday, todayISO, weekName } from "@/lib/dates";
import { loadCustomerOrders, loadOrdersBetween, loadPackingRecord } from "@/lib/db/load";
import { loadCustomerBilling, loadWeekNumbers } from "@/lib/db/invoicing";
import { loadIssuedInvoices } from "@/lib/db/invoices";
import { daysOverdue } from "@/lib/calc/invoice";
import { toIssued } from "@/lib/invoiceExport";
import { packedWith } from "@/lib/calc/packTogether";
import { partPackSizes } from "@/lib/calc/packs";
import { carcassReport, type CarcassReport } from "@/lib/calc/carcassReport";
import { weekCalc } from "@/lib/weekCalc";
import type { Catalog, CustomersData, WeekData } from "@/lib/db/types";
import { formatDateTime } from "@/lib/format";
import type { ReadableShape } from "@/lib/readable";
import { invFileName, invLabel, invRangeFilePrefix, invRangeLabel } from "@/lib/weekInv";
import {
  boxSizesTable,
  customerHistoryTable,
  customerListTable,
  fileSafe,
  freezerTable,
  invoiceCodesTable,
  carcassBalanceTable,
  openInvoicesTable,
  orderGridTable,
  packingRecordTable,
  productTotalsTable,
  quickbooksLinesTable,
  salesTable,
  weekOrdersTable,
  type Table,
  type WeekInvs,
} from "@/lib/reports";

export type ReportKind =
  | "week-orders"
  | "order-grid"
  | "product-totals"
  | "packing-record"
  | "customers"
  | "history"
  | "sales"
  | "freezer"
  | "box-sizes"
  | "invoice-codes"
  | "carcass-balance"
  | "open-invoices"
  | "invoice-lines";

export type ReportDef = {
  title: string;
  /** What the page needs picked: the week, a customer, a date range, or nothing. */
  filter: "week" | "customer" | "range" | "none";
  /** Too wide for a phone: scrolls sideways, first column fixed, prints landscape. */
  wide?: boolean;
  /** Always an Excel file (the order grid). */
  xlsxOnly?: boolean;
  /** Column lines on every cell, to follow a row across on paper (box sizes). */
  lined?: boolean;
  shape: ReadableShape;
};

export const REPORTS: Record<ReportKind, ReportDef> = {
  "week-orders": {
    title: "This week's orders",
    filter: "week",
    shape: { constant: ["Week of"], groupBy: "Customer", items: ["Product", "Quantity", "Unit", "Packed (lb)"] },
  },
  // No Phone on the page (11/14/26); the Excel file keeps it.
  "order-grid": { title: "Order grid", filter: "week", wide: true, xlsxOnly: true, shape: { hide: ["Phone"] } },
  "product-totals": { title: "Product totals", filter: "week", shape: { constant: ["Week of"] } },
  "packing-record": {
    title: "Packing record",
    filter: "week",
    shape: {
      constant: ["Week of"],
      groupBy: "Customer",
      items: ["Product", "Ordered", "Unit", "Packed (lb)", "Pieces packed", "Short", "Over", "Not filled", "Flag", "Box weights", "Weighed by", "Last weighed"],
    },
  },
  customers: { title: "Customer list", filter: "none", shape: { groupBy: "Customer", items: ["Contact", "Handles", "Phone", "Email"] } },
  history: {
    title: "Order history",
    filter: "customer",
    shape: { constant: ["Customer"], groupBy: "Week of", items: ["Product", "Quantity", "Unit", "Packed (lb)"] },
  },
  sales: { title: "Sales over a date range", filter: "range", wide: true, shape: { constant: ["From week", "To week"] } },
  freezer: { title: "Freezer on hand", filter: "none", shape: { constant: ["As of"] } },
  "box-sizes": { title: "Box sizes", filter: "none", wide: true, lined: true, shape: { keep: ["Notes"] } },
  "invoice-codes": { title: "Invoice codes", filter: "none", lined: true, shape: { keep: ["Notes"] } },
  "carcass-balance": {
    title: "Carcass balance",
    filter: "week",
    shape: { constant: ["Week of"], groupBy: "Part", items: ["Line", "Quantity", "Unit"] },
  },
  "open-invoices": { title: "Open invoices", filter: "none", wide: true, shape: {} },
  "invoice-lines": { title: "Invoice lines for QuickBooks", filter: "range", wide: true, shape: {} },
};

export function isReportKind(v: string): v is ReportKind {
  return v in REPORTS;
}

export type ReportInput = {
  db: SupabaseClient;
  week: string;
  catalog: Catalog;
  customers: CustomersData;
  data: WeekData;
  customerId?: string;
  from?: string;
  to?: string;
};

export type BuiltReport = {
  table: Table;
  file: string;
  sheet: string;
  carcass?: CarcassReport;
  /** "INV# 3001" (the week's), "INV# 2998 to 3002" (a range), "INV# ______" (not set), or "" (not about a week: customers, box sizes, codes). */
  inv: string;
  /** What it covers, after the name: "Packing Mon Nov 2", "As of 2026-10-31". */
  when?: string;
  /** The Order grid's own paper layout (11/13/26); the screen keeps the table. */
  gridPrint?: GridReportPrint;
};

/** Each week's invoice number, for reports over many weeks. */
async function weekInvs(db: SupabaseClient): Promise<WeekInvs> {
  return new Map((await loadWeekNumbers(db)).map((w) => [w.id, w.invoice_number]));
}

/**
 * The table and file name for a report, or null when its filter isn't filled
 * in yet (no customer picked). Every report about a week carries that week's
 * invoice number (Lucas, 10/31/26): in the page header, in the file's top row,
 * and at the start of the file name ("INV3001 Order Grid 2026-10-26").
 */
export async function buildReport(kind: ReportKind, x: ReportInput): Promise<BuiltReport | null> {
  const r = await buildTable(kind, x);
  if (!r) return null;
  // The QuickBooks import reads its first row as the column names: no top row there.
  const top = r.inv && kind !== "invoice-lines" ? [r.inv, REPORTS[kind].title, r.when].filter(Boolean).join(" · ") : undefined;
  return { ...r, table: { ...r.table, title: top } };
}

async function buildTable(kind: ReportKind, x: ReportInput): Promise<BuiltReport | null> {
  const { week, catalog, customers, data } = x;
  const title = REPORTS[kind].title;
  // A report about the picked week: its number, its name, its date.
  const n = data.weekRow?.invoice_number ?? null;
  const ofWeek = { inv: invLabel(n), when: `Packing ${weekName(week)}`, file: invFileName(n, title, week) };
  const productName = (id: string) => catalog.productById.get(id)?.name ?? id;
  const customerName = (id: string) => {
    const c = customers.byId.get(id);
    return c ? displayName(c, customers.byId) : "Unknown customer";
  };
  // Products packed together: the whole group, so QuickBooks always gets the same item.
  const groupName = (id: string) => {
    const ids = packedWith(id, catalog.products);
    return ids.length > 1 ? ids.map(productName).join(", ") : null;
  };
  switch (kind) {
    case "week-orders": {
      const ordering = new Set(orderingCustomers(customers.list).map((c) => c.id));
      const list = customers.list.filter((c) => ordering.has(c.id) || data.orders.has(c.id));
      return {
        table: weekOrdersTable(week, list, customers.byId, data.orders, data.packed, catalog.products),
        ...ofWeek,
        sheet: "Orders",
      };
    }
    case "order-grid": {
      // The same customers and products as the grid on Orders.
      const shown = groupProducts(catalog.products.filter((p) => p.active)).flatMap((g) => g.products);
      const list = sortByDisplayName(orderingCustomers(customers.list), customers.byId);
      return {
        table: orderGridTable(list, customers.byId, data.orders, shown),
        gridPrint: orderGridReportPrint(list, customers.byId, data.orders, shown),
        ...ofWeek,
        sheet: "Orders",
      };
    }
    case "product-totals": {
      const { short } = halfWholeNeeds(data.freezer, data.halfWhole, catalog.parts, catalog.products);
      return {
        table: productTotalsTable(week, catalog.products, [...data.orders.values()], data.packed, short, [...data.requests.values()].flat()),
        ...ofWeek,
        sheet: "Product totals",
      };
    }
    case "packing-record": {
      const records = await loadPackingRecord(x.db, week);
      return {
        table: packingRecordTable(week, records, customers.byId, catalog.products, formatDateTime),
        ...ofWeek,
        sheet: "Packing record",
      };
    }
    case "customers":
      return { table: customerListTable(customers.list, customers.byId), file: "customer-list", sheet: "Customers", inv: "" };
    case "history": {
      const c = x.customerId ? customers.byId.get(x.customerId) : undefined;
      if (!c) return null;
      const name = displayName(c, customers.byId);
      const [orders, invs] = await Promise.all([loadCustomerOrders(x.db, c.id), weekInvs(x.db)]);
      const nums = orders.map((o) => invs.get(o.week));
      return {
        table: customerHistoryTable(name, orders, catalog.products, invs),
        file: `${invRangeFilePrefix(nums)} ${fileSafe(name)} Order History`,
        sheet: "Order history",
        inv: invRangeLabel(nums),
        when: name,
      };
    }
    case "sales": {
      if (!x.from || !x.to || x.from > x.to) return null;
      const a = packingMonday(x.from);
      const b = packingMonday(x.to);
      const [orders, invs] = await Promise.all([loadOrdersBetween(x.db, a, b), weekInvs(x.db)]);
      const nums = [...invs].filter(([w]) => w >= a && w <= b).map(([, v]) => v);
      return {
        table: salesTable(a, b, orders, customers.byId, catalog.products, invs),
        file: `${invRangeFilePrefix(nums)} Sales ${a} to ${b}`,
        sheet: "Sales",
        inv: invRangeLabel(nums),
        when: `Packing ${weekName(a)} to ${weekName(b)}`,
      };
    }
    case "box-sizes": {
      // The same products and order as Setup > Boxes.
      const groups = groupProducts(catalog.products.filter((p) => p.active));
      return { table: boxSizesTable(groups, catalog.boxes.types, catalog.boxes.limits), file: `box-sizes-${todayISO()}`, sheet: "Box sizes", inv: "" };
    }
    case "invoice-codes": {
      const billing = await loadCustomerBilling(x.db);
      const hasLocations = new Set(customers.list.map((c) => c.parent_customer_id).filter(Boolean));
      const list = sortByDisplayName(
        customers.list.filter((c) => !hasLocations.has(c.id) && (c.active || billing.get(c.id)?.invoice_code)),
        customers.byId,
      );
      return {
        table: invoiceCodesTable(list.map((c) => ({ name: displayName(c, customers.byId), code: billing.get(c.id)?.invoice_code ?? "" }))),
        file: `invoice-codes-${todayISO()}`,
        sheet: "Invoice codes",
        inv: "",
      };
    }
    case "carcass-balance": {
      // The same balance as This week, with Le Trim's share in it.
      const { c, leTrim } = weekCalc(data, catalog);
      const plan = data.leTrim;
      const report = carcassReport({
        c,
        products: catalog.products,
        parts: catalog.parts,
        packSizes: partPackSizes(catalog.products),
        extraLambs: data.extraLambs ?? [],
        leTrim: {
          planned: !!plan,
          orderedLb: leTrim.ordered.lb,
          shoulders: plan ? plan.shoulders : leTrim.need.shoulders,
          halfLegs: plan ? plan.half_legs : leTrim.need.halfLegs,
          trimLb: plan ? plan.trim_lb : leTrim.need.trimLb,
          shoulderLb: leTrim.weights.shoulderLb,
          legLb: leTrim.weights.legLb,
        },
      });
      return {
        carcass: report,
        table: carcassBalanceTable(week, report),
        ...ofWeek,
        sheet: "Carcass balance",
      };
    }
    case "open-invoices": {
      const [list, invs] = await Promise.all([loadIssuedInvoices(x.db), weekInvs(x.db)]);
      const today = todayISO();
      const issued = list.map((i) => toIssued(i, productName, customerName, groupName, (w) => String(invs.get(w) ?? "")));
      const t = openInvoicesTable(issued, (due) => daysOverdue(due, today));
      const nums = t.rows.map((r) => r[0] as string);
      return {
        table: t,
        file: `${invRangeFilePrefix(nums)} Open Invoices ${today}`,
        sheet: "Open invoices",
        inv: invRangeLabel(nums),
        when: `As of ${today}`,
      };
    }
    case "invoice-lines": {
      if (!x.from || !x.to || x.from > x.to) return null;
      const [list, invs] = await Promise.all([loadIssuedInvoices(x.db, { from: x.from, to: x.to }), weekInvs(x.db)]);
      const nums = list.map((i) => invs.get(i.week_id));
      return {
        table: quickbooksLinesTable(list.map((i) => toIssued(i, productName, customerName, groupName))),
        file: `${invRangeFilePrefix(nums)} Invoice Lines ${x.from} to ${x.to}`,
        sheet: "Invoices",
        inv: invRangeLabel(nums),
      };
    }
    case "freezer": {
      const { need, onHand } = halfWholeNeeds(data.freezer, data.halfWhole, catalog.parts, catalog.products);
      const products = catalog.products
        .filter((p) => !p.fresh_only && (p.active || (onHand[p.id] ?? 0) !== 0))
        .map((p) => ({ ...p, countUnit: countUnit(p, catalog.parts) }));
      // On hand today: this week's number.
      const now = currentWeek();
      const nowInv = now === week ? n : ((await weekInvs(x.db)).get(now) ?? null);
      return {
        table: freezerTable(todayISO(), products, onHand, need),
        file: invFileName(nowInv, title, todayISO()),
        sheet: "Freezer",
        inv: invLabel(nowInv),
        when: `As of ${todayISO()}`,
      };
    }
  }
}

/** The address of a report's page, with its filters. */
export function reportHref(kind: ReportKind, f: { customerId?: string; from?: string; to?: string } = {}): string {
  const q = new URLSearchParams();
  if (f.customerId) q.set("customer", f.customerId);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  const s = q.toString();
  return `/print/report/${kind}${s ? `?${s}` : ""}`;
}
