// An invoice's lines priced and totaled (SPEC 15, stage 2). Packed lines on a
// draft carry no price: it's looked up on the invoice date (the customer's
// own, else the default). Manual lines carry their own. Money is whole cents
// (BigInt), never floating point: line total = quantity x price rounded half
// up to the cent, less the discount (a dollar amount, or a percent of the
// line rounded half up to the cent). The invoice total is the sum.

import type { PriceUnit } from "../db/types";
import { addDays } from "../dates";
import { lineTotalCents, priceFor, toFixedInt, type PriceRow } from "./prices";

export type InvoiceStatus = "draft" | "finalized" | "sent" | "void";
export type LineKind = "packed" | "shorted" | "manual" | "inventory";
export type DiscountKind = "amount" | "percent";

/** An invoice line as stored. Numbers from the database may be numbers or decimal strings. */
export type InvoiceLineRow = {
  id: string;
  invoice_id: string;
  kind: LineKind;
  product_id: string | null;
  description: string;
  ordered_qty: number | string | null;
  ordered_unit: string;
  boxes: number;
  /** Blank: Count needed (per each, no count typed). */
  quantity: number | string | null;
  price_unit: PriceUnit | null;
  /** Manual lines, and every line once finalized. Blank on a draft's packed line. */
  unit_price: number | string | null;
  discount_kind: DiscountKind | null;
  discount: number | string | null;
  not_on_order: boolean;
  note: string;
  sort: number;
  /** Under the line: the packs counted for products packed together ("2 Heart, 5 Liver"). Missing on rows from before 10/29/26. */
  detail?: string;
};

export type PricedLine = InvoiceLineRow & {
  /** The price used (a decimal), or null: Price needed. */
  price: string | null;
  /** Where it came from: on the line, the customer's own price, the default. */
  priceFrom: "line" | "customer" | "default" | null;
  /** Quantity x price, rounded; null when the price or count is missing. */
  grossCents: bigint | null;
  discountCents: bigint;
  /** The line's total; null when it can't be worked out yet. */
  totalCents: bigint | null;
  priceNeeded: boolean;
  countNeeded: boolean;
};

const ZERO = BigInt(0);

/** A discount in cents off a line of `grossCents`: a dollar amount, or a percent, each rounded half up to the cent. */
export function discountCents(grossCents: bigint, kind: DiscountKind | null, value: number | string | null): bigint {
  if (!kind || value == null) return ZERO;
  if (kind === "amount") return lineTotalCents(1, value);
  // percent (4 places) of cents: divide by 100 x 10^4, half up.
  const raw = grossCents * toFixedInt(value, 4);
  const unit = BigInt(1000000);
  const neg = raw < ZERO;
  const a = neg ? -raw : raw;
  const c = (a + unit / BigInt(2)) / unit;
  return neg ? -c : c;
}

/** Price every line for this customer on this date. */
export function priceLines(lines: InvoiceLineRow[], prices: PriceRow[], customerId: string, date: string): PricedLine[] {
  return [...lines]
    .sort((a, b) => a.sort - b.sort)
    .map((l) => {
      const shorted = l.kind === "shorted";
      let price: string | null = null;
      let priceFrom: PricedLine["priceFrom"] = null;
      if (l.unit_price != null) {
        price = String(l.unit_price);
        priceFrom = "line";
      } else if (l.product_id && !shorted) {
        const p = priceFor(prices, l.product_id, customerId, date);
        if (p) {
          price = String(p.price);
          priceFrom = p.customer_id ? "customer" : "default";
        }
      }
      const countNeeded = !shorted && l.quantity == null;
      const priceNeeded = !shorted && price == null;
      const grossCents = shorted ? ZERO : price != null && l.quantity != null ? lineTotalCents(l.quantity, price) : null;
      const disc = grossCents == null ? ZERO : discountCents(grossCents, l.discount_kind, l.discount);
      return {
        ...l,
        price,
        priceFrom,
        grossCents,
        discountCents: disc,
        totalCents: grossCents == null ? null : grossCents - disc,
        priceNeeded,
        countNeeded,
      };
    });
}

