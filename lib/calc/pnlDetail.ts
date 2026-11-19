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
  killMathText,
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
  categoryKey,
  cents,
  type CategoryLine,
  type CategoryRate,
  type ExpenseCategory,
  type ExpenseEntry,
  type IncomeEntry,
  type InvoiceIncome,
  type GroupTotal,
  type PnlAdjustment,
  type WeekPnl,
} from "./pnl";
import type { RunPay } from "./truck";
import { priceFor, priceSource, priceText, PRICE_UNIT_SHORT, type ChargeRow, type PriceRow } from "./prices";
import { longDate, niceDate } from "../dates";

/** One record under a line: a location, a carcass weights sheet, an entry, an invoice line. */
export type DetailItem = {
  label: string;
  /** Finalized, Packed, Price needed ... */
  tag?: string;
  /** The formula with its numbers, one step per line. */
  math?: string[];
  amount?: string;
  links?: { label: string; href: string }[];
  /** Attached files (in the private pnl-files bucket). */
  /** bucket: where the file is (default pnl-files). */
  files?: { path: string; name: string; bucket?: string }[];
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
  income: IncomeEntry[];
  expenses: ExpenseEntry[];
  categories: ExpenseCategory[];
  prices: PriceRow[];
  charges: ChargeRow[];
  /** The week's boxes by location and product (packing records). */
  boxes: { customer_id: string; product_id: string; weight: number | string }[];
  producerName: (id: string) => string;
  /** A customer, location or chain by id (freight). */
  customerName?: (id: string) => string;
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
  const qty = l.kind === "charge" || l.kind === "manual" || (l.kind === "freight" && l.price_unit !== "lb") ? String(Number(l.quantity)) : quantityText(l.quantity, l.price_unit);
  const where =
    l.kind === "charge"
      ? "Mohawk charge per carcass"
      : l.kind === "freight"
        ? "freight, Setup > Invoicing"
      : l.kind === "manual"
        ? `added by hand: ${l.note}`
        : loc.status === "finalized"
          ? "price as finalized"
          : l.product_id
            ? priceFrom(x, loc.customerId, loc.chainId, l.product_id, loc.date)
            : "";
  const math = [`${qty} × ${priceText(l.price!)}${l.kind === "charge" || l.kind === "manual" || (l.kind === "freight" && l.price_unit !== "lb") ? "" : unit} = ${centsText(l.grossCents ?? BigInt(0))}${where ? ` (${where})` : ""}`];
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
  if (s.rate_source === "override") return `Rate ${rate} per live lb × ${factor}: an override on this kill (${s.override_reason ?? "no reason given"}).`;
  const set = settingFor(x.settings, s.kill_date);
  const own = s.rate_source === "producer" ? producerRateFor(x.rates, s.producer_id, s.kill_date) : null;
  const from = own ? `${x.producerName(s.producer_id)}'s own rate in Setup from ${short(own.effective_from)}` : set ? `Setup from ${short(set.effective_from)}` : "";
  const matches =
    (own ? Number(own.rate) === Number(s.base_rate) : set ? Number(set.base_rate) === Number(s.base_rate) : false) &&
    !!set &&
    Number(set.live_factor) === Number(s.live_factor);
  return matches ? `Rate ${rate} per live lb × ${factor}: ${from}.` : `Rate ${rate} per live lb × ${factor}, saved on the sheet${from ? ` (${from} says otherwise; the sheet keeps its own)` : ""}.`;
}

/** Each carcass weights sheet with its pay worked out. */
function sheetItems(x: DetailInput): DetailItem[] {
  return x.pays.map((sp) => {
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
      links: [{ label: "Carcass weights and photo", href: `/carcass-weights/${s.id}` }],
      math: [
        killMathText(sp, { settings: x.settings, rates: x.rates }),
        `${plural(sp.count, "lamb", "lambs")} · ${carcassText(sp.carcass)} carcass lb`,
        `× ${factorText(s.live_factor)} live factor = ${liveText(sp.live)} live lb`,
        `× ${rateText(s.base_rate)} per live lb = ${moneyText(sp.base)}`,
        ...(adj.length ? [...adj.map((a) => `+ ${a}`), `= ${moneyText(sp.exact)}`] : ["No adjustments."]),
        `Rounded once to the cent: ${centsText(sp.cents)}`,
        rateOrigin(x, s),
      ],
    };
  });
}

