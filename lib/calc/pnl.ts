// The weekly P&L (SPEC 16.6, Lamb cost stage 3). A P&L, not accounting:
// income from invoices and packing (and entered by hand), and expenses as
// one list of categories in three groups, each worked out by its method
// (Lucas, 11/16/26). Money is exact (BigInt cents); each category is
// rounded to the cent. Where something is missing the page says so instead of showing a
// misleading number.

import type { PriceUnit } from "../db/types";
import { addDays } from "../dates";
import { freightLine, freightRateFor, priceLines, type FreightChargeRow, type InvoiceLineRow, type InvoiceStatus, type PricedLine } from "./invoice";
import { roundToCents, type WeekPay } from "./lambCost";
import { stopsMade, type RunPay } from "./truck";
import { toFixedInt, type ChargeRow, type PriceRow } from "./prices";
import type { FreezerLine } from "./freezer";

const ZERO = BigInt(0);

/** An expense category: its group, how it's worked out, and (percent methods) its base. */
export type ExpenseCategory = {
  id: string;
  name: string;
  active: boolean;
  sort: number;
  group_name: GroupName;
  method: CategoryMethod;
  income_base: "all" | "sales";
  base_category_ids: string[];
  /** per_truck_run: which part of a run it counts. */
  truck_part?: "driver_pay" | "fuel" | "maintenance" | null;
  /** Delivery: truck (UVL's own, counts toward cost per stop) or freight. */
  delivery_kind?: "truck" | "freight" | null;
  /** Freight: the carrier, the locations covered (a chain covers its stores), gross or net weight. */
  carrier?: string;
  customer_ids?: string[];
  weight_basis?: "gross" | "net";
  note: string;
};
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
  /** Freight charged on the invoices (finalized and projected), part of the totals above. */
  freightCents: bigint;
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
  /** Freight per location or chain (Setup > Invoicing), and the week's boxes, for a draft's Freight line. */
  freight?: FreightChargeRow[];
  boxes?: { customer_id: string; weight: number | string; pallet_id?: string | null }[];
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
    const date = inv?.invoice_date ?? tuesday;
    const fl = freightLine(
      freightRateFor(input.freight ?? [], loc.id, date, loc.chainId),
      (input.boxes ?? []).filter((b) => b.customer_id === loc.id),
      inv?.id ?? loc.id,
    );
    const priced = priceLines(fl ? [...lines, fl] : lines, input.prices, loc.id, date, loc.chainId, input.charges);
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
    // Freight lines: stored on finalized invoices, worked out on packed ones.
    freightCents: rows
      .filter((r) => r.status !== "not_packed")
      .flatMap((r) => r.lines)
      .filter((l) => l.kind === "freight")
      .reduce((t, l) => t + (l.totalCents ?? ZERO), ZERO),
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

// ---------------------------------------------------------------------------
// Expenses: one list of categories (Lucas, 11/16/26). Each category has a
// group, a method and rates from dates on; expense entries add to any
// category; adjustments add to any category (line key category:<id>).
// ---------------------------------------------------------------------------

export const GROUPS = ["Cost of product", "Delivery", "Operating"] as const;
export type GroupName = (typeof GROUPS)[number];

export type CategoryMethod =
  | "entered"
  | "per_lamb"
  | "percent_income"
  | "weigh_sheets"
  | "fixed_weekly"
  | "percent_category"
  | "per_truck_run"
  | "freight_weight"
  | "freight_pallet";

export const METHOD_LABEL: Record<CategoryMethod, string> = {
  entered: "Entered",
  per_lamb: "Per lamb",
  percent_income: "Percent of income",
  weigh_sheets: "Carcass weights (producer pay)",
  fixed_weekly: "Fixed weekly",
  percent_category: "Percent of other categories",
  per_truck_run: "Per truck run",
  freight_weight: "Freight by weight",
  freight_pallet: "Freight by pallet",
};

export type RatePart = { label: string; amount: number | string; per: "week" | "year" };
export type CategoryRate = {
  id: string;
  category_id: string;
  effective_from: string;
  amount: number | string | null;
  percent: number | string | null;
  parts: RatePart[];
  /** Freight by weight, gross: lb added per box and per pallet. */
  per_box_lb?: number | string | null;
  per_pallet_lb?: number | string | null;
  note: string;
};

