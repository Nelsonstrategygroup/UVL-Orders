// "How this was calculated" for every line of the Weekly P&L, and the checks
// on what's missing before a week can be trusted (Lucas, 11/15/26). The
// owners are also paid as producers, so every number shows its formula with
// the real numbers, the rate and the date it applies from, and links to the
// records it came from. Pure: the screen and the printed report both use it.

import { quantityText, type PricedLine } from "./invoice";
import {
  carcassText,
  centsText,
  factorText,
  fixedRounded,
  liveText,
  moneyText,
  producerRateFor,
  rateText,
  REASON_LABEL,
  settingFor,
  type LambCostSetting,
  type ProducerRate,
  type SheetPay,
  type WeekPay,
} from "./lambCost";
import {
  cents,
  chargesOn,
  type ExpenseCategory,
  type ExpenseEntry,
  type IncomeEntry,
  type InvoiceIncome,
  type LambCharge,
  type PercentCharge,
  type PnlAdjustment,
  type WeekPnl,
} from "./pnl";
import { priceFor, priceSource, priceText, PRICE_UNIT_SHORT, type ChargeRow, type PriceRow } from "./prices";
import { longDate, niceDate } from "../dates";

/** One record under a line: a location, a weigh sheet, an entry, an invoice line. */
export type DetailItem = {
  label: string;
  /** Finalized, Packed, Price needed ... */
  tag?: string;
  /** The formula with its numbers, one step per line. */
  math?: string[];
  amount?: string;
  links?: { label: string; href: string }[];
  /** Attached files (in the private pnl-files bucket). */
  files?: { path: string; name: string }[];
  note?: string;
  /** A voided adjustment: shown, counts for nothing. */
  voided?: boolean;
  items?: DetailItem[];
};

export type LineDetail = {
  key: string;
  title: string;
  /** The line's amount, or null when it isn't worked out (with why in `how`). */
  amount: string | null;
  projected: boolean;
  /** The line an adjustment to it is made against (income, producer, charge:<name>); "category" for expenses. */
  lineKey?: string;
  /** How the line is worked out, in plain words, then the sum with its numbers. */
  how: string[];
  items: DetailItem[];
};

const day = (d: string) => `${longDate(d)}, ${d.slice(0, 4)}`;
const short = (d: string) => `${niceDate(d)}, ${d.slice(0, 4)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "Nov 15, 2:10 pm" in Oregon time. */
export function stamp(ts: string | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export type DetailInput = {
  week: string;
  p: WeekPnl;
  ii: InvoiceIncome;
  pays: SheetPay[];
  pay: WeekPay;
  settings: LambCostSetting[];
  rates: ProducerRate[];
  lambCharges: LambCharge[];
  percentCharges: PercentCharge[];
  income: IncomeEntry[];
  expenses: ExpenseEntry[];
  categories: ExpenseCategory[];
  prices: PriceRow[];
  charges: ChargeRow[];
  /** The week's boxes by location and product (packing records). */
  boxes: { customer_id: string; product_id: string; weight: number | string }[];
  producerName: (id: string) => string;
  /** The product a box is billed under (products packed together bill as the first). */
  lead: (productId: string) => string;
  userName: (id: string | null | undefined) => string;
  /** Files attached to expense entries. */
  expenseFiles?: { expense_id: string; path: string; name: string }[];
};

/** "+$25.00", "-$50.00" */
const signed = (c: bigint) => (c < BigInt(0) ? `-${centsText(-c)}` : `+${centsText(c)}`);

/** Adjustments (and one-off lines) as detail items: amount, reason, who and when, voided or not. */
function adjustmentItems(list: PnlAdjustment[]): DetailItem[] {
  return list.map((a) => ({
    label: a.kind === "one_off" ? a.label : a.reason,
    tag: a.voided_at ? "Voided" : a.kind === "one_off" ? (a.side === "income" ? "One-off income" : "One-off expense") : "Adjustment",
    amount: a.kind === "one_off" ? centsText(cents(a.amount)) : signed(cents(a.amount)),
    voided: !!a.voided_at,
    math: a.kind === "one_off" ? [`Reason: ${a.reason}`] : undefined,
    note: [
      `Added by ${a.created_by_name || "someone"}, ${stamp(a.created_at)}`,
      a.voided_at ? `Voided by ${a.voided_by_name || "someone"}, ${stamp(a.voided_at)}: ${a.void_reason}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    files: a.attachment_path ? [{ path: a.attachment_path, name: a.attachment_name || "Attachment" }] : undefined,
  }));
}