/** The carcass weights, by lamb count (for a per-lamb category). */
function lambItems(x: DetailInput): DetailItem[] {
  return x.pays.map((sp) => ({
    label: `${x.producerName(sp.sheet.producer_id)} · kill ${longDate(sp.sheet.kill_date)}`,
    amount: plural(sp.count, "lamb", "lambs"),
    links: [{ label: "Carcass weights", href: `/carcass-weights/${sp.sheet.id}` }],
  }));
}

/** What the week's income is made of (for a percent of income). */
function incomeItems(x: DetailInput, sales: boolean): DetailItem[] {
  const { p, ii } = x;
  return [
    { label: "Finalized invoices", amount: centsText(ii.finalizedCents) },
    ...(ii.packedCount ? [{ label: "Packed, not invoiced (projected)", amount: centsText(ii.packedCents) }] : []),
    ...(!sales && p.otherCents ? [{ label: "Other income", amount: centsText(p.otherCents) }] : []),
    ...(!sales && p.incomeAdj ? [{ label: "Income adjustments", amount: signed(p.incomeAdj) }] : []),
    ...(!sales && p.oneOffIncomeCents ? [{ label: "One-off income", amount: centsText(p.oneOffIncomeCents) }] : []),
  ];
}

const from = (r: CategoryRate | null) => (r ? ` (P&L Setup, from ${short(r.effective_from)})` : "");

