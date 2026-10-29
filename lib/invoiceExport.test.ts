import { describe, expect, it } from "vitest";
import type { InvoiceLineRow } from "./calc/invoice";
import type { InvoiceRow } from "./db/invoices";
import { toIssued } from "./invoiceExport";
import { centsPlain, openInvoicesTable, quickbooksLinesTable, usDate } from "./reports";

const line = (p: Partial<InvoiceLineRow>): InvoiceLineRow => ({
  id: p.id ?? "l",
  invoice_id: "i",
  kind: "packed",
  product_id: "chops",
  description: "Chops",
  ordered_qty: null,
  ordered_unit: "",
  boxes: 1,
  quantity: "29.545",
  price_unit: "lb",
  unit_price: "9.5",
  discount_kind: null,
  discount: null,
  not_on_order: false,
  note: "",
  sort: 1,
  ...p,
});

const invoice = (p: Partial<InvoiceRow>): InvoiceRow => ({
  id: "i",
  week_id: "2099-11-02",
  customer_id: "c",
  number: "99301-LIFE",
  reissue: 0,
  status: "sent",
  invoice_date: "2099-11-03",
  memo: "",
  fingerprint: "",
  created_at: "",
  replaces_id: null,
  terms_days: 15,
  due_date: "2099-11-18",
  total: "385.67",
  issued: null,
  finalized_at: null,
  sent_at: null,
  voided_at: null,
  void_reason: "",
  invoice_lines: [],
  payments: [],
  invoice_boxes: [],
  ...p,
});

const names = { product: (id: string) => id, customer: () => "Life Market" };

describe("invoice downloads", () => {
  const inv = invoice({
    invoice_lines: [
      line({ id: "a", discount_kind: "amount", discount: "5", note: "Short date" }),
      line({ id: "b", kind: "shorted", description: "Liver", product_id: "liver", quantity: "0", unit_price: null, sort: 2 }),
      line({ id: "c", kind: "manual", product_id: null, description: "Credit", quantity: "1", unit_price: "-10.005", note: "Broken box", sort: 3 }),
    ],
    payments: [{ id: "p", invoice_id: "i", paid_on: "2099-11-20", amount: "100", method: "check", reference: "1042", note: "", created_at: "" }],
  });

  it("writes QuickBooks rows: one per line, the discount as its own row, US dates", () => {
    const t = quickbooksLinesTable([toIssued(inv, names.product, names.customer)]);
    expect(t.rows.map((r) => [r[0], r[2], r[4], r[6], r[8], r[9], r[10]])).toEqual([
      ["99301-LIFE", "11/03/2099", "Net 15", "Chops", "29.545", "9.5", "280.68"],
      ["99301-LIFE", "11/03/2099", "Net 15", "Discount", 1, "-5.00", "-5.00"],
      ["99301-LIFE", "11/03/2099", "Net 15", "Liver", 0, "0", "0.00"],
      ["99301-LIFE", "11/03/2099", "Net 15", "Credit", "1", "-10.005", "-10.01"],
    ]);
    expect(t.rows[1][7]).toBe("$5.00 off Chops: Short date");
  });

  it("lists what's still owed, with totals", () => {
    const paidUp = invoice({ id: "j", number: "99301-PAID", total: "50", payments: [{ id: "q", invoice_id: "j", paid_on: "2099-11-20", amount: "50", method: "ach", reference: "", note: "", created_at: "" }] });
    const t = openInvoicesTable([toIssued(inv, names.product, names.customer), toIssued(paidUp, names.product, names.customer)], () => 3);
    expect(t.rows).toEqual([
      ["Life Market", "99301-LIFE", "11/03/2099", "11/18/2099", "Partly paid", "385.67", "100.00", "285.67", 3],
      ["1 open", "", "", "", "", "385.67", "100.00", "285.67", ""],
    ]);
  });

  it("formats money and dates for spreadsheets", () => {
    expect(centsPlain(BigInt(-1001))).toBe("-10.01");
    expect(centsPlain(BigInt(5))).toBe("0.05");
    expect(usDate("2026-10-27")).toBe("10/27/2026");
  });
});