/** The adjustments to one line, voided ones too. */
const adjustmentsOf = (p: WeekPnl, key: string) => p.adjustments.filter((a) => a.kind === "adjustment" && a.line_key === key);

/** "Calculated $X + adjustments $Y = $Z", when a line has adjustments. */
function withAdjustments(calc: bigint, adj: bigint, total: bigint, any: boolean): string[] {
  return any ? [`Calculated ${centsText(calc)} ${adj < BigInt(0) ? "−" : "+"} adjustments ${centsText(adj < BigInt(0) ? -adj : adj)} = ${centsText(total)}`] : [];
}

/** Where a packed line's price came from, and since when. */
function priceFrom(x: DetailInput, customerId: string, chainId: string | null, productId: string, date: string): string {
  const r = priceFor(x.prices, productId, customerId, date, chainId);
  if (!r) return "";
  const s = priceSource(r, customerId);
  return `${s === "own" ? "their own price" : s === "chain" ? "chain price" : "default price"}, from ${short(r.effective_from)}`;
}

function lineItem(x: DetailInput, l: PricedLine, loc: { customerId: string; chainId: string | null; date: string; status: string }): DetailItem {
  const unit = l.price_unit ? PRICE_UNIT_SHORT[l.price_unit] : "";
  if (l.kind === "shorted") return { label: l.description, note: "Ordered, not packed: nothing billed" };
  if (l.priceNeeded) return { label: l.description, tag: "Price needed", math: [`${quantityText(l.quantity, l.price_unit)} × no price`], note: "Left out of the total until it has a price (Setup > Prices)." };
  if (l.countNeeded) return { label: l.description, tag: "Count needed", note: "Left out of the total until it's counted on Packing." };
  const qty = l.kind === "charge" || l.kind === "manual" ? String(Number(l.quantity)) : quantityText(l.quantity, l.price_unit);
  const where =
    l.kind === "charge"
      ? "Mohawk charge per carcass"
      : l.kind === "manual"
        ? `added by hand: ${l.note}`
        : loc.status === "finalized"
          ? "price as finalized"
          : l.product_id
            ? priceFrom(x, loc.customerId, loc.chainId, l.product_id, loc.date)
            : "";
  const math = [`${qty} × ${priceText(l.price!)}${l.kind === "charge" || l.kind === "manual" ? "" : unit} = ${centsText(l.grossCents ?? BigInt(0))}${where ? ` (${where})` : ""}`];
  if (l.discountCents > BigInt(0)) math.push(`less discount ${centsText(l.discountCents)}${l.note ? `: ${l.note}` : ""} = ${centsText(l.totalCents ?? BigInt(0))}`);
  const boxes =
    loc.status === "packed" && l.kind === "packed" && l.product_id && l.price_unit === "lb"
      ? x.boxes.filter((b) => b.customer_id === loc.customerId && x.lead(b.product_id) === l.product_id).map((b) => Number(b.weight).toFixed(2))
      : [];
  return {
    label: l.description,
    math,
    amount: l.totalCents != null ? centsText(l.totalCents) : undefined,
    note: boxes.length > 1 ? `${boxes.length} boxes: ${boxes.join(" + ")} lb` : boxes.length === 1 ? `1 box: ${boxes[0]} lb` : undefined,
  };
}