/** One category: its formula with the real numbers, its rate and date, and its records. */
function categoryDetail(x: DetailInput, l: CategoryLine): LineDetail {
  const { p } = x;
  const key = categoryKey(l.categoryId);
  const cat = x.categories.find((c) => c.id === l.categoryId);
  const adjList = [...adjustmentsOf(p, key), ...(l.method === "weigh_sheets" ? adjustmentsOf(p, "producer") : [])];
  const pct = l.rate?.percent != null ? `${factorText(l.rate.percent)}%` : "";
  const how: string[] = [];
  const items: DetailItem[] = [];
  switch (l.method) {
    case "weigh_sheets":
      how.push(
        "From the carcass weights with a kill date in this week (Thursday to Wednesday).",
        "Each lamb: carcass lb × live factor = live lb; live lb × the rate = its pay. Premiums and docks are added, then each sheet is rounded once to the cent.",
        l.calc == null
          ? (l.waiting ?? "")
          : p.hasSheets
            ? `${x.pays.map((sp) => centsText(sp.cents)).join(" + ")} = ${centsText(l.calc)} (${plural(x.pay.head, "lamb", "lambs")}, ${carcassText(x.pay.carcass)} carcass lb)`
            : "No processing this week: nothing to pay.",
      );
      items.push(...sheetItems(x));
      break;
    case "per_lamb":
      how.push(`Lambs on this week's carcass weights × ${l.rate?.amount != null ? rateText(l.rate.amount) : "the rate"} a lamb${from(l.rate)}.`);
      how.push(l.calc == null ? (l.waiting ?? "") : l.rate ? `${p.head} lambs × ${rateText(l.rate.amount ?? 0)} = ${centsText(l.calc)}` : (l.waiting ?? ""));
      items.push(...lambItems(x));
      break;
    case "percent_income": {
      const sales = cat?.income_base === "sales";
      how.push(`${pct || "A percent"} of ${sales ? "sales (invoices only)" : "all income"}${from(l.rate)}, rounded to the cent.`);
      how.push(
        l.calc == null || l.base == null
          ? (l.waiting ?? "")
          : l.rate
            ? `${pct} × ${centsText(l.base)}${l.projected ? " projected" : ""} ${sales ? "sales" : "income"} = ${centsText(l.calc)}`
            : (l.waiting ?? ""),
      );
      items.push(...incomeItems(x, sales));
      break;
    }
    case "fixed_weekly": {
      const parts = l.rate?.parts ?? [];
      const w = parts.filter((q) => q.per === "week");
      const y = parts.filter((q) => q.per === "year");
      how.push(`The same amount every week, no-processing weeks too${from(l.rate)}.`);
      if (!l.rate) how.push(l.waiting ?? "");
      else {
        const terms = [
          ...w.map((q) => centsText(cents(q.amount))),
          ...(y.length ? [`(${y.map((q) => centsText(cents(q.amount))).join(" + ")}) ÷ 52`] : []),
        ];
        how.push(`${terms.join(" + ")} = ${centsText(l.calc ?? BigInt(0))}`);
      }
      items.push(
        ...parts.map((q) => ({
          label: q.label || (q.per === "week" ? "Weekly amount" : "Yearly amount"),
          amount: centsText(cents(q.amount)),
          note: q.per === "week" ? "a week" : "a year, ÷ 52",
        })),
      );
      break;
    }
    case "percent_category": {
      const of = p.categories.filter((c) => cat?.base_category_ids.includes(c.categoryId));
      how.push(`${pct || "A percent"} of ${of.map((c) => c.name).join(" + ") || "(no categories picked)"}${from(l.rate)}, rounded to the cent.`);
      how.push(l.calc == null || l.base == null ? (l.waiting ?? "") : l.rate ? `${pct} × ${centsText(l.base)} = ${centsText(l.calc)}` : (l.waiting ?? ""));
      items.push(...of.map((c) => ({ label: c.name, amount: c.total != null ? centsText(c.total) : "Not worked out" })));
      break;
    }
    case "per_truck_run": {
      const runs = p.runs;
      const part = cat?.truck_part;
      const link = [{ label: "Truck runs", href: `/truck-runs?week=${x.week}` }];
      const head = (r: RunPay) => `${day(r.run.run_date)} · ${r.driverName}`;
      const stopsText = (r: RunPay) =>
        [
          `${plural(r.regular, "stop", "stops")}${r.extra ? `, ${plural(r.extra, "extra stop", "extra stops")}` : ""}${r.skipped ? `, ${r.skipped} skipped` : ""}`,
          r.stops.length ? r.stops.map((s) => (s.kind === "stop" ? s.name : `${s.name} (${s.kind})`)).join(", ") : "",
        ].filter(Boolean);
      if (part === "driver_pay") {
        how.push("Each run: the driver's base pay + per extra stop × extra stops − per skipped stop × skipped stops (rates per driver in P&L Setup, from the run's date).");
        how.push(l.calc == null ? (l.waiting ?? "") : runs.length ? `${runs.map((r) => centsText(r.pay ?? BigInt(0))).join(" + ")} = ${centsText(l.calc)}` : "No truck runs this week.");
        items.push(
          ...runs.map((r) => ({
            label: head(r),
            amount: r.pay != null ? centsText(r.pay) : "No pay rate",
            math: r.rate
              ? [
                  `${centsText(cents(r.rate.base))} base + ${r.extra} × ${centsText(cents(r.rate.per_extra))} − ${r.skipped} × ${centsText(cents(r.rate.per_skipped))} = ${centsText(r.pay!)}`,
                  `${r.driverName}'s rate from ${short(r.rate.effective_from)}.`,
                  ...stopsText(r),
                ]
              : [`No pay rate for ${r.driverName} on ${short(r.run.run_date)} (P&L Setup).`, ...stopsText(r)],
            links: link,
          })),
        );
      } else if (part === "fuel") {
        how.push("Fuel entered on each truck run.");
        how.push(runs.length ? `${runs.map((r) => (r.fuel != null ? centsText(r.fuel) : "not entered")).join(" + ")} = ${centsText(l.calc ?? BigInt(0))}` : "No truck runs this week.");
        items.push(
          ...runs.map((r) => ({
            label: head(r),
            amount: r.fuel != null ? centsText(r.fuel) : "Not entered",
            files: r.run.receipt_path ? [{ path: r.run.receipt_path, name: r.run.receipt_name || "Receipt", bucket: "truck-files" }] : undefined,
            links: link,
          })),
        );
      } else if (part === "maintenance") {
        const on = runs.filter((r) => r.maintenance);
        how.push(`${l.rate?.amount != null ? centsText(cents(l.rate.amount)) : "The rate"} per run, for drivers with maintenance turned on${from(l.rate)}.`);
        how.push(on.length ? `${on.length} × ${centsText(cents(l.rate?.amount ?? 0))} = ${centsText(l.calc ?? BigInt(0))}` : "No runs by a driver with maintenance on.");
        items.push(...on.map((r) => ({ label: head(r), amount: centsText(cents(l.rate?.amount ?? 0)), links: link })));
      } else how.push(l.waiting ?? "");
      break;
    }
    case "freight_weight":
    case "freight_pallet": {
      const f = l.freight;
      const where = (cat?.customer_ids ?? []).map((id) => x.customerName?.(id) ?? "a location").join(", ") || "no locations picked yet";
      const lbText = (v: bigint) => `${carcassText(v)} lb`;
      if (l.method === "freight_pallet") {
        how.push(`${cat?.carrier || "The carrier"}: ${l.rate?.amount != null ? centsText(cents(l.rate.amount)) : "the rate"} per pallet carrying boxes for ${where}${from(l.rate)}.`);
        how.push(f && l.rate ? `${plural(f.pallets.length, "pallet", "pallets")} × ${centsText(cents(l.rate.amount ?? 0))} = ${centsText(l.calc ?? BigInt(0))}` : (l.waiting ?? ""));
      } else {
        const gross = f?.basis === "gross";
        const perBox = l.rate?.per_box_lb ?? 0;
        const perPallet = l.rate?.per_pallet_lb ?? 0;
        how.push(
          `${cat?.carrier || "The carrier"}: ${l.rate?.amount != null ? `$${Number(l.rate.amount)}` : "the rate"} per lb of ${gross ? "gross" : "net (meat)"} weight of the boxes for ${where} on this week's pallets${from(l.rate)}.`,
        );
        if (f && l.rate) {
          if (gross)
            how.push(
              `${lbText(f.netLb)} meat + ${f.boxes} boxes × ${Number(perBox)} lb + ${plural(f.pallets.length, "pallet", "pallets")} × ${Number(perPallet)} lb = ${lbText(f.lb)}${
                Number(perBox) === 0 && Number(perPallet) === 0 ? " (no lb per box or pallet set yet: P&L Setup)" : ""
              }`,
            );
          how.push(`${lbText(f.lb)} × $${Number(l.rate.amount)} = ${centsText(l.calc ?? BigInt(0))}`);
        } else how.push(l.waiting ?? "");
      }
      items.push(
        ...(f?.pallets ?? []).map((pl) => ({
          label: `Pallet ${pl.tag}`,
          amount: l.method === "freight_weight" ? lbText(pl.lb) : undefined,
          note: `${plural(pl.boxes, "box", "boxes")} for ${pl.customerIds.map((id) => x.customerName?.(id) ?? "a location").join(", ")}`,
        })),
      );
      if (f?.offPallet) items.push({ label: "Not on a pallet", tag: "Not counted", note: plural(f.offPallet, "box", "boxes") });
      break;
    }
    case "entered":
      how.push("Expenses entered on the Weekly P&L, dated in this week.");
      break;
    default:
      how.push(l.waiting ?? "");
  }
  const entryItems: DetailItem[] = x.expenses
    .filter((e) => e.category_id === l.categoryId)
    .map((e) => {
      const files = (x.expenseFiles ?? []).filter((f) => f.expense_id === e.id);
      return {
        label: day(e.entry_date),
        tag: "Entered",
        amount: centsText(cents(e.amount)),
        note: [e.note, `Entered by ${x.userName(e.created_by)}${e.created_at ? `, ${stamp(e.created_at)}` : ""}`].filter(Boolean).join(" · "),
        files: files.length ? files.map((f) => ({ path: f.path, name: f.name || "Attachment" })) : undefined,
      };
    });
  items.push(...entryItems, ...adjustmentItems(adjList));
  if (l.method === "entered") {
    how.push(entryItems.length ? `${entryItems.map((i) => i.amount).join(" + ")} = ${centsText(l.entered)}` : "None entered yet.");
    if (adjList.length) how.push(...withAdjustments(l.entered, l.adj, l.total ?? BigInt(0), true));
  } else if (l.total != null && (l.entries || adjList.length)) {
    const neg = l.adj < BigInt(0);
    how.push(
      `Calculated ${centsText(l.calc ?? BigInt(0))}${l.entries ? ` + entered ${centsText(l.entered)}` : ""}${
        adjList.length ? ` ${neg ? "−" : "+"} adjustments ${centsText(neg ? -l.adj : l.adj)}` : ""
      } = ${centsText(l.total)}`,
    );
  }
  return {
    key,
    lineKey: key,
    title: l.projected ? `${l.name} (projected)` : l.name,
    amount: l.total != null ? centsText(l.total) : null,
    projected: l.projected,
    how: how.filter(Boolean),
    items,
  };
}

