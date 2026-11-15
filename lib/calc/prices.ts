// Prices and money for invoicing (SPEC 15). Money is never a floating-point
// number: amounts are decimal strings or whole cents (BigInt), so 0.1 + 0.2
// is never 0.30000000000000004 on an invoice.

import type { PriceUnit } from "../db/types";

export const PRICE_UNITS: PriceUnit[] = ["lb", "case", "each"];

/** As the Products page and the Prices page say it. */
export const PRICE_UNIT_LABEL: Record<PriceUnit, string> = {
  lb: "Per lb (the boxes' weight)",
  case: "Per case (one case per box)",
  each: "Per each (the pieces packed)",
};

/** "/lb", "/case", "/each" after a price. */
export const PRICE_UNIT_SHORT: Record<PriceUnit, string> = { lb: "/lb", case: "/case", each: "/each" };

/** A price as stored: per price unit, from a date on. customer_id null is the default price. */
export type PriceRow = {
  id: string;
  product_id: string;
  customer_id: string | null;
  /** numeric(12,4) from the database: a number or a decimal string. */
  price: number | string;
  /** yyyy-mm-dd */
  effective_from: string;
  note: string;
};

/**
 * The price for a product on a date: the customer's own newest price on or
 * before the date, else its chain's (the customer it's a location of, like
 * PCC; Lucas, 11/14/26), else the newest default, else null ("Price
 * needed"). A store's own price wins while it exists, even over a newer
 * chain price. public.price_on() in the database does the same.
 */
export function priceFor(
  prices: PriceRow[],
  productId: string,
  customerId: string | null,
  date: string,
  chainId: string | null = null,
): PriceRow | null {
  const newest = (rows: PriceRow[]) =>
    rows.filter((p) => p.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
  const mine = prices.filter((p) => p.product_id === productId);
  return (
    (customerId ? newest(mine.filter((p) => p.customer_id === customerId)) : null) ??
    (chainId ? newest(mine.filter((p) => p.customer_id === chainId)) : null) ??
    newest(mine.filter((p) => p.customer_id === null))
  );
}

/**
 * A charge per carcass (Mohawk) on top of the per-lb price (Lucas, 11/15/26):
 * Carcass Lamb $40 shrouded, Custom Cut Lamb $100. Looked up like a price:
 * the store's own, else its chain's, else the default. 0 means none.
 */
export type ChargeRow = PriceRow & {
  /** The invoice line: "Mohawk charge, shrouded carcass". */
  name: string;
};

/** The charge for a product on a date, or null. public.charge_on() does the same. */
export function chargeFor(
  charges: ChargeRow[],
  productId: string,
  customerId: string | null,
  date: string,
  chainId: string | null = null,
): ChargeRow | null {
  return priceFor(charges, productId, customerId, date, chainId) as ChargeRow | null;
}

/**
 * Kathy prefers prices that end in 0 (Lucas, 11/14/26): true for 7.40, 12
 * and 9.5; false for 7.45, 9.99 and 7.125. Only a warning; any price saves.
 */
export function endsInZero(price: number | string): boolean {
  return toFixedInt(price, 4) % BigInt(1000) === BigInt(0);
}

/** Where a customer's price comes from: their own, their chain's (PCC), or the default. */
export type PriceSource = "own" | "chain" | "default";

export function priceSource(row: PriceRow, customerId: string | null): PriceSource {
  return row.customer_id == null ? "default" : row.customer_id === customerId ? "own" : "chain";
}

/** A product's default prices (or one customer's), newest first. */
export function priceHistory(prices: PriceRow[], productId: string, customerId: string | null): PriceRow[] {
  return prices
    .filter((p) => p.product_id === productId && p.customer_id === customerId)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
}

/**
 * A typed price, "$9.50" or "9.5" or "1,200", as a plain decimal string
 * with at most 4 decimals; null if it isn't a price.
 */
export function parsePrice(text: string): string | null {
  const t = text.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,4})?$|^\.\d{1,4}$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  const whole = (w || "0").replace(/^0+(?=\d)/, "");
  const frac = f.replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** A decimal string or number as a fixed-point BigInt with `places` decimals (exact for what the database sends). */
export function toFixedInt(v: number | string, places: number): bigint {
  const s = typeof v === "number" ? String(v) : v.trim();
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === "" || s === "-") throw new Error(`Not a decimal: ${s}`);
  const neg = s.startsWith("-");
  const [w, f = ""] = s.replace("-", "").split(".");
  if (f.length > places) throw new Error(`More than ${places} decimals: ${s}`);
  const n = BigInt((w || "0") + f.padEnd(places, "0"));
  return neg ? -n : n;
}

/** "$9.50", "$9.125" (2 to 4 decimals, as typed), "$1,200.00". */
export function priceText(v: number | string): string {
  const n = toFixedInt(v, 4);
  const neg = n < BigInt(0);
  const a = neg ? -n : n;
  const whole = (a / BigInt(10000)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (a % BigInt(10000)).toString().padStart(4, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}$${whole}.${frac}`;
}

/** Whole cents as "$1,234.56". */
export function centsText(cents: bigint | number): string {
  const n = BigInt(cents);
  const neg = n < BigInt(0);
  const a = neg ? -n : n;
  const whole = (a / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${whole}.${(a % BigInt(100)).toString().padStart(2, "0")}`;
}

/**
 * Line total in whole cents: quantity (up to 3 decimals, pounds) x price
 * (up to 4 decimals), rounded half up to the cent, once (SPEC 15.1).
 */
export function lineTotalCents(qty: number | string, price: number | string): bigint {
  // qty has 3 places and price 4, so the product has 7; a cent is 5 places.
  const raw = toFixedInt(qty, 3) * toFixedInt(price, 4);
  const unit = BigInt(100000);
  const half = BigInt(50000);
  const neg = raw < BigInt(0);
  const a = neg ? -raw : raw;
  const cents = (a + half) / unit;
  return neg ? -cents : cents;
}