/** The newest rate for a category on or before the date. */
export function rateOn(rates: CategoryRate[], categoryId: string, date: string): CategoryRate | null {
  let best: CategoryRate | null = null;
  for (const r of rates) {
    if (r.category_id !== categoryId || r.effective_from > date) continue;
    if (!best || r.effective_from > best.effective_from) best = r;
  }
  return best;
}

/** A fixed weekly amount from its parts: weekly amounts + yearly amounts ÷ 52, rounded once to the cent. */
export function weeklyFromParts(parts: RatePart[]): { cents: bigint; weekly: bigint; yearly: bigint } {
  const weekly = parts.filter((p) => p.per === "week").reduce((s, p) => s + cents(p.amount), ZERO);
  const yearly = parts.filter((p) => p.per === "year").reduce((s, p) => s + cents(p.amount), ZERO);
  return { cents: weekly + divRound(yearly, BigInt(52)), weekly, yearly };
}

export type CategoryLine = {
  categoryId: string;
  name: string;
  group: GroupName;
  method: CategoryMethod;
  active: boolean;
  /** The rate used this week (per lamb, percent, parts), if the method has one. */
  rate: CategoryRate | null;
  /** From the method; null when it can't be worked out yet (why: `waiting`). Entered: 0. */
  calc: bigint | null;
  /** The base a percent is taken of (income, or the other categories). */
  base: bigint | null;
  /** Expense entries in this category this week. */
  entries: number;
  entered: bigint;
  adj: bigint;
  /** calc + entered + adj; null while calc can't be worked out. */
  total: bigint | null;
  /** Worked out from projected income. */
  projected: boolean;
  waiting: string | null;
  /** Freight: the pallets and boxes it was worked out from. */
  freight?: FreightCalc;
};

/** A box for freight: whose it is, its meat weight, its pallet. */
export type FreightBox = { customer_id: string; weight: number | string; pallet_id: string | null };
/** The week's pallets (Packing > Pallets). */
export type FreightPallet = { id: string; tag: string };
export type FreightInput = {
  boxes: FreightBox[];
  pallets: FreightPallet[];
  /** Each location's chain (customer with locations), if any. */
  chainOf: Record<string, string | null>;
};

export type FreightCalc = {
  basis: "gross" | "net";
  /** The pallets carrying covered boxes, with those boxes' count and meat weight (hundredths of a lb). */
  pallets: { id: string; tag: string; boxes: number; lb: bigint; customerIds: string[] }[];
  boxes: number;
  /** Meat weight of the covered boxes on pallets (hundredths of a lb). */
  netLb: bigint;
  /** What the rate is charged on: net, or net + lb per box + lb per pallet (hundredths of a lb). */
  lb: bigint;
  /** Covered boxes not on a pallet (not counted). */
  offPallet: number;
};

/** Does a freight category cover this location (it, or its chain)? */
export function covers(c: Pick<ExpenseCategory, "customer_ids">, customerId: string, chainOf: Record<string, string | null>): boolean {
  const ids = c.customer_ids ?? [];
  const chain = chainOf[customerId];
  return ids.includes(customerId) || (!!chain && ids.includes(chain));
}

/** The pallets and boxes a freight category covers this week, and the weight it's charged on. */
export function freightFor(c: ExpenseCategory, rate: CategoryRate | null, f: FreightInput): FreightCalc {
  const mine = f.boxes.filter((b) => covers(c, b.customer_id, f.chainOf));
  const on = mine.filter((b) => b.pallet_id);
  const byPallet = new Map<string, { boxes: number; lb: bigint; customerIds: Set<string> }>();
  for (const b of on) {
    const p = byPallet.get(b.pallet_id!) ?? { boxes: 0, lb: ZERO, customerIds: new Set<string>() };
    p.boxes += 1;
    p.lb += toFixedInt(b.weight, 2);
    p.customerIds.add(b.customer_id);
    byPallet.set(b.pallet_id!, p);
  }
  const tagOf = new Map(f.pallets.map((p) => [p.id, p.tag]));
  const pallets = [...byPallet]
    .map(([id, p]) => ({ id, tag: tagOf.get(id) || "Pallet", boxes: p.boxes, lb: p.lb, customerIds: [...p.customerIds] }))
    .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  const netLb = pallets.reduce((t, p) => t + p.lb, ZERO);
  const basis = c.weight_basis ?? "gross";
  const extra =
    basis === "gross"
      ? toFixedInt(rate?.per_box_lb ?? 0, 2) * BigInt(on.length) + toFixedInt(rate?.per_pallet_lb ?? 0, 2) * BigInt(pallets.length)
      : ZERO;
  return { basis, pallets, boxes: on.length, netLb, lb: netLb + extra, offPallet: mine.length - on.length };
}