function incomeDetail(x: DetailInput): LineDetail {
  const { ii, p } = x;
  const counted = ii.rows.filter((r) => r.status !== "not_packed");
  const items: DetailItem[] = counted.map((r) => ({
    label: r.name,
    tag: r.status === "finalized" ? "Finalized" : "Packed",
    amount: r.cents != null ? centsText(r.cents) : undefined,
    links: r.invoiceId ? [{ label: `Invoice ${r.number ?? ""}`.trim(), href: `/invoices/${r.invoiceId}` }] : undefined,
    math: [
      r.status === "finalized"
        ? `The finalized invoice's total, dated ${short(r.date)}.`
        : `What's packed × prices on ${short(r.date)}${r.invoiceId ? " (the draft's date)" : " (the date a new draft gets)"}.`,
      ...(r.unpackedLines ? [`${plural(r.unpackedLines, "ordered line", "ordered lines")} not packed: nothing billed for them.`] : []),
    ],
    items: r.lines.map((l) => lineItem(x, l, r)),
  }));
  for (const e of x.income) {
    items.push({
      label: e.customer_name,
      tag: "Other income",
      amount: centsText(BigInt(Math.round(Number(e.amount) * 100))),
      math: [`Entered by hand for ${day(e.entry_date)}.`],
      note: [e.note, e.created_by || e.created_at ? `Entered by ${x.userName(e.created_by)}${e.created_at ? `, ${stamp(e.created_at)}` : ""}` : ""].filter(Boolean).join(" · "),
    });
  }
  if (ii.notPacked.length) items.push({ label: "Not packed yet", tag: "No income", note: ii.notPacked.map((r) => r.name).join(", ") });
  const incomeAdj = adjustmentsOf(p, "income");
  items.push(...adjustmentItems(incomeAdj), ...adjustmentItems(p.adjustments.filter((a) => a.kind === "one_off" && a.side === "income")));
  const parts = [
    `Finalized ${centsText(ii.finalizedCents)}`,
    ...(ii.packedCount ? [`packed, not invoiced ${centsText(ii.packedCents)}`] : []),
    ...(p.otherCents ? [`other income ${centsText(p.otherCents)}`] : []),
    ...(p.incomeAdj ? [`adjustments ${signed(p.incomeAdj)}`] : []),
    ...(p.oneOffIncomeCents ? [`one-off income ${centsText(p.oneOffIncomeCents)}`] : []),
  ];
  return {
    key: "income",
    lineKey: "income",
    title: p.projected ? "Income (projected)" : "Income",
    amount: p.hasIncome ? centsText(p.incomeCents) : null,
    projected: p.projected,
    how: [
      "Finalized (or sent) invoices: the invoice total.",
      "Packed, not finalized yet: what's packed (lb: the boxes' weights; case: the boxes; each: the pieces counted) × the customer's price on the invoice date (their own, else the chain's, else the default), each line rounded to the cent, plus the Mohawk charge per carcass.",
      "Other income: entered by hand on this page. Adjustments and one-off income: added on this page, each with a reason.",
      p.hasIncome ? `${parts.join(" + ")} = ${centsText(p.incomeCents)}` : "No income yet: nothing is packed.",
    ],
    items,
  };
}

/** Where a sheet's rate and factor came from. */
function rateOrigin(x: DetailInput, s: SheetPay["sheet"]): string {
  const rate = rateText(s.base_rate);
  const factor = factorText(s.live_factor);
  const set = settingFor(x.settings, s.kill_date);
  const own = s.rate_source === "producer" ? producerRateFor(x.rates, s.producer_id, s.kill_date) : null;
  const from = own ? `${x.producerName(s.producer_id)}'s own rate in Setup from ${short(own.effective_from)}` : set ? `Setup from ${short(set.effective_from)}` : "";
  const matches =
    (own ? Number(own.rate) === Number(s.base_rate) : set ? Number(set.base_rate) === Number(s.base_rate) : false) &&
    !!set &&
    Number(set.live_factor) === Number(s.live_factor);
  return matches ? `Rate ${rate} per live lb × ${factor}: ${from}.` : `Rate ${rate} per live lb × ${factor}, saved on the sheet${from ? ` (${from} says otherwise; the sheet keeps its own)` : ""}.`;
}

