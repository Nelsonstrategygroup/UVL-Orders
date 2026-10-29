import { describe, expect, it } from "vitest";
import {
  daysOverdue,
  discountCents,
  dueDate,
  firstInvoiceDate,
  invoiceState,
  invoiceTotals,
  lbText,
  paidCents,
  parseDiscount,
  priceLines,
  quantityText,
  STATE_LABEL,
  type InvoiceLineRow,
} from "./invoice";
import type { PriceRow } from "./prices";

const line = (p: Partial<InvoiceLineRow>): InvoiceLineRow => ({
  id: p.id ?? "l",
  invoice_id: "i",
  kind: "packed",
  product_id: "chops",
  description: "Chops",
  ordered_qty: null,
  ordered_unit: "",
  boxes: 1,
  quantity: "10",
  price_unit: "lb",
  unit_price: null,
  discount_kind: null,
  discount: null,
  not_on_order: false,
  note: "",
  sort: 1,
  ...p,
});
const price = (product_id: string, v: string, from: string, customer_id: string | null = null): PriceRow => ({
  id: `${product_id}-${from}-${customer_id}`,
  product_id,
  customer_id,
  price: v,
  effective_from: from,
  note: "",
});

describe("pricing an invoice", () => {
  const prices = [price("chops", "9.50", "2099-01-01"), price("chops", "10.25", "2099-06-01"), price("chops", "9.00", "2099-01-01", "cust")];

  it("uses the price on the invoice date, the customer's own first", () => {
    const [a] = priceLines([line({ quantity: "59.65" })], prices, "other", "2099-03-01");
    expect(a.price).toBe("9.50");
    expect(a.priceFrom).toBe("default");
    expect(a.totalCents).toBe(BigInt(56668)); // 59.65 x 9.50 = 566.675 -> 566.68
    const [b] = priceLines([line({ quantity: "59.65" })], prices, "other", "2099-06-01");
    expect(b.price).toBe("10.25");
    const [c] = priceLines([line({ quantity: "59.65" })], prices, "cust", "2099-06-01");
    expect(c.priceFrom).toBe("customer");
    expect(c.totalCents).toBe(BigInt(53685));
  });

  it("marks Price needed and Count needed, and leaves them out of the total", () => {
    const lines = priceLines(
      [
        line({ id: "a", quantity: "10" }),
        line({ id: "b", product_id: "liver", quantity: "5" }),
        line({ id: "c", price_unit: "each", quantity: null }),
      ],
      prices,
      "other",
      "2099-03-01",
    );
    expect(lines.map((l) => [l.priceNeeded, l.countNeeded])).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ]);
    const t = invoiceTotals(lines);
    expect(t.totalCents).toBe(BigInt(9500));
    expect(t.priceNeeded).toBe(1);
    expect(t.countNeeded).toBe(1);
    expect(t.complete).toBe(false);
  });

  it("bills shorted lines at $0 with no price needed", () => {
    const [s] = priceLines([line({ kind: "shorted", product_id: "liver", quantity: "0", boxes: 0 })], prices, "x", "2099-03-01");
    expect(s.priceNeeded).toBe(false);
    expect(s.totalCents).toBe(BigInt(0));
  });

  it("uses a manual line's own price, which can be a credit", () => {
    const [m] = priceLines([line({ kind: "manual", product_id: null, quantity: "1", unit_price: "-12.5" })], [], "x", "2099-03-01");
    expect(m.priceFrom).toBe("line");
    expect(m.totalCents).toBe(BigInt(-1250));
  });

  it("takes a discount off the rounded line", () => {
    const [a] = priceLines([line({ quantity: "59.65", discount_kind: "percent", discount: "10", note: "x" })], prices, "o", "2099-03-01");
    expect(a.grossCents).toBe(BigInt(56668));
    expect(a.discountCents).toBe(BigInt(5667)); // 56.668 -> 56.67
    expect(a.totalCents).toBe(BigInt(51001));
    const [b] = priceLines([line({ quantity: "10", discount_kind: "amount", discount: "5", note: "x" })], prices, "o", "2099-03-01");
    expect(b.totalCents).toBe(BigInt(9000));
  });

  it("rounds discounts half up to the cent", () => {
    expect(discountCents(BigInt(1005), "percent", "50")).toBe(BigInt(503)); // 5.025 -> 5.03
    expect(discountCents(BigInt(1000), "amount", "2.345")).toBe(BigInt(235));
    expect(discountCents(BigInt(1000), null, null)).toBe(BigInt(0));
  });

  it("adds up boxes and pounds exactly", () => {
    const t = invoiceTotals(
      priceLines(
        [
          line({ id: "a", quantity: "0.1", boxes: 1 }),
          line({ id: "b", quantity: "0.2", boxes: 1 }),
          line({ id: "c", price_unit: "case", quantity: "2", boxes: 2 }),
        ],
        prices,
        "o",
        "2099-03-01",
      ),
    );
    expect(t.boxes).toBe(4);
    expect(lbText(t.lbThousandths)).toBe("0.30");
  });
});

describe("invoice text and dates", () => {
  it("prints quantities", () => {
    expect(quantityText("59.65", "lb")).toBe("59.65 lb");
    expect(quantityText(3168.82, "lb")).toBe("3,168.82 lb");
    expect(quantityText("2.000", "case")).toBe("2 cases");
    expect(quantityText("1", "case")).toBe("1 case");
    expect(quantityText("3", "each")).toBe("3 each");
    expect(quantityText(null, "each")).toBe("");
  });
  it("starts on the Tuesday after packing, due after the terms", () => {
    expect(firstInvoiceDate("2026-10-26")).toBe("2026-10-27");
    expect(dueDate("2026-10-27", 15)).toBe("2026-11-11");
  });
  it("reads a typed discount", () => {
    expect(parseDiscount("10%")).toEqual({ kind: "percent", value: "10" });
    expect(parseDiscount("$5.25")).toEqual({ kind: "amount", value: "5.25" });
    expect(parseDiscount(".5")).toEqual({ kind: "amount", value: "0.5" });
    expect(parseDiscount("150%")).toBeNull();
    expect(parseDiscount("0")).toBeNull();
    expect(parseDiscount("abc")).toBeNull();
  });
});

describe("payments and status", () => {
  it("adds up payments and works out Paid and Partly paid", () => {
    const paid = paidCents([{ amount: "100.10" }, { amount: 25.2 }]);
    expect(paid).toBe(BigInt(12530));
    expect(invoiceState("sent", BigInt(12530), paid)).toBe("paid");
    expect(invoiceState("finalized", BigInt(20000), paid)).toBe("partly");
    expect(invoiceState("sent", BigInt(20000), BigInt(0))).toBe("sent");
    expect(invoiceState("void", BigInt(20000), BigInt(0))).toBe("void");
    expect(STATE_LABEL.partly).toBe("Partly paid");
  });
  it("counts days overdue", () => {
    expect(daysOverdue("2026-11-11", "2026-11-20")).toBe(9);
    expect(daysOverdue("2026-11-11", "2026-11-01")).toBe(0);
    expect(daysOverdue(null, "2026-11-01")).toBe(0);
  });
});