export type GroupTotal ={ name: GroupName; lines: CategoryLine[]; total: bigint; complete: boolean };

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
  /** All income: calculated + adjustments + one-off lines + Into and Out of freezer. */
  incomeCents: bigint;
  /**
   * Into freezer (positive) and Out of freezer (negative), Kathy's rule
   * (11/20/26): product put in the freezer counts at a percent of its default
   * sale price; what comes out to fill an order is taken back at that value.
   * Missing on a week closed before then.
   */
  freezerIn?: FreezerLine & { adj: bigint; total: bigint };
  freezerOut?: FreezerLine & { adj: bigint; total: bigint };
  /** Into + Out of freezer, with their adjustments. Part of incomeCents, not of a percent-of-income base. */
  freezerCents?: bigint;
  /** Invoice income only (finalized + packed), less freight, for a percent of sales. */
  salesCents: bigint;
  hasIncome: boolean;
  /** Income entered by hand. */
  otherCents: bigint;
  /** Some of the income (so marketing, profit and per head) is projected from packing. */
  projected: boolean;
  /** Lambs on the week's carcass weights; 0 means no carcass weights (or no weights yet). */
  head: number;
  hasSheets: boolean;
  /** No processing this week (a holiday): no carcass weights is expected. */
  noProcessing: boolean;
  /** Every category shown this week, in order. */
  categories: CategoryLine[];
  groups: GroupTotal[];
  oneOffExpense: PnlAdjustment[];
  oneOffExpenseCents: bigint;
  /** Every category + one-off expenses. Null without a carcass weights sheet (unless no processing). */
  totalExpense: bigint | null;
  /** Delivery total − freight income. */
  netDelivery: bigint;
  /** Freight charged on invoices (part of income). */
  freightIncome: bigint;
  /** The week's truck runs, with pay and fuel. */
  runs: RunPay[];
  /** Truck categories (delivery_kind truck) added up. */
  truckCents: bigint;
  /** Stops made on the week's runs (regular + extra). */
  truckStops: number;
  /** Truck cost ÷ stops made; null with no stops. */
  costPerStop: bigint | null;
  /** Freight categories (delivery_kind freight) added up. */
  freightCents: bigint;
  /** Pallets carrying boxes a freight category covers. */
  freightPallets: number;
  /** Freight ÷ those pallets; null with none. */
  freightPerPallet: bigint | null;
  /** How each pallet and each packed location ships: by a freight category, on a truck run, or neither yet. */
  shipping: {
    pallets: { id: string; tag: string; customerIds: string[]; byFreight: boolean; byTruck: boolean }[];
    locations: { customerId: string; byFreight: boolean; byTruck: boolean }[];
  };
  /** Box lb shipped this week (2 decimals, as hundredths). */
  lbShipped: bigint;
  /** Net delivery ÷ lb shipped, in ten-thousandths of a dollar; null with nothing shipped. */
  deliveryPerLb: bigint | null;
  /** Null unless there's both income and a carcass weights sheet (or no processing). */
  profit: bigint | null;
  profitPerHead: bigint | null;
  /** Total expense per carcass lb, in ten-thousandths of a dollar (4 decimals); null unless both. */
  costPerCarcassLb: bigint | null;
  /** Income per carcass lb, in ten-thousandths of a dollar; null without income or a carcass weights sheet. */
  incomePerCarcassLb: bigint | null;
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

/** A category's adjustment line key. */
export const categoryKey = (id: string) => `category:${id}`;

/**
 * The week's P&L. `week` is the packing Monday: rates are the newest on or
 * before it. Income and expenses are the week's entries already (by week_id).
 */
