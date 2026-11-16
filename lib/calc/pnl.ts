// The weekly P&L (SPEC 16.6, Lamb cost stage 3). A P&L, not accounting:
// income and expenses entered for the week, producer cost from the weigh
// sheets, and charges worked out from the week (per lamb, percent of
// income). Money is exact (BigInt cents); each charge is rounded to the
// cent. Where something is missing the page says so instead of showing a
// misleading number.

import type { PriceUnit } from "../db/types";
import { addDays } from "../dates";
import { priceLines, type InvoiceLineRow, type InvoiceStatus, type PricedLine } from "./invoice";
import { roundToCents, type WeekPay } from "./lambCost";
import { toFixedInt, type ChargeRow, type PriceRow } from "./prices";

const ZERO = BigInt(0);

/** A charge from a date on: per lamb (ALB/OSC) or percent of income (Marketing). */
export type LambCharge = { id: string; name: string; effective_from: string; per_lamb: string | number; note: string };
export type PercentCharge = { id: string; name: string; effective_from: string; percent: string | number; note: string };
export type ExpenseCategory = { id: string; name: string; active: boolean; sort: number };
export type ExpenseEntry = {
  id: string;
  entry_date: string;
  week_id: string;
  category_id: string;
  amount: string | number;
  note: string;
  /** Who entered it, and when (for the P&L detail). */
  created_by?: string | null;
  created_at?: string;
};
export type IncomeEntry = {
  id: string;
  entry_date: string;
  week_id: string;
  customer_id: string | null;
  customer_name: string;
  amount: string | number;
  note: string;
  created_by?: string | null;
  created_at?: string;
};

/** Each charge name's newest row on or before the date (the week's packing Monday). Charges set to 0 drop out. */
export function chargesOn<T extends { name: string; effective_from: string }>(rows: T[], date: string, amount: (r: T) => string | number): T[] {
  const newest = new Map<string, T>();
  for (const r of rows) {
    if (r.effective_from > date) continue;
    const cur = newest.get(r.name);
    if (!cur || r.effective_from > cur.effective_from) newest.set(r.name, r);
  }
  return [...newest.values()].filter((r) => Number(amount(r)) !== 0).sort((a, b) => a.name.localeCompare(b.name));
}

/** A money amount as whole cents. */
export const cents = (v: string | number) => toFixedInt(v, 2);

/**
 * A typed amount, "$1,250.00", "980.5" or "-25" (a refund or credit), as a
 * decimal string with at most 2 decimals; null if it isn't money or is 0.
 */