/** A group's subtotal: its categories added up. */
function groupDetail(g: GroupTotal): LineDetail {
  const shown = g.lines;
  return {
    key: `group:${g.name}`,
    title: g.complete ? g.name : `${g.name} so far`,
    amount: centsText(g.total),
    projected: shown.some((l) => l.projected),
    how: [
      `The ${g.name.toLowerCase()} categories added up${g.complete ? "" : "; some aren't worked out yet and count as $0.00"}.`,
      shown.length ? `${shown.map((l) => (l.total != null ? centsText(l.total) : "$0.00")).join(" + ")} = ${centsText(g.total)}` : "No categories in this group.",
    ],
    items: shown.map((l) => ({ label: l.name, amount: l.total != null ? centsText(l.total) : "Not worked out", note: l.waiting ?? undefined })),
  };
}

function oneOffExpenseDetail(x: DetailInput): LineDetail {
  const { p } = x;
  return {
    key: "oneoff-expense",
    title: "One-off expenses",
    amount: centsText(p.oneOffExpenseCents),
    projected: false,
    how: ["Expense lines with no category, added on this page with a reason (a freight bill, a credit)."],
    items: adjustmentItems(p.adjustments.filter((a) => a.kind === "one_off" && a.side === "expense")),
  };
}

function resultDetails(x: DetailInput): LineDetail[] {
  const { p } = x;
  const pj = (t: string) => (p.projected ? `${t} (projected)` : t);
  const waits = [!p.hasSheets && !p.noProcessing && "no carcass weights", !p.hasIncome && !p.noProcessing && "no income"].filter(Boolean).join(" and ");
  const delivery = p.groups.find((g) => g.name === "Delivery")!;
  return [
    {
      key: "total",
      title: p.categories.some((l) => l.projected) ? "Total expense (projected)" : "Total expense",
      amount: p.totalExpense != null ? centsText(p.totalExpense) : null,
      projected: p.categories.some((l) => l.projected),
      how: [
        "Cost of product + Delivery + Operating + one-off expenses.",
        p.totalExpense != null
          ? `${[...p.groups.map((g) => centsText(g.total)), centsText(p.oneOffExpenseCents)].join(" + ")} = ${centsText(p.totalExpense)}`
          : "Not worked out: no carcass weights for this week.",
      ],
      items: [],
    },
    {
      key: "netdelivery",
      title: "Net delivery cost",
      amount: centsText(p.netDelivery),
      projected: false,
      how: [
        "Delivery total − freight charged on invoices (Setup > Invoicing; part of income).",
        `${centsText(delivery.total)} − ${centsText(p.freightIncome)} = ${centsText(p.netDelivery)}`,
      ],
      items: x.ii.rows
        .flatMap((r) => r.lines.filter((l) => l.kind === "freight").map((l) => ({ r, l })))
        .map(({ r, l }) => ({ label: r.name, tag: r.status === "finalized" ? "Finalized" : "Packed", amount: l.totalCents != null ? centsText(l.totalCents) : undefined })),
    },
    {
      key: "perpallet",
      title: "Freight per pallet",
      amount: p.freightPerPallet != null ? centsText(p.freightPerPallet) : null,
      projected: false,
      how: [
        "The freight categories (carriers) ÷ pallets carrying boxes a carrier covers.",
        p.freightPerPallet != null
          ? `${centsText(p.freightCents)} ÷ ${plural(p.freightPallets, "pallet", "pallets")} = ${centsText(p.freightPerPallet)} a pallet`
          : "Not worked out: no pallets for a freight carrier this week.",
      ],
      items: p.shipping.pallets.map((pl) => ({
        label: `Pallet ${pl.tag}`,
        tag: pl.byFreight ? "Freight" : pl.byTruck ? "Truck" : "Not covered",
        note: pl.customerIds.map((id) => x.customerName?.(id) ?? "a location").join(", "),
      })),
    },
    {
      key: "perstop",
      title: "Truck cost per stop",
      amount: p.costPerStop != null ? centsText(p.costPerStop) : null,
      projected: false,
      how: [
        "The truck categories (driver pay, payroll taxes, fuel, maintenance, insurance, depreciation, repairs) ÷ stops made on this week's truck runs (regular + extra; skipped stops aren't made). Carrier freight isn't in it.",
        p.costPerStop != null
          ? `${centsText(p.truckCents)} ÷ ${plural(p.truckStops, "stop", "stops")} = ${centsText(p.costPerStop)} a stop`
          : "Not worked out: no stops on truck runs this week.",
      ],
      items: [],
    },
    {
      key: "deliverylb",
      title: "Delivery cost per lb shipped",
      amount: p.deliveryPerLb != null ? `$${fixedRounded(p.deliveryPerLb, 4, 2)}` : null,
      projected: false,
      how: [
        "Net delivery cost ÷ lb in the week's packed boxes.",
        p.deliveryPerLb != null
          ? `${centsText(p.netDelivery)} ÷ ${carcassText(p.lbShipped)} lb = $${fixedRounded(p.deliveryPerLb, 4, 4)} a lb`
          : "Not worked out: nothing packed this week.",
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
        "Profit ÷ lambs on this week's carcass weights, rounded to the cent.",
        p.profitPerHead != null ? `${centsText(p.profit!)} ÷ ${p.head} lambs = ${centsText(p.profitPerHead)}` : `Not worked out: ${waits || "no lambs this week"}.`,
      ],
      items: [],
    },
    {
      key: "incomelb",
      title: pj("Income per carcass lb"),
      amount: p.incomePerCarcassLb != null ? `$${fixedRounded(p.incomePerCarcassLb, 4, 2)}` : null,
      projected: p.projected,
      how: [
        "Income ÷ carcass lb on this week's carcass weights.",
        p.incomePerCarcassLb != null
          ? `${centsText(p.incomeCents)} ÷ ${carcassText(x.pay.carcass)} lb = $${fixedRounded(p.incomePerCarcassLb, 4, 4)} a lb`
          : `Not worked out: ${[!p.hasSheets && "no carcass weights", !p.hasIncome && "no income"].filter(Boolean).join(" and ") || "no lambs this week"}.`,
      ],
      items: [],
    },
    {
      key: "costlb",
      title: pj("Cost per carcass lb"),
      amount: p.costPerCarcassLb != null ? `$${fixedRounded(p.costPerCarcassLb, 4, 2)}` : null,
      projected: p.projected,
      how: [
        "Total expense ÷ carcass lb on this week's carcass weights.",
        p.costPerCarcassLb != null
          ? `${centsText(p.totalExpense!)} ÷ ${carcassText(x.pay.carcass)} lb = $${fixedRounded(p.costPerCarcassLb, 4, 4)} a lb`
          : `Not worked out: ${waits || "no lambs this week"}.`,
      ],
      items: [],
    },
  ];
}

