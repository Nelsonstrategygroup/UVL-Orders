// One invoice ready to show: its lines priced on its date, the location's
// name, bill-to, terms and due date, and its boxes when it has box detail.

import { displayName } from "@/lib/calc/customers";
import { dueDate, invoiceTotals, priceLines, termsFor } from "@/lib/calc/invoice";
import type { Catalog, CustomersData } from "@/lib/db/types";
import type { InvoiceRow } from "@/lib/db/invoices";
import type { InvoiceSheetProps } from "./InvoiceSheet";
import type { InvoiceWeek } from "./useInvoiceWeek";

export function sheetFor(data: InvoiceWeek, inv: InvoiceRow, customers: CustomersData, catalog: Catalog | null): InvoiceSheetProps {
  const productName = (id: string) => catalog?.productById.get(id)?.name ?? id;
  // Finalized (or void after it): everything as issued, never today's settings.
  const is = inv.issued;
  if (inv.status !== "draft" && is) {
    const terms = inv.terms_days ?? 0;
    return {
      invoice: inv,
      lines: priceLines(inv.invoice_lines, [], inv.customer_id, inv.invoice_date),
      customerName: is.customer_name,
      billTo: is.bill_to,
      terms,
      due: inv.due_date ?? dueDate(inv.invoice_date, terms),
      settings: {
        business_name: is.business_name,
        business_address: is.business_address,
        business_phone: is.business_phone,
        business_email: is.business_email,
        remit_to: is.remit_to,
        invoice_note: is.invoice_note,
        default_terms_days: terms,
      },
      boxes: is.box_detail ? inv.invoice_boxes.map((b) => ({ ...b, id: b.box_id, customer_id: inv.customer_id })) : null,
      productName,
    };
  }
  const c = customers.byId.get(inv.customer_id);
  const b = data.billing.get(inv.customer_id);
  const terms = termsFor(b?.terms_days, data.settings?.default_terms_days ?? 15);
  return {
    invoice: inv,
    lines: priceLines(inv.invoice_lines, data.prices, inv.customer_id, inv.invoice_date),
    customerName: c ? displayName(c, customers.byId) : "Unknown customer",
    billTo: b?.bill_to_address ?? "",
    terms,
    due: dueDate(inv.invoice_date, terms),
    settings: data.settings,
    boxes: b?.box_detail ? data.boxes.filter((x) => x.customer_id === inv.customer_id) : null,
    productName,
  };
}

/** Totals for the list, from the same priced lines. */
export const totalsOf = (s: InvoiceSheetProps) => invoiceTotals(s.lines);