export function parseMoney(text: string): string | null {
  const t = text.trim().replace(/^(-?)\s*\$/, "$1").replace(/,/g, "");
  if (!/^-?(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(t)) return null;
  if (Number(t) === 0) return null;
  const neg = t.startsWith("-");
  const [w, f = ""] = t.replace("-", "").split(".");
  const whole = (w || "0").replace(/^0+(?=\d)/, "");
  const frac = f.replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

// ---------------------------------------------------------------------------
// Income from invoices (Lucas, 11/15/26). A finalized (or sent) invoice is real
// income. Before that, what's packed is priced the way the invoice will be
// (the customer's own price, the chain's, the default; Mohawk charges too),
// as projected income. Worked out each time; never stored, never mixed into
// the finalized figure. Lines added by hand and discounts count once finalized.
// ---------------------------------------------------------------------------

/** A line from public.invoice_lines_from_packing() for one location: what's packed (or ordered and not packed). */
export type PackedLine = {
  customer_id: string;
  kind: "packed" | "shorted";
  product_id: string | null;
  description: string;
  ordered_qty: number | string | null;
  ordered_unit: string | null;
  boxes: number;
  quantity: number | string | null;
  price_unit: PriceUnit | null;
  not_on_order: boolean;
  sort: number;
  detail: string | null;
};

/** The week's live invoice for a location (not void). Lines, when loaded, for the P&L detail. */
export type WeekInvoice = {
  id?: string;
  number?: string | null;
  customer_id: string;
  status: InvoiceStatus;
  total: number | string | null;
  invoice_date: string;
  invoice_lines?: InvoiceLineRow[];
};

export type IncomeStatus = "finalized" | "packed" | "not_packed";

export type LocationIncome = {
  customerId: string;
  name: string;
  status: IncomeStatus;
  /** The invoice total (finalized), or what's packed and priced (packed); null when not packed. */
  cents: bigint | null;
  /** Ordered lines with nothing packed. */
  unpackedLines: number;
  /** Packed products with no price for this customer (left out of cents). */
  priceNeeded: string[];
  /** The invoice, if there is one (a draft too). */
  invoiceId: string | null;
  number: string | null;
  /** The invoice date, or the date a new draft would get: prices are looked up on it. */
  date: string;
  chainId: string | null;
  /** Finalized: the lines as finalized. Packed: what's packed, priced (Mohawk charge lines included). */
  lines: PricedLine[];
};

export type InvoiceIncome = {
  rows: LocationIncome[];
  finalizedCents: bigint;
  packedCents: bigint;
  /** Some income is projected: a location is packed but its invoice isn't finalized. */
  projected: boolean;
  finalizedCount: number;
  packedCount: number;
  notPacked: LocationIncome[];
  /** Every packed product with no price, and where. */
  priceNeeded: { product: string; locations: string[] }[];
};

export function invoiceIncome(input: {
  week: string;
  /** Every location with an order this week, or an invoice. chainId: the chain it's a store of (PCC). */
  locations: { id: string; name: string; chainId: string | null }[];
  invoices: WeekInvoice[];
  packed: PackedLine[];
  prices: PriceRow[];
  charges: ChargeRow[];
  productName: (id: string) => string;
}): InvoiceIncome {
  const tuesday = addDays(input.week, 1); // a new draft's invoice date
  const rows: LocationIncome[] = input.locations.map((loc) => {
    const inv = input.invoices.find((i) => i.customer_id === loc.id && i.status !== "void");
    const base = { invoiceId: inv?.id ?? null, number: inv?.number ?? null, date: inv?.invoice_date ?? tuesday, chainId: loc.chainId };
    if (inv && (inv.status === "finalized" || inv.status === "sent")) {
      const lines = inv.invoice_lines ? priceLines(inv.invoice_lines, [], loc.id, inv.invoice_date) : [];
      return { customerId: loc.id, name: loc.name, status: "finalized", cents: cents(inv.total ?? 0), unpackedLines: 0, priceNeeded: [], ...base, lines };
    }
    const mine = input.packed.filter((l) => l.customer_id === loc.id);
    const unpackedLines = mine.filter((l) => l.kind === "shorted").length;
    const packed = mine.filter((l) => l.kind === "packed");
    if (!packed.length) return { customerId: loc.id, name: loc.name, status: "not_packed", cents: null, unpackedLines, priceNeeded: [], ...base, lines: [] };
    const lines: InvoiceLineRow[] = packed.map((l, i) => ({
      id: `${loc.id}:${i}`,
      invoice_id: "",
      kind: "packed",
      product_id: l.product_id,
      description: l.description,
      ordered_qty: l.ordered_qty,
      ordered_unit: l.ordered_unit ?? "",
      boxes: l.boxes,
      quantity: l.quantity,
      price_unit: l.price_unit,
      unit_price: null,
      discount_kind: null,
      discount: null,
      not_on_order: l.not_on_order,
      note: "",
      sort: l.sort,
      detail: l.detail ?? "",
    }));
    const priced = priceLines(lines, input.prices, loc.id, inv?.invoice_date ?? tuesday, loc.chainId, input.charges);
    const sum = priced.reduce((s, l) => s + (l.totalCents ?? ZERO), ZERO);
    const missing = [...new Set(priced.filter((l) => l.priceNeeded && l.product_id).map((l) => input.productName(l.product_id!)))];
    return { customerId: loc.id, name: loc.name, status: "packed", cents: sum, unpackedLines, priceNeeded: missing, ...base, lines: priced };
  });
  const sum = (s: IncomeStatus) => rows.filter((r) => r.status === s).reduce((t, r) => t + (r.cents ?? ZERO), ZERO);
  const needed = new Map<string, string[]>();
  for (const r of rows) for (const p of r.priceNeeded) needed.set(p, [...(needed.get(p) ?? []), r.name]);
  const packedCount = rows.filter((r) => r.status === "packed").length;
  return {
    rows,
    finalizedCents: sum("finalized"),
    packedCents: sum("packed"),
    projected: packedCount > 0,
    finalizedCount: rows.filter((r) => r.status === "finalized").length,
    packedCount,
    notPacked: rows.filter((r) => r.status === "not_packed"),
    priceNeeded: [...needed.entries()].map(([product, locations]) => ({ product, locations })).sort((a, b) => a.product.localeCompare(b.product)),
  };
}

// ---------------------------------------------------------------------------
// Adjustments and one-off lines (P&L stage B, Lucas 11/15/26). A calculated
// number is never changed: an adjustment is its own line with a reason, and
// the line shows calculated + adjustments = total. Voided ones are kept (and
// shown in the detail) but count for nothing.
// ---------------------------------------------------------------------------

export type PnlAdjustment = {
  id: string;
  week_id: string;
  kind: "adjustment" | "one_off";
  /** income, producer, charge:<name>, category:<id>; null for a one-off line. */
  line_key: string | null;
  side: "income" | "expense";
  /** A one-off line's name. */
  label: string;
  amount: string | number;
  reason: string;
  attachment_path: string | null;
  attachment_name: string;
  created_by_name: string;
  created_at: string;
  voided_at: string | null;
  voided_by_name: string;
  void_reason: string;
};

export type ChargeLine = (
  | { kind: "lamb"; name: string; rate: string; lambs: number }
  | { kind: "percent"; name: string; percent: string; income: bigint }
) & {
  /** Calculated; null when it can't be (no weigh sheet, no income). */
  cents: bigint | null;
  /** Adjustments to this charge. */
  adj: bigint;
  /** Calculated + adjustments; null while it can't be calculated. */
  total: bigint | null;
};

export type ExpenseRow = { categoryId: string; name: string; entries: number; cents: bigint; adj: bigint; total: bigint };

export type WeekPnl = {
  /** Income entered by hand (Other income), by customer. */
  income: { key: string; name: string; entries: number; cents: bigint }[];
  /** Other income + finalized invoices + what's packed and not finalized yet. */
  incomeCalc: bigint;
  /** Adjustments to income. */
  incomeAdj: bigint;
  /** One-off income lines. */
  oneOffIncome: PnlAdjustment[];
  oneOffIncomeCents: bigint;
  /** All income: calculated + adjustments + one-off lines. */
  incomeCents: bigint;
  hasIncome: boolean;
  /** Income entered by hand. */
  otherCents: bigint;
  /** Some of the income (so marketing, profit and per head) is projected from packing. */
  projected: boolean;
  /** Lambs on the week's weigh sheets; 0 means no weigh sheet (or no weights yet). */
  head: number;
  hasSheets: boolean;
  /** From the weigh sheets. */
  producerCalc: bigint;
  producerAdj: bigint;
  /** Calculated + adjustments. */
  producerCents: bigint;
  charges: ChargeLine[];
  chargeCents: bigint;
  expenses: ExpenseRow[];
  oneOffExpense: PnlAdjustment[];
  oneOffExpenseCents: bigint;
  /** Entered expenses and their adjustments, plus one-off expense lines. */
  expenseCents: bigint;
  /** Producer cost + charges + entered expenses. Null without a weigh sheet. */
  totalExpense: bigint | null;
  /** Null unless there's both income and a weigh sheet. */
  profit: bigint | null;
  profitPerHead: bigint | null;
  /** Total expense per carcass lb, in ten-thousandths of a dollar (4 decimals); null unless both. */
  costPerCarcassLb: bigint | null;
  /** Every adjustment and one-off line of the week, voided ones too (for the detail). */
  adjustments: PnlAdjustment[];
};

/** Divide two whole numbers, rounding half up (away from zero). */
function divRound(a: bigint, b: bigint): bigint {
  const neg = a < ZERO !== b < ZERO;
  const x = a < ZERO ? -a : a;
  const y = b < ZERO ? -b : b;
  const q = (x * BigInt(2) + y) / (y * BigInt(2));
  return neg ? -q : q;
}

/** The adjustments (not voided) to one line, in cents. */
export function adjustmentsTo(adjustments: PnlAdjustment[], lineKey: string): bigint {
  return adjustments
    .filter((a) => a.kind === "adjustment" && a.line_key === lineKey && !a.voided_at)
    .reduce((s, a) => s + cents(a.amount), ZERO);
}

/**
 * The week's P&L. `week` is the packing Monday, used to pick which charge
 * rates apply. Income and expenses are the week's entries already (by week_id).
 */
export function weekPnl(input: {
  week: string;
  pay: WeekPay;
  income: IncomeEntry[];
  expenses: ExpenseEntry[];
  categories: ExpenseCategory[];
  lambCharges: LambCharge[];
  percentCharges: PercentCharge[];
  /** Income from the week's invoices and packing; none: entered income only. */
  invoices?: InvoiceIncome;
  /** The week's adjustments and one-off lines (voided ones count for nothing). */
  adjustments?: PnlAdjustment[];
}): WeekPnl {
  const adjustments = input.adjustments ?? [];
  const live = adjustments.filter((a) => !a.voided_at);
  const adj = (key: string) => adjustmentsTo(adjustments, key);

  // Income by customer (the id when there is one, else the name).
  const byCustomer = new Map<string, { key: string; name: string; entries: number; cents: bigint }>();
  for (const e of input.income) {
    const key = e.customer_id ?? `name:${e.customer_name}`;
    const row = byCustomer.get(key) ?? { key, name: e.customer_name, entries: 0, cents: ZERO };
    row.entries += 1;
    row.cents += cents(e.amount);
    byCustomer.set(key, row);
  }
  const income = [...byCustomer.values()].sort((a, b) => a.name.localeCompare(b.name));
  const otherCents = income.reduce((s, r) => s + r.cents, ZERO);
  const inv = input.invoices;
  const incomeCalc = otherCents + (inv ? inv.finalizedCents + inv.packedCents : ZERO);
  const incomeAdj = adj("income");
  const oneOffIncome = live.filter((a) => a.kind === "one_off" && a.side === "income");
  const oneOffIncomeCents = oneOffIncome.reduce((s, a) => s + cents(a.amount), ZERO);
  const incomeCents = incomeCalc + incomeAdj + oneOffIncomeCents;
  const hasIncome =
    input.income.length > 0 ||
    (!!inv && inv.finalizedCount + inv.packedCount > 0) ||
    live.some((a) => a.side === "income");

  const head = input.pay.head;
  const hasSheets = head > 0;
  const producerCalc = input.pay.cents;
  const producerAdj = adj("producer");
  const producerCents = producerCalc + producerAdj;

  const withAdj = <T extends { name: string; cents: bigint | null }>(c: T) => {
    const a = adj(`charge:${c.name}`);
    return { ...c, adj: a, total: c.cents == null ? null : c.cents + a };
  };
  const charges: ChargeLine[] = [
    ...chargesOn(input.lambCharges, input.week, (r) => r.per_lamb).map((c): ChargeLine => {
      const rate = String(c.per_lamb);
      return withAdj({ kind: "lamb" as const, name: c.name, rate, lambs: head, cents: hasSheets ? roundToCents(toFixedInt(rate, 4) * BigInt(head), 4) : null });
    }),
    ...chargesOn(input.percentCharges, input.week, (r) => r.percent).map((c): ChargeLine => {
      const percent = String(c.percent);
      // cents (2 decimals) x percent (4 decimals) / 100 = dollars with 8 decimals
      return withAdj({
        kind: "percent" as const,
        name: c.name,
        percent,
        income: incomeCents,
        cents: hasIncome ? roundToCents(incomeCents * toFixedInt(percent, 4), 8) : null,
      });
    }),
  ];
  const chargeCents = charges.reduce((s, c) => s + (c.total ?? ZERO), ZERO);

  const catName = new Map(input.categories.map((c) => [c.id, c]));
  const byCat = new Map<string, ExpenseRow>();
  const row = (id: string) =>
    byCat.get(id) ?? { categoryId: id, name: catName.get(id)?.name ?? "Unknown category", entries: 0, cents: ZERO, adj: ZERO, total: ZERO };
  for (const e of input.expenses) {
    const r = row(e.category_id);
    r.entries += 1;
    r.cents += cents(e.amount);
    byCat.set(e.category_id, r);
  }
  // A category can be adjusted with no entries yet.
  for (const a of live) {
    if (a.kind === "adjustment" && a.line_key?.startsWith("category:")) byCat.set(a.line_key.slice(9), row(a.line_key.slice(9)));
  }
  for (const r of byCat.values()) {
    r.adj = adj(`category:${r.categoryId}`);
    r.total = r.cents + r.adj;
  }
  const order = (id: string) => catName.get(id)?.sort ?? 999;
  const expenses = [...byCat.values()].sort((a, b) => order(a.categoryId) - order(b.categoryId) || a.name.localeCompare(b.name));
  const oneOffExpense = live.filter((a) => a.kind === "one_off" && a.side === "expense");
  const oneOffExpenseCents = oneOffExpense.reduce((s, a) => s + cents(a.amount), ZERO);
  const expenseCents = expenses.reduce((s, r) => s + r.total, ZERO) + oneOffExpenseCents;

  const totalExpense = hasSheets ? producerCents + chargeCents + expenseCents : null;
  const both = hasSheets && hasIncome && totalExpense != null;
  const profit = both ? incomeCents - totalExpense : null;
  const carcass = input.pay.carcass; // 2 decimals
  return {
    income,
    incomeCalc,
    incomeAdj,
    oneOffIncome,
    oneOffIncomeCents,
    incomeCents,
    hasIncome,
    otherCents,
    projected: !!inv?.projected,
    head,
    hasSheets,
    producerCalc,
    producerAdj,
    producerCents,
    charges,
    chargeCents,
    expenses,
    oneOffExpense,
    oneOffExpenseCents,
    expenseCents,
    totalExpense,
    profit,
    profitPerHead: profit != null ? divRound(profit, BigInt(head)) : null,
    // total cents / carcass (2 decimals) = $/lb; x 10^4 keeps 4 decimals
    costPerCarcassLb: both && carcass > ZERO ? divRound(totalExpense * BigInt(10000), carcass) : null,
    adjustments,
  };
}