/** Every line's detail, in the order the P&L shows them. */
export function pnlDetails(x: DetailInput): LineDetail[] {
  return [
    incomeDetail(x),
    ...x.p.groups.flatMap((g) => [...g.lines.map((l) => categoryDetail(x, l)), groupDetail(g)]),
    oneOffExpenseDetail(x),
    ...resultDetails(x),
  ];
}

// ---------------------------------------------------------------------------
// What's missing before the week can be trusted.
// ---------------------------------------------------------------------------

/** One thing missing, in a line, with where it's fixed. */
export type PnlCheck = {
  key: string;
  text: string;
  /** Where it's fixed, and the link's words. */
  href?: string;
  link?: string;
  /** The category it's about, if one (shown "Not entered" on the P&L). */
  categoryId?: string;
};

export function pnlChecks(x: {
  p: WeekPnl;
  ii: InvoiceIncome;
  /** This week's lamb count (This week), or null when unknown. */
  lambCount: number | null;
  /** The packing Monday, for the links. */
  week?: string;
}): PnlCheck[] {
  const out: PnlCheck[] = [];
  const { p, ii } = x;
  const w = x.week ? `?week=${x.week}` : "";
  if (ii.packedCount)
    out.push({
      key: "invoices",
      text: `${plural(ii.packedCount, "invoice", "invoices")} not finalized: income below is projected from packed weights.`,
      href: "/invoices",
      link: "Invoices",
    });
  if (ii.notPacked.length)
    out.push({
      key: "notpacked",
      text: `${plural(ii.notPacked.length, "location", "locations")} with orders not packed: ${ii.notPacked.map((r) => r.name).join(", ")}.`,
      href: "/packing",
      link: "Packing",
    });
  for (const n of ii.priceNeeded)
    out.push({ key: `price:${n.product}`, text: `Price needed: ${n.product} (${n.locations.join(", ")}).`, href: "/setup/prices", link: "Prices" });
  if (!p.hasSheets && !p.noProcessing)
    out.push({ key: "sheet", text: "No carcass weights entered for this week's kill.", href: "/carcass-weights", link: "Carcass weights" });
  if (p.hasSheets && x.lambCount != null && p.head !== x.lambCount)
    out.push({
      key: "lambs",
      text: `The carcass weights have ${p.head} lambs; This week's lamb count is ${x.lambCount}.`,
      href: "/carcass-weights",
      link: "Carcass weights",
    });
  const mohawk = p.categories.filter((l) => /mohawk/i.test(l.name) && l.method === "entered");
  if (p.hasSheets && mohawk.length && mohawk.every((l) => l.entries === 0 && l.adj === BigInt(0)))
    out.push({ key: "butcher", text: `No ${mohawk[0].name} cost entered.`, href: `/pnl/entries${w}`, link: "Add it", categoryId: mohawk[0].categoryId });
  // How it ships: each pallet is covered by a freight carrier or is on a truck run.
  const nameOf = new Map(ii.rows.map((r) => [r.customerId, r.name]));
  const names = (ids: string[]) => ids.map((id) => nameOf.get(id) ?? "a location").join(", ");
  const driverPay = p.categories.find((l) => l.method === "per_truck_run" && l.active && l.total === BigInt(0) && p.runs.length === 0);
  for (const pl of p.shipping.pallets.filter((s) => !s.byFreight && !s.byTruck))
    out.push({
      key: `ship:${pl.id}`,
      text: `Pallet ${pl.tag} (${names(pl.customerIds)}): no truck run, and no freight carrier covers it.`,
      href: `/truck-runs${w}`,
      link: "Truck runs",
      categoryId: driverPay?.categoryId,
    });
  if (p.shipping.pallets.length === 0) {
    const loose = p.shipping.locations.filter((l) => !l.byFreight && !l.byTruck).map((l) => l.customerId);
    if (loose.length)
      out.push({
        key: "truckrun",
        text: `Boxes packed for ${names(loose)}: no truck run, and no freight carrier covers them.`,
        href: `/truck-runs${w}`,
        link: "Truck runs",
        categoryId: driverPay?.categoryId,
      });
  }
  for (const r of p.runs.filter((s) => s.fuel == null))
    out.push({ key: `fuel:${r.run.id}`, text: `The truck run on ${short(r.run.run_date)} (${r.driverName}) has no fuel entered.`, href: `/truck-runs${w}`, link: "Truck runs" });
  for (const l of p.categories.filter((c) => c.freight && c.freight.offPallet > 0))
    out.push({
      key: `offpallet:${l.categoryId}`,
      text: `${l.name}: ${plural(l.freight!.offPallet, "box isn't", "boxes aren't")} on a pallet, so not counted.`,
      href: "/packing",
      link: "Packing",
    });
  for (const l of p.categories.filter((c) => c.active && c.waiting === "No rate for this week (P&L Setup)."))
    out.push({ key: `rate:${l.categoryId}`, text: `${l.name} has no rate for this week.`, href: "/setup/lamb-cost", link: "P&L Setup" });
  return out;
}
