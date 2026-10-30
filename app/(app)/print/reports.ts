// Every report on Print and download that has a spreadsheet (change request
// 10/21/26): how to build its table, and how it reads as a page. The Download
// button and the Open page both build the table here, so they always match.

import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName, orderingCustomers, sortByDisplayName } from "@/lib/calc/customers";
import { halfWholeNeeds } from "@/lib/calc/halfWhole";
import { groupProducts } from "@/lib/calc/products";
import { countUnit } from "@/lib/calc/units";
import { packingMonday, todayISO } from "@/lib/dates";
import { loadCustomerOrders, loadOrdersBetween, loadPackingRecord } from "@/lib/db/load";
import { loadCustomerBilling } from "@/lib/db/invoicing";
import { loadIssuedInvoices } from "@/lib/db/invoices";
import { daysOverdue } from "@/lib/calc/invoice";
import { toIssued } from "@/lib/invoiceExport";
import { packedWith } from "@/lib/calc/packTogether";
import { partPackSizes } from "@/lib/calc/packs";
import { lambSourceLine } from "@/lib/calc/week";
import { partBalances } from "@/lib/calc/working";
import { weekCalc } from "@/lib/weekCalc";
import type { Catalog, CustomersData, WeekData } from "@/lib/db/types";
import { formatDateTime } from "@/lib/format";
import type { ReadableShape } from "@/lib/readable";
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
  "order-grid": { title: "Order grid", filter: "week", wide: true, xlsxOnly: true, shape: {} },
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
    shape: { constant: ["Week of", "Lambs"], groupBy: "Part", items: ["Goes to", "Quantity", "Unit"] },
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

/** The table and file name for a report, or null when its filter isn't filled in yet (no customer picked). */
export async function buildReport(kind: ReportKind, x: ReportInput): Promise<{ table: Table; file: string; sheet: string } | null> {
  const { week, catalog, customers, data } = x;
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
        file: `orders-week-of-${week}`,
        sheet: "Orders",
      };
    }
    case "order-grid": {
      // The same customers and products as the grid on Orders.
      const shown = groupProducts(catalog.products.filter((p) => p.active)).flatMap((g) => g.products);
      const list = sortByDisplayName(orderingCustomers(customers.list), customers.byId);
      return { table: orderGridTable(list, customers.byId, data.orders, shown), file: `order-grid-week-of-${week}`, sheet: "Orders" };
    }
    case "product-totals": {
      const { short } = halfWholeNeeds(data.freezer, data.halfWhole, catalog.parts, catalog.products);
      return {
        table: productTotalsTable(week, catalog.products, [...data.orders.values()], data.packed, short, [...data.requests.values()].flat()),
        file: `product-totals-week-of-${week}`,
        sheet: "Product totals",
      };
    }
    case "packing-record": {
      const records = await loadPackingRecord(x.db, week);
      return {
        table: packingRecordTable(week, records, customers.byId, catalog.products, formatDateTime),
        file: `packing-record-week-of-${week}`,
        sheet: "Packing record",
      };
    }
    case "customers":
      return { table: customerListTable(customers.list, customers.byId), file: "customer-list", sheet: "Customers" };
    case "history": {
      const c = x.customerId ? customers.byId.get(x.customerId) : undefined;
      if (!c) return null;
      const name = displayName(c, customers.byId);
      const orders = await loadCustomerOrders(x.db, c.id);
      return { table: customerHistoryTable(name, orders, catalog.products), file: `${fileSafe(name)}-order-history`, sheet: "Order history" };
    }
    case "sales": {
      if (!x.from || !x.to || x.from > x.to) return null;
      const a = packingMonday(x.from);
      const b = packingMonday(x.to);
      const orders = await loadOrdersBetween(x.db, a, b);
      return { table: salesTable(a, b, orders, customers.byId, catalog.products), file: `sales-${a}-to-${b}`, sheet: "Sales" };
    }
    case "box-sizes": {
      // The same products and order as Setup > Boxes.
      const groups = groupProducts(catalog.products.filter((p) => p.active));
      return { table: boxSizesTable(groups, catalog.boxes.types, catalog.boxes.limits), file: `box-sizes-${todayISO()}`, sheet: "Box sizes" };
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
      };
    }
    case "carcass-balance": {
      // The same balance as This week, with Le Trim's share in it.
      const { c, leTrim } = weekCalc(data, catalog);
      return {
        table: carcassBalanceTable(week, lambSourceLine(c) ?? String(c.final), partBalances(c, catalog.products), partPackSizes(catalog.products), leTrim.planned),
        file: `carcass-balance-week-of-${week}`,
        sheet: "Carcass balance",
      };
    }
    case "open-invoices": {
      const list = await loadIssuedInvoices(x.db);
      const today = todayISO();
      return {
        table: openInvoicesTable(list.map((i) => toIssued(i, productName, customerName, groupName)), (due) => daysOverdue(due, today)),
        file: `open-invoices-${today}`,
        sheet: "Open invoices",
      };
    }
    case "invoice-lines": {
      if (!x.from || !x.to || x.from > x.to) return null;
      const list = await loadIssuedInvoices(x.db, { from: x.from, to: x.to });
      return {
        table: quickbooksLinesTable(list.map((i) => toIssued(i, productName, customerName, groupName))),
        file: `invoice-lines-${x.from}-to-${x.to}`,
        sheet: "Invoices",
      };
    }
    case "freezer": {
      const { need, onHand } = halfWholeNeeds(data.freezer, data.halfWhole, catalog.parts, catalog.products);
      const products = catalog.products
        .filter((p) => !p.fresh_only && (p.active || (onHand[p.id] ?? 0) !== 0))
        .map((p) => ({ ...p, countUnit: countUnit(p, catalog.parts) }));
      return { table: freezerTable(todayISO(), products, onHand, need), file: `freezer-${todayISO()}`, sheet: "Freezer" };
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