export type InvoiceTotals = {
  /** Sum of the lines that can be worked out. */
  totalCents: bigint;
  /** Lines with no price. */
  priceNeeded: number;
  /** Per each lines with no count. */
  countNeeded: number;
  /** Every line has a price and a count: the total is complete. */
  complete: boolean;
  boxes: number;
  /** Net weight of the per-lb lines, in thousandths of a pound (exact). */
  lbThousandths: bigint;
};

export function invoiceTotals(lines: PricedLine[]): InvoiceTotals {
  let totalCents = ZERO;
  let lb = ZERO;
  let boxes = 0;
  for (const l of lines) {
    if (l.totalCents != null) totalCents += l.totalCents;
    boxes += l.boxes;
    if (l.kind === "packed" && l.price_unit === "lb" && l.quantity != null) lb += toFixedInt(l.quantity, 3);
  }
  const priceNeeded = lines.filter((l) => l.priceNeeded).length;
  const countNeeded = lines.filter((l) => l.countNeeded).length;
  return { totalCents, priceNeeded, countNeeded, complete: priceNeeded === 0 && countNeeded === 0, boxes, lbThousandths: lb };
}

/** Thousandths of a pound as "1,234.56" (two places, as the manifests show; exact to 3 if a third is there). */
export function lbText(thousandths: bigint): string {
  const neg = thousandths < ZERO;
  const a = neg ? -thousandths : thousandths;
  const whole = (a / BigInt(1000)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (a % BigInt(1000)).toString().padStart(3, "0");
  if (frac.endsWith("0")) frac = frac.slice(0, 2);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** A line's billed quantity as printed: "59.65 lb", "2 cases", "3 each". */
export function quantityText(quantity: number | string | null, unit: PriceUnit | null): string {
  if (quantity == null) return "";
  const t = toFixedInt(quantity, 3);
  if (unit === "lb") return `${lbText(t)} lb`;
  const n = lbText(t).replace(/\.0+$/, "");
  if (unit === "case") return `${n} ${n === "1" ? "case" : "cases"}`;
  return `${n} each`;
}

/** The terms in days: the customer's own, else the default. */
export const termsFor = (own: number | null | undefined, fallback: number) => own ?? fallback;

/** Due date: the invoice date plus the terms. */
export const dueDate = (invoiceDate: string, termsDays: number) => addDays(invoiceDate, termsDays);

/** The invoice date an invoice starts with: the Tuesday after packing. */
export const firstInvoiceDate = (week: string) => addDays(week, 1);

/** A typed discount: dollars ("5", "$5.25") or a percent ("10%"). Null if it isn't one. */
export function parseDiscount(text: string): { kind: DiscountKind; value: string } | null {
  const t = text.trim();
  const pct = /%$/.test(t);
  const num = t.replace(/%$/, "").replace(/^\$/, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,4})?$|^\.\d{1,4}$/.test(num)) return null;
  const v = Number(num);
  if (!(v > 0) || (pct && v > 100)) return null;
  return { kind: pct ? "percent" : "amount", value: num.startsWith(".") ? `0${num}` : num };
}

/** What a list shows: the status, with Paid and Partly paid worked out from the payments. */
export type InvoiceState = "draft" | "finalized" | "sent" | "partly" | "paid" | "void";

export const STATE_LABEL: Record<InvoiceState, string> = {
  draft: "Draft",
  finalized: "Finalized",
  sent: "Sent",
  partly: "Partly paid",
  paid: "Paid",
  void: "Void",
};

/** Payments added up, in cents. */
export function paidCents(payments: { amount: number | string }[]): bigint {
  return payments.reduce((s, p) => s + lineTotalCents(1, p.amount), ZERO);
}

export function invoiceState(status: InvoiceStatus, totalCents: bigint, paid: bigint): InvoiceState {
  if (status === "draft" || status === "void") return status;
  if (paid > ZERO && paid >= totalCents) return "paid";
  if (paid > ZERO) return "partly";
  return status;
}

/** Whole days past the due date (0 when not due yet). */
export function daysOverdue(due: string | null, today: string): number {
  if (!due) return 0;
  const d = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000;
  return d > 0 ? Math.round(d) : 0;
}
