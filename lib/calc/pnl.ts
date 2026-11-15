// The weekly P&L (SPEC 16.6, Lamb cost stage 3). A P&L, not accounting:
// income and expenses entered for the week, producer cost from the weigh
// sheets, and charges worked out from the week (per lamb, percent of
// income). Money is exact (BigInt cents); each charge is rounded to the
// cent. Where something is missing the page says so instead of showing a
// misleading number.

import { roundToCents, type WeekPay } from "./lambCost";
import { toFixedInt } from "./prices";

const ZERO = BigInt(0);

/** A charge from a date on: per lamb (ALB/OSC) or percent of income (Marketing). */
export type LambCharge = { id: string; name: string; effective_from: string; per_lamb: string | number; note: string };
export type PercentCharge = { id: string; name: string; effective_from: string; percent: string | number; note: string };
export type ExpenseCategory = { id: string; name: string; active: boolean; sort: number };
export type ExpenseEntry = { id: string; entry_date: string; week_id: string; category_id: string; amount: string | number; note: string };
export type IncomeEntry = {
  id: string;
  entry_date: string;
  week_id: string;
  customer_id: string | null;
  customer_name: string;
  amount: string | number;
  note: string;
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

export type ChargeLine =
  | { kind: "lamb"; name: string; rate: string; lambs: number; cents: bigint | null }
  | { kind: "percent"; name: string; percent: string; income: bigint; cents: bigint | null };

export type WeekPnl = {
  income: { key: string; name: string; entries: number; cents: bigint }[];
  incomeCents: bigint;
  hasIncome: boolean;
  /** Lambs on the week's weigh sheets; 0 means no weigh sheet (or no weights yet). */
  head: number;
  hasSheets: boolean;
  producerCents: bigint;
  charges: ChargeLine[];
  chargeCents: bigint;
  expenses: { categoryId: string; name: string; entries: number; cents: bigint }[];
  expenseCents: bigint;
  /** Producer cost + charges + entered expenses. Null without a weigh sheet. */
  totalExpense: bigint | null;
  /** Null unless there's both income and a weigh sheet. */
  profit: bigint | null;
  profitPerHead: bigint | null;
  /** Total expense per carcass lb, in ten-thousandths of a dollar (4 decimals); null unless both. */
  costPerCarcassLb: bigint | null;
};

/** Divide two whole numbers, rounding half up (away from zero). */
function divRound(a: bigint, b: bigint): bigint {
  const neg = a < ZERO !== b < ZERO;
  const x = a < ZERO ? -a : a;
  const y = b < ZERO ? -b : b;
  const q = (x * BigInt(2) + y) / (y * BigInt(2));
  return neg ? -q : q;
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
}): WeekPnl {
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
  const incomeCents = income.reduce((s, r) => s + r.cents, ZERO);
  const hasIncome = input.income.length > 0;

  const head = input.pay.head;
  const hasSheets = head > 0;
  const producerCents = input.pay.cents;

  const charges: ChargeLine[] = [
    ...chargesOn(input.lambCharges, input.week, (r) => r.per_lamb).map((c): ChargeLine => {
      const rate = String(c.per_lamb);
      return { kind: "lamb", name: c.name, rate, lambs: head, cents: hasSheets ? roundToCents(toFixedInt(rate, 4) * BigInt(head), 4) : null };
    }),
    ...chargesOn(input.percentCharges, input.week, (r) => r.percent).map((c): ChargeLine => {
      const percent = String(c.percent);
      // cents (2 decimals) x percent (4 decimals) / 100 = dollars with 8 decimals
      return { kind: "percent", name: c.name, percent, income: incomeCents, cents: hasIncome ? roundToCents(incomeCents * toFixedInt(percent, 4), 8) : null };
    }),
  ];
  const chargeCents = charges.reduce((s, c) => s + (c.cents ?? ZERO), ZERO);

  const catName = new Map(input.categories.map((c) => [c.id, c]));
  const byCat = new Map<string, { categoryId: string; name: string; entries: number; cents: bigint }>();
  for (const e of input.expenses) {
    const row = byCat.get(e.category_id) ?? { categoryId: e.category_id, name: catName.get(e.category_id)?.name ?? "Unknown category", entries: 0, cents: ZERO };
    row.entries += 1;
    row.cents += cents(e.amount);
    byCat.set(e.category_id, row);
  }
  const order = (id: string) => catName.get(id)?.sort ?? 999;
  const expenses = [...byCat.values()].sort((a, b) => order(a.categoryId) - order(b.categoryId) || a.name.localeCompare(b.name));
  const expenseCents = expenses.reduce((s, r) => s + r.cents, ZERO);

  const totalExpense = hasSheets ? producerCents + chargeCents + expenseCents : null;
  const both = hasSheets && hasIncome && totalExpense != null;
  const profit = both ? incomeCents - totalExpense : null;
  const carcass = input.pay.carcass; // 2 decimals
  return {
    income,
    incomeCents,
    hasIncome,
    head,
    hasSheets,
    producerCents,
    charges,
    chargeCents,
    expenses,
    expenseCents,
    totalExpense,
    profit,
    profitPerHead: profit != null ? divRound(profit, BigInt(head)) : null,
    // total cents / carcass (2 decimals) = $/lb; x 10^4 keeps 4 decimals
    costPerCarcassLb: both && carcass > ZERO ? divRound(totalExpense * BigInt(10000), carcass) : null,
  };
}