function producerDetail(x: DetailInput): LineDetail {
  const items: DetailItem[] = x.pays.map((sp) => {
    const s = sp.sheet;
    const adj = [
      ...sp.lambs.flatMap((l) =>
        l.adjustments.map((a) => `Lamb #${l.lamb.position}: ${REASON_LABEL[a.adj.reason]} ${a.adj.kind === "dollars" ? rateText(a.adj.amount) : `${rateText(a.adj.amount)} per live lb`} = ${moneyText(a.money)}${a.adj.note ? ` (${a.adj.note})` : ""}`),
      ),
      ...sp.sheetAdjustments.map((a) => `Whole sheet: ${REASON_LABEL[a.adj.reason]} ${a.adj.kind === "dollars" ? rateText(a.adj.amount) : `${rateText(a.adj.amount)} per live lb`} = ${moneyText(a.money)}${a.adj.note ? ` (${a.adj.note})` : ""}`),
    ];
    return {
      label: `${x.producerName(s.producer_id)} · kill ${longDate(s.kill_date)}`,
      amount: centsText(sp.cents),
      links: [{ label: "Weigh sheet and photo", href: `/weigh-sheets/${s.id}` }],
      math: [
        `${plural(sp.count, "lamb", "lambs")} · ${carcassText(sp.carcass)} carcass lb`,
        `× ${factorText(s.live_factor)} live factor = ${liveText(sp.live)} live lb`,
        `× ${rateText(s.base_rate)} per live lb = ${moneyText(sp.base)}`,
        ...(adj.length ? [...adj.map((a) => `+ ${a}`), `= ${moneyText(sp.exact)}`] : ["No adjustments."]),
        `Rounded once to the cent: ${centsText(sp.cents)}`,
        rateOrigin(x, s),
      ],
    };
  });
  const prodAdj = adjustmentsOf(x.p, "producer");
  items.push(...adjustmentItems(prodAdj));
  return {
    key: "producer",
    lineKey: "producer",
    title: "Producer cost",
    amount: x.p.hasSheets ? centsText(x.p.producerCents) : null,
    projected: false,
    how: [
      "From the weigh sheets with a kill date in this week (Thursday to Wednesday).",
      "Each lamb: carcass lb × live factor = live lb; live lb × the rate = its pay. Premiums and docks are added, then each sheet is rounded once to the cent.",
      x.p.hasSheets
        ? `${x.pays.map((sp) => centsText(sp.cents)).join(" + ")} = ${centsText(x.p.producerCalc)} (${plural(x.pay.head, "lamb", "lambs")}, ${carcassText(x.pay.carcass)} carcass lb)`
        : "No weigh sheet for this week yet.",
      ...withAdjustments(x.p.producerCalc, x.p.producerAdj, x.p.producerCents, prodAdj.length > 0),
    ],
    items,
  };
}

