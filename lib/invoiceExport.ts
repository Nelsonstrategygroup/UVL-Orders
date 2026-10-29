// Finalized invoices for the downloads (Open invoices, QuickBooks lines):
// the lines as finalized, with each line's total and discount in cents.

import { invoiceState, paidCents, priceLines, STATE_LABEL } from "./calc/invoice";
import { lineTotalCents, priceText } from "./calc/prices";
import type { InvoiceRow } from "./db/invoices";
import type { IssuedInvoice } from "./reports";

export function toIssued(inv: InvoiceRow, productName: (id: string) => string, customerName: (id: string) => string): IssuedInvoice {
  const lines = priceLines(inv.invoice_lines, [], inv.customer_id, inv.invoice_date);
  const total = inv.total != null ? lineTotalCents(1, inv.total) : lines.reduce((s, l) => s + (l.totalCents ?? BigInt(0)), BigInt(0));
  const paid = paidCents(inv.payments ?? []);
  return {
    number: inv.number ?? "",
    customer: inv.issued?.customer_name ?? customerName(inv.customer_id),
    invoiceDate: inv.invoice_date,
    dueDate: inv.due_date ?? inv.invoice_date,
    termsDays: inv.terms_days ?? 0,
    memo: inv.memo,
    totalCents: total,
    paidCents: paid,
    status: STATE_LABEL[invoiceState(inv.status, total, paid)],
    lines: lines.map((l) => ({
      kind: l.kind,
      // The QuickBooks product: the line's name as printed ("Racks"; "Heart, Liver, Kidney" for the organ box).
      item: l.description || (l.product_id ? productName(l.product_id) : ""),
      description: [l.description, l.detail].filter(Boolean).join(": "),
      quantity: l.quantity,
      rate: l.price,
      grossCents: l.grossCents,
      discountCents: l.discountCents,
      discountText: `${l.discount_kind === "percent" ? `${Number(l.discount)}%` : priceText(l.discount ?? 0)} off ${l.description}${l.note ? `: ${l.note}` : ""}`,
    })),
  };
}