export function weekPnl(input: {
  week: string;
  pay: WeekPay;
  income: IncomeEntry[];
  expenses: ExpenseEntry[];
  categories: ExpenseCategory[];
  rates: CategoryRate[];
  /** Income from the week's invoices and packing; none: entered income only. */
  invoices?: InvoiceIncome;
  /** The week's adjustments and one-off lines (voided ones count for nothing). */
  adjustments?: PnlAdjustment[];
  noProcessing?: boolean;
  /** Box lb shipped (the week's packed boxes). */
  lbShipped?: number | string;
  /** The week's truck runs (runPay). */
  runs?: RunPay[];
  /** The week's boxes and pallets, for freight. */
  freight?: FreightInput;
  /** Into and Out of freezer for the week (freezerIn / freezerOut in lib/calc/freezer.ts). */
  freezer?: { in: FreezerLine; out: FreezerLine };
}): WeekPnl {
  const adjustments = input.adjustments ?? [];
  const live = adjustments.filter((a) => !a.voided_at);
  const adj = (key: string) => adjustmentsTo(adjustments, key);
  const noProcessing = !!input.noProcessing;
  const freightIn: FreightInput = input.freight ?? { boxes: [], pallets: [], chainOf: {} };

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
  const freightIncome = inv?.freightCents ?? ZERO;
  const salesCents = inv ? inv.finalizedCents + inv.packedCents - freightIncome : ZERO;
  const incomeCalc = otherCents + salesCents + freightIncome;
  const incomeAdj = adj("income");
  const oneOffIncome = live.filter((a) => a.kind === "one_off" && a.side === "income");
  const oneOffIncomeCents = oneOffIncome.reduce((s, a) => s + cents(a.amount), ZERO);
  const empty: FreezerLine = { cents: ZERO, rows: [], noValue: [] };
  const fIn = input.freezer?.in ?? empty;
  const fOut = input.freezer?.out ?? empty;
  const freezerIn = { ...fIn, adj: adj("freezer_in"), total: fIn.cents + adj("freezer_in") };
  const freezerOut = { ...fOut, adj: adj("freezer_out"), total: fOut.cents + adj("freezer_out") };
  const freezerCents = freezerIn.total + freezerOut.total;
  const incomeCents = incomeCalc + incomeAdj + oneOffIncomeCents + freezerCents;
  const hasIncome =
    input.income.length > 0 ||
    (!!inv && inv.finalizedCount + inv.packedCount > 0) ||
    live.some((a) => a.side === "income") ||
    fIn.rows.length + fOut.rows.length > 0;
  const projected = !!inv?.projected;

  const head = input.pay.head;
  const hasSheets = head > 0;
  const lambsKnown = hasSheets || noProcessing;

  // Which categories show: the ones in use, and any retired one with entries or adjustments this week.
  const used = new Set([
    ...input.expenses.map((e) => e.category_id),
    ...live.filter((a) => a.kind === "adjustment" && a.line_key?.startsWith("category:")).map((a) => a.line_key!.slice(9)),
  ]);
  const shown = input.categories
    .filter((c) => c.active || used.has(c.id))
    .sort((a, b) => GROUPS.indexOf(a.group_name) - GROUPS.indexOf(b.group_name) || a.sort - b.sort || a.name.localeCompare(b.name));
  // Entries in a category that's gone from the list still count, under "Unknown category".
  const known = new Set(input.categories.map((c) => c.id));
  const orphans = [...new Set(input.expenses.map((e) => e.category_id).filter((id) => !known.has(id)))];

  const line = (c: ExpenseCategory): CategoryLine => {
    const list = input.expenses.filter((e) => e.category_id === c.id);
    const entered = list.reduce((s, e) => s + cents(e.amount), ZERO);
    // Producer pay also takes adjustments made to "Producer cost" before categories.
    const a = adj(categoryKey(c.id)) + (c.method === "weigh_sheets" ? adj("producer") : ZERO);
    const rate = c.method === "entered" || c.method === "weigh_sheets" ? null : rateOn(input.rates, c.id, input.week);
    let calc: bigint | null = ZERO;
    let base: bigint | null = null;
    let waiting: string | null = null;
    let isProjected = false;
    let freight: FreightCalc | undefined;
    switch (c.method) {
      case "weigh_sheets":
        if (hasSheets) calc = input.pay.cents;
        else if (!noProcessing) [calc, waiting] = [null, "No carcass weights for this week."];
        break;
      case "per_lamb":
        if (!lambsKnown) [calc, waiting] = [null, "No carcass weights for this week."];
        else calc = rate?.amount != null ? roundToCents(toFixedInt(rate.amount, 4) * BigInt(head), 4) : ZERO;
        break;
      case "percent_income":
        // Freezer in and out aren't sales or money in: never part of a percent of income.
        base = c.income_base === "sales" ? salesCents : incomeCents - freezerCents;
        isProjected = projected;
        if (!hasIncome) [calc, waiting] = [null, "No income yet."];
        // cents (2 decimals) × percent (4 decimals) / 100 = dollars with 8 decimals
        else calc = rate?.percent != null ? roundToCents(base * toFixedInt(rate.percent, 4), 8) : ZERO;
        break;
      case "fixed_weekly":
        calc = rate ? weeklyFromParts(rate.parts ?? []).cents : ZERO;
        break;
      case "percent_category":
        calc = ZERO; // after the others, below
        break;
      case "per_truck_run": {
        const runs = input.runs ?? [];
        if (c.truck_part === "driver_pay") {
          const noRate = runs.filter((r) => r.pay == null);
          if (noRate.length) [calc, waiting] = [null, `No pay rate for ${[...new Set(noRate.map((r) => r.driverName))].join(", ")} (P&L Setup).`];
          else calc = runs.reduce((t, r) => t + r.pay!, ZERO);
        } else if (c.truck_part === "fuel") calc = runs.reduce((t, r) => t + (r.fuel ?? ZERO), ZERO);
        else if (c.truck_part === "maintenance") {
          const n = runs.filter((r) => r.maintenance).length;
          calc = n && rate?.amount != null ? cents(rate.amount) * BigInt(n) : ZERO;
          if (n && rate == null) waiting = "No rate for this week (P&L Setup).";
        } else waiting = "Pick which part of a run it counts (P&L Setup).";
        break;
      }
      case "freight_weight":
      case "freight_pallet":
        freight = freightFor(c, rate, freightIn);
        if (rate?.amount != null)
          calc =
            c.method === "freight_pallet"
              ? cents(rate.amount) * BigInt(freight.pallets.length)
              : // lb (2 decimals) × $/lb (4 decimals) = dollars with 6 decimals
                roundToCents(freight.lb * toFixedInt(rate.amount, 4), 6);
        break;
      case "entered":
        break;
    }
    if (rate == null && ["per_lamb", "percent_income", "fixed_weekly", "percent_category", "freight_weight", "freight_pallet"].includes(c.method) && waiting == null)
      waiting = "No rate for this week (P&L Setup).";
    return {
      categoryId: c.id,
      name: c.name,
      group: c.group_name,
      method: c.method,
      active: c.active,
      rate,
      calc,
      base,
      entries: list.length,
      entered,
      adj: a,
      total: calc == null ? null : calc + entered + a,
      projected: isProjected,
      waiting,
      ...(freight ? { freight } : {}),
    };
  };
  const categories = shown.map(line);
  // Percent of other categories: worked out on their totals (not on another percent).
  for (const l of categories) {
    if (l.method !== "percent_category") continue;
    const c = input.categories.find((x) => x.id === l.categoryId)!;
    const of = categories.filter((x) => c.base_category_ids.includes(x.categoryId) && x.method !== "percent_category");
    if (of.some((x) => x.total == null)) {
      l.calc = null;
      l.total = null;
      l.waiting = "Waiting for the categories it's a percent of.";
      continue;
    }
    l.base = of.reduce((s, x) => s + x.total!, ZERO);
    l.projected = of.some((x) => x.projected);
    l.calc = l.rate?.percent != null ? roundToCents(l.base * toFixedInt(l.rate.percent, 4), 8) : ZERO;
    l.total = l.calc + l.entered + l.adj;
  }
  for (const id of orphans) {
    const list = input.expenses.filter((e) => e.category_id === id);
    const entered = list.reduce((s, e) => s + cents(e.amount), ZERO);
    const a = adj(categoryKey(id));
    categories.push({
      categoryId: id,
      name: "Unknown category",
      group: "Operating",
      method: "entered",
      active: false,
      rate: null,
      calc: ZERO,
      base: null,
      entries: list.length,
      entered,
      adj: a,
      total: entered + a,
      projected: false,
      waiting: null,
    });
  }

  const groups: GroupTotal[] = GROUPS.map((name) => {
    const lines = categories.filter((l) => l.group === name);
    return { name, lines, total: lines.reduce((s, l) => s + (l.total ?? ZERO), ZERO), complete: lines.every((l) => l.total != null) };
  });
  const oneOffExpense = live.filter((a) => a.kind === "one_off" && a.side === "expense");
  const oneOffExpenseCents = oneOffExpense.reduce((s, a) => s + cents(a.amount), ZERO);
  const producerKnown = categories.filter((l) => l.method === "weigh_sheets").every((l) => l.total != null);
  const totalExpense = producerKnown && lambsKnown ? groups.reduce((s, g) => s + g.total, ZERO) + oneOffExpenseCents : null;

  const netDelivery = groups.find((g) => g.name === "Delivery")!.total - freightIncome;
  const runs = input.runs ?? [];
  const truckCents = categories.filter((l) => input.categories.find((x) => x.id === l.categoryId)?.delivery_kind === "truck").reduce((t, l) => t + (l.total ?? ZERO), ZERO);
  const truckStops = runs.reduce((t, r) => t + stopsMade(r), 0);
  const kindOf = (l: CategoryLine) => input.categories.find((x) => x.id === l.categoryId)?.delivery_kind;
  const freightCents = categories.filter((l) => kindOf(l) === "freight").reduce((t, l) => t + (l.total ?? ZERO), ZERO);
  // How each pallet and location ships: covered by an active freight category, or a stop on a truck run.
  const freightCats = input.categories.filter((c) => c.active && (c.method === "freight_weight" || c.method === "freight_pallet"));
  const byFreight = (customerId: string) => freightCats.some((c) => covers(c, customerId, freightIn.chainOf));
  const onRuns = new Set(runs.flatMap((r) => r.stops.filter((s) => s.kind !== "skipped" && s.customer_id).map((s) => s.customer_id!)));
  const byTruck = (customerId: string) => onRuns.has(customerId) || (!!freightIn.chainOf[customerId] && onRuns.has(freightIn.chainOf[customerId]!));
  const palletCustomers = new Map<string, Set<string>>();
  for (const b of freightIn.boxes) {
    if (!b.pallet_id) continue;
    const set = palletCustomers.get(b.pallet_id) ?? new Set<string>();
    set.add(b.customer_id);
    palletCustomers.set(b.pallet_id, set);
  }
  const tagOf = new Map(freightIn.pallets.map((p) => [p.id, p.tag]));
  const shipping = {
    pallets: [...palletCustomers]
      .map(([id, set]) => {
        const ids = [...set];
        return { id, tag: tagOf.get(id) || "Pallet", customerIds: ids, byFreight: ids.some(byFreight), byTruck: ids.some(byTruck) };
      })
      .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true })),
    locations: [...new Set(freightIn.boxes.map((b) => b.customer_id))].map((customerId) => ({
      customerId,
      byFreight: byFreight(customerId),
      byTruck: byTruck(customerId),
    })),
  };
  const freightPallets = shipping.pallets.filter((p) => p.byFreight).length;
  const lbShipped = toFixedInt(input.lbShipped ?? 0, 2);
  const both = totalExpense != null && (hasIncome || noProcessing);
  const profit = both ? incomeCents - totalExpense : null;
  const carcass = input.pay.carcass; // 2 decimals
  return {
    income,
    incomeCalc,
    incomeAdj,
    oneOffIncome,
    oneOffIncomeCents,
    incomeCents,
    freezerIn,
    freezerOut,
    freezerCents,
    salesCents,
    hasIncome,
    otherCents,
    projected,
    head,
    hasSheets,
    noProcessing,
    categories,
    groups,
    oneOffExpense,
    oneOffExpenseCents,
    totalExpense,
    netDelivery,
    freightIncome,
    runs,
    truckCents,
    truckStops,
    costPerStop: truckStops > 0 ? divRound(truckCents, BigInt(truckStops)) : null,
    freightCents,
    freightPallets,
    freightPerPallet: freightPallets > 0 ? divRound(freightCents, BigInt(freightPallets)) : null,
    shipping,
    lbShipped,
    // cents / lb (2 decimals) = $/lb; × 10^4 keeps 4 decimals
    deliveryPerLb: lbShipped > ZERO ? divRound(netDelivery * BigInt(10000), lbShipped) : null,
    profit,
    profitPerHead: profit != null && head > 0 ? divRound(profit, BigInt(head)) : null,
    // total cents / carcass (2 decimals) = $/lb; x 10^4 keeps 4 decimals
    costPerCarcassLb: both && carcass > ZERO ? divRound(totalExpense * BigInt(10000), carcass) : null,
    // income cents / carcass (2 decimals) = $/lb; × 10^4 keeps 4 decimals
    incomePerCarcassLb: hasIncome && carcass > ZERO ? divRound(incomeCents * BigInt(10000), carcass) : null,
    adjustments,
  };
}