function chargeDetails(x: DetailInput): LineDetail[] {
  const sheets: DetailItem[] = x.pays.map((sp) => ({
    label: `${x.producerName(sp.sheet.producer_id)} · kill ${longDate(sp.sheet.kill_date)}`,
    amount: plural(sp.count, "lamb", "lambs"),
    links: [{ label: "Weigh sheet", href: `/weigh-sheets/${sp.sheet.id}` }],
  }));
  const lamb = chargesOn(x.lambCharges, x.week, (r) => r.per_lamb).map((c): LineDetail => {
    const line = x.p.charges.find((l) => l.kind === "lamb" && l.name === c.name);
    const list = adjustmentsOf(x.p, `charge:${c.name}`);
    return {
      key: `charge:${c.name}`,
      lineKey: `charge:${c.name}`,
      title: c.name,
      amount: line?.total != null ? centsText(line.total) : null,
      projected: false,
      how: [
        `Lambs on this week's weigh sheets × ${rateText(c.per_lamb)} a lamb (P&L Setup, from ${short(c.effective_from)}).`,
        line?.cents != null ? `${x.pay.head} lambs × ${rateText(c.per_lamb)} = ${centsText(line.cents)}` : "No weigh sheet for this week yet.",
        ...(line?.cents != null ? withAdjustments(line.cents, line.adj, line.total!, list.length > 0) : []),
      ],
      items: [...sheets, ...adjustmentItems(list)],
    };
  });
  const pct = chargesOn(x.percentCharges, x.week, (r) => r.percent).map((c): LineDetail => {
    const line = x.p.charges.find((l) => l.kind === "percent" && l.name === c.name);
    const list = adjustmentsOf(x.p, `charge:${c.name}`);
    return {
      key: `charge:${c.name}`,
      lineKey: `charge:${c.name}`,
      title: x.p.projected ? `${c.name} (projected)` : c.name,
      amount: line?.total != null ? centsText(line.total) : null,
      projected: x.p.projected,
      how: [
        `${factorText(c.percent)}% of the week's income (P&L Setup, from ${short(c.effective_from)}), rounded to the cent.`,
        line?.cents != null
          ? `${factorText(c.percent)}% × ${centsText(x.p.incomeCents)}${x.p.projected ? " projected" : ""} income = ${centsText(line.cents)}`
          : "No income yet.",
        ...(line?.cents != null ? withAdjustments(line.cents, line.adj, line.total!, list.length > 0) : []),
      ],
      items: [
        ...adjustmentItems(list),
        { label: "Finalized invoices", amount: centsText(x.ii.finalizedCents) },
        ...(x.ii.packedCount ? [{ label: "Packed, not invoiced (projected)", amount: centsText(x.ii.packedCents) }] : []),
        ...(x.p.otherCents ? [{ label: "Other income", amount: centsText(x.p.otherCents) }] : []),
        ...(x.p.incomeAdj ? [{ label: "Income adjustments", amount: signed(x.p.incomeAdj) }] : []),
        ...(x.p.oneOffIncomeCents ? [{ label: "One-off income", amount: centsText(x.p.oneOffIncomeCents) }] : []),
      ],
    };
  });
  return [...lamb, ...pct];
}

function expenseDetail(x: DetailInput): LineDetail {
  const items: DetailItem[] = x.p.expenses.map((cat) => {
    const list = adjustmentsOf(x.p, `category:${cat.categoryId}`);
    return {
      label: cat.name,
      amount: centsText(cat.total),
      math: list.length ? withAdjustments(cat.cents, cat.adj, cat.total, true) : undefined,
      items: [
        ...x.expenses
          .filter((e) => e.category_id === cat.categoryId)
          .map((e) => {
            const files = (x.expenseFiles ?? []).filter((f) => f.expense_id === e.id);
            return {
              label: day(e.entry_date),
              amount: centsText(cents(e.amount)),
              note: [e.note, `Entered by ${x.userName(e.created_by)}${e.created_at ? `, ${stamp(e.created_at)}` : ""}`].filter(Boolean).join(" · "),
              files: files.length ? files.map((f) => ({ path: f.path, name: f.name || "Attachment" })) : undefined,
            };
          }),
        ...adjustmentItems(list),
      ],
    };
  });
  items.push(...adjustmentItems(x.p.adjustments.filter((a) => a.kind === "one_off" && a.side === "expense")));
  return {
    key: "expenses",
    lineKey: "category",
    title: "Entered expenses",
    amount: centsText(x.p.expenseCents),
    projected: false,
    how: [
      "Expenses entered on this page, by category, dated in this week, with their adjustments; then one-off expense lines.",
      x.p.expenses.length || x.p.oneOffExpense.length
        ? `${[...x.p.expenses.map((c) => centsText(c.total)), ...(x.p.oneOffExpenseCents ? [`one-off ${centsText(x.p.oneOffExpenseCents)}`] : [])].join(" + ")} = ${centsText(x.p.expenseCents)}`
        : "None entered yet.",
    ],
    items,
  };
}

function resultDetails(x: DetailInput): LineDetail[] {
  const { p } = x;
  const pj = (t: string) => (p.projected ? `${t} (projected)` : t);
  const waits = [!p.hasSheets && "no weigh sheet", !p.hasIncome && "no income"].filter(Boolean).join(" and ");
  return [
    {
      key: "total",
      title: p.projected && p.charges.some((c) => c.kind === "percent") ? "Total expense (projected)" : "Total expense",
      amount: p.totalExpense != null ? centsText(p.totalExpense) : null,
      projected: p.projected,
      how: [
        "Producer cost + charges + entered expenses.",
        p.totalExpense != null
          ? `${centsText(p.producerCents)} + ${centsText(p.chargeCents)} + ${centsText(p.expenseCents)} = ${centsText(p.totalExpense)}`
          : "Not worked out: no weigh sheet for this week.",
      ],
      items: [],
    },
    {
      key: "profit",
      title: pj("Profit"),
      amount: p.profit != null ? centsText(p.profit) : null,
      projected: p.projected,
      how: ["Income − total expense.", p.profit != null ? `${centsText(p.incomeCents)} − ${centsText(p.totalExpense!)} = ${centsText(p.profit)}` : `Not worked out: ${waits}.`],
      items: [],
    },
    {
      key: "perhead",
      title: pj("Profit per head"),
      amount: p.profitPerHead != null ? centsText(p.profitPerHead) : null,
      projected: p.projected,
      how: [
        "Profit ÷ lambs on this week's weigh sheets, rounded to the cent.",
        p.profitPerHead != null ? `${centsText(p.profit!)} ÷ ${p.head} lambs = ${centsText(p.profitPerHead)}` : `Not worked out: ${waits}.`,
      ],
      items: [],
    },
    {
      key: "costlb",
      title: pj("Cost per carcass lb"),
      amount: p.costPerCarcassLb != null ? `$${fixedRounded(p.costPerCarcassLb, 4, 2)}` : null,
      projected: p.projected,
      how: [
        "Total expense ÷ carcass lb on this week's weigh sheets.",
        p.costPerCarcassLb != null
          ? `${centsText(p.totalExpense!)} ÷ ${carcassText(x.pay.carcass)} lb = $${fixedRounded(p.costPerCarcassLb, 4, 4)} a lb`
          : `Not worked out: ${waits}.`,
      ],
      items: [],
    },
  ];
}

/** Every line's detail, in the order the P&L shows them. */
export function pnlDetails(x: DetailInput): LineDetail[] {
  return [incomeDetail(x), producerDetail(x), ...chargeDetails(x), expenseDetail(x), ...resultDetails(x)];
}

// ---------------------------------------------------------------------------
// What's missing before the week can be trusted.
// ---------------------------------------------------------------------------

export type PnlCheck = { key: string; text: string };

export function pnlChecks(x: {
  p: WeekPnl;
  ii: InvoiceIncome;
  /** This week's lamb count (This week), or null when unknown. */
  lambCount: number | null;
  categories: ExpenseCategory[];
  expenses: ExpenseEntry[];
}): PnlCheck[] {
  const out: PnlCheck[] = [];
  const { p, ii } = x;
  if (ii.packedCount) out.push({ key: "invoices", text: `${plural(ii.packedCount, "invoice", "invoices")} not finalized.` });
  if (ii.notPacked.length) out.push({ key: "notpacked", text: `${plural(ii.notPacked.length, "location", "locations")} with orders not packed: ${ii.notPacked.map((r) => r.name).join(", ")}.` });
  for (const n of ii.priceNeeded) out.push({ key: `price:${n.product}`, text: `${n.product} is packed but has no price (${n.locations.join(", ")}).` });
  if (!p.hasSheets) out.push({ key: "sheet", text: "No weigh sheet entered for this week's kill." });
  if (p.hasSheets && x.lambCount != null && p.head !== x.lambCount)
    out.push({ key: "lambs", text: `The weigh sheets have ${p.head} lambs; This week's lamb count is ${x.lambCount}.` });
  const butcher = x.categories.filter((c) => /mohawk|butcher/i.test(c.name)).map((c) => c.id);
  if (butcher.length && !x.expenses.some((e) => butcher.includes(e.category_id)))
    out.push({ key: "butcher", text: "No Butcher (Mohawk) cost entered." });
  return out;
}
