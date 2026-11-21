"use client";

// Weekly P&L (Lucas, 11/17/26): a one-screen summary an owner can read in
// under a minute, with detail one tap away. Header (status, review, close),
// one box of what's missing (each line links to where it's fixed), the
// summary, income in short (a chain's stores as one line), and expenses by
// group with the $0 categories hidden. Entering income, expenses and
// adjustments is on the Entries page (Add / adjust). The numbers are
// unchanged: every line still opens "How this was calculated".

import { Fragment, useState } from "react";
import Link from "next/link";
import { useCan } from "@/components/CurrentUser";
import { useStaffData } from "@/components/data/StaffData";
import { useWeek, WeekBar } from "@/components/Week";
import { averageLbText, carcassText, centsText, factorText, fixedRounded, liveText, rateText } from "@/lib/calc/lambCost";
import { categoryKey, type CategoryLine, type IncomeStatus, type InvoiceIncome, type LocationIncome, type PnlAdjustment, type WeekPnl } from "@/lib/calc/pnl";
import type { PnlCheck } from "@/lib/calc/pnlDetail";
import { niceDate, weekDays } from "@/lib/dates";
import { LineSheet } from "./Detail";
import { usePnlWeek } from "./usePnlWeek";
import { WeekHeader } from "./WeekStatus";

/** Which line's detail is open: one or more lines, or one record under them. */
type Open = { keys: string[]; only?: string } | null;
type OnOpen = (keys: string[], only?: string) => void;

/** A P&L line's label you can tap for how it was calculated. */
function Tap({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="cursor-pointer border-0 bg-transparent p-0 text-left text-inherit underline decoration-dotted underline-offset-4"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "+$25.00", "-$50.00" */
const signed = (c: bigint) => (c < BigInt(0) ? `-${centsText(-c)}` : `+${centsText(c)}`);
const money = (v: string | number) => BigInt(Math.round(Number(v) * 100));

export default function PnlScreen() {
  const { week } = useWeek();
  const w = usePnlWeek(week);
  const [open, setOpen] = useState<Open>(null);
  const [help, setHelp] = useState(false);
  const onOpen: OnOpen = (keys, only) => setOpen({ keys, only });
  const canChange = useCan("pnl").change;

  const head = (
    <div className="noprint">
      <WeekBar />
    </div>
  );
  if (w.error) return <>{head}<p className="note bad">Couldn&apos;t load the P&amp;L: {w.error}</p></>;
  if (!w.ready) return <>{head}<p className="small muted">Loading...</p></>;
  const { data, setup, pay, ii, p, details, checks, producerName, refresh, status, snapshot } = w;
  const closed = !!status.closed;
  const live = p.adjustments.filter((a) => !a.voided_at);
  const counts = [
    data.income.length ? plural(data.income.length, "income entry", "income entries") : "",
    data.expenses.length ? plural(data.expenses.length, "expense entry", "expense entries") : "",
    live.length ? plural(live.length, "adjustment or one-off line", "adjustments and one-off lines") : "",
  ].filter(Boolean);

  return (
    <div className="max-w-[900px]">
      {head}
      {open && (
        <LineSheet
          details={details.filter((d) => open.keys.includes(d.key))}
          only={open.only}
          week={week}
          p={p}
          categories={setup.categories}
          onSaved={refresh}
          closed={closed || !canChange}
          onClose={() => setOpen(null)}
        />
      )}
      <WeekHeader week={week} inv={data.inv} status={status} checks={checks} snapshot={snapshot} refresh={refresh} onHelp={() => setHelp(!help)} />
      {help && <Help week={week} />}

      {!closed && <Checks checks={checks} />}

      <div className="grid gap-x-6 md:grid-cols-2">
        <div>
          <Summary p={p} onOpen={onOpen} />
          <Income p={p} ii={ii} onOpen={onOpen} />
        </div>
        <Expenses p={p} checks={checks} onOpen={onOpen} />
      </div>

      {pay.producers.length > 1 && (
        <section className="panel mt-3" aria-labelledby="pnl-producers">
          <h3 id="pnl-producers">Producer pay by producer</h3>
          <div className="overflow-x-auto">
            <table className="simple mt-1">
              <thead>
                <tr>
                  <th>Producer</th>
                  <th className="text-right">Head</th>
                  <th className="text-right">Carcass lb</th>
                  <th className="text-right">Live lb</th>
                  <th className="text-right">Average carcass</th>
                  <th className="text-right">Pay</th>
                </tr>
              </thead>
              <tbody>
                {pay.producers.map((r) => (
                  <tr key={r.producerId}>
                    <td>
                      <Tap onClick={() => onOpen(producerKeys(p), producerName(r.producerId))}>{producerName(r.producerId)}</Tap>
                    </td>
                    <td className="num text-right">{r.head}</td>
                    <td className="num text-right">{carcassText(r.carcass)}</td>
                    <td className="num text-right">{liveText(r.live)}</td>
                    <td className="num text-right">{averageLbText(r.carcass, r.head)}</td>
                    <td className="num text-right">{centsText(r.cents)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td>All producers</td>
                  <td className="num text-right">{pay.head}</td>
                  <td className="num text-right">{carcassText(pay.carcass)}</td>
                  <td className="num text-right">{liveText(pay.live)}</td>
                  <td className="num text-right">{averageLbText(pay.carcass, pay.head)}</td>
                  <td className="num text-right">{centsText(pay.cents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="small muted noprint mt-3">
        {counts.length ? counts.join(", ") : "No entries or adjustments this week"} ·{" "}
        <Link href={`/pnl/entries?week=${week}`}>{counts.length || closed || !canChange ? "View" : "Add / adjust"}</Link>
      </p>
    </div>
  );
}

/** The help that used to fill the page, behind "How this page works". */
function Help({ week }: { week: string }) {
  const days = weekDays(week);
  return (
    <div className="note small mt-2">
      <p className="m-0">
        Thursday {niceDate(days[0])} to Wednesday {niceDate(days[6])}. Every entry counts toward the week that contains its date.
        A P&amp;L, not accounting: payments aren&apos;t tracked. Tap any line to see how it was calculated, with its rate, its
        date and the records it came from.
      </p>
      <p className="m-0 mt-1">
        Income comes from the week&apos;s invoices: finalized ones as invoiced, packed ones projected from packed weights ×
        prices. Don&apos;t enter invoices as other income: they&apos;re counted already.
      </p>
      <p className="m-0 mt-1">
        A correction is never typed over a calculated number: it&apos;s an adjustment with a reason, on the Entries page (Add /
        adjust). A one-off line is income or an expense with no category (a freight bill, a credit). Adjustments are voided,
        not deleted. A closed week shows the P&amp;L as it was when it was closed.
      </p>
    </div>
  );
}

/** One box of what's missing, each line linking to where it's fixed; or a green Complete. */
function Checks({ checks }: { checks: PnlCheck[] }) {
  if (!checks.length)
    return (
      <p className="note mt-2 bg-ok" role="status">
        <b>Complete.</b> Every invoice is finalized, every packed product has a price, the carcass weights match the lamb count, and
        the Mohawk cost is in.
      </p>
    );
  return (
    <div className="note warn mt-2" role="status">
      <b>Before this can be trusted</b>
      <ul className="m-0 mt-1 pl-5">
        {checks.map((c) => (
          <li key={c.key}>
            {c.text}
            {c.href && (
              <>
                {" "}
                <Link href={c.href} className="noprint">
                  {c.link ?? "Fix it"}
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Income, expenses by group, total, profit, per head, income per carcass lb; one Projected tag. */
function Summary({ p, onOpen }: { p: WeekPnl; onOpen: OnOpen }) {
  const projected = p.projected;
  const row = (label: string, value: React.ReactNode, strong = false, keys: string[] = []) => (
    <tr className={strong ? "font-bold" : ""}>
      <td>{keys.length ? <Tap onClick={() => onOpen(keys)}>{label}</Tap> : label}</td>
      <td className="num text-right">{value}</td>
    </tr>
  );
  const missing = <span className="muted">Not worked out</span>;
  const waits = [!p.hasSheets && !p.noProcessing && "No carcass weights for this week.", !p.hasIncome && !p.noProcessing && "No income yet."].filter(Boolean);
  return (
    <section className="panel mt-3" aria-labelledby="pnl-summary">
      <h3 id="pnl-summary" className="flex items-center gap-2">
        Summary {projected && <span className="tag callback">Projected</span>}
      </h3>
      {p.noProcessing && <p className="small m-0">No processing this week: fixed weekly costs still count.</p>}
      {waits.length > 0 && <p className="small m-0">{waits.join(" ")} Profit waits for both.</p>}
      <table className="simple mt-1">
        <tbody>
          {row("Income", p.hasIncome ? centsText(p.incomeCents) : missing, false, ["income"])}
          {p.groups.map((g) => (
            <Fragment key={g.name}>{row(g.complete ? g.name : `${g.name} so far`, centsText(g.total), false, groupKeys(p, g.name))}</Fragment>
          ))}
          {p.oneOffExpenseCents !== BigInt(0) && row("One-off expenses", centsText(p.oneOffExpenseCents), false, ["oneoff-expense"])}
          {row("Total expense", p.totalExpense != null ? centsText(p.totalExpense) : missing, false, ["total"])}
          {row("Profit", p.profit != null ? centsText(p.profit) : missing, true, ["profit"])}
          {row("Profit per head", p.profitPerHead != null ? `${centsText(p.profitPerHead)} (${p.head} head)` : missing, false, ["perhead"])}
          {row("Income per carcass lb", p.incomePerCarcassLb != null ? `$${fixedRounded(p.incomePerCarcassLb, 4, 2)}` : missing, false, ["incomelb"])}
        </tbody>
      </table>
    </section>
  );
}

/** A group's detail: the group, and for Delivery its per-pallet, per-stop and per-lb lines. */
function groupKeys(p: WeekPnl, name: string): string[] {
  if (name !== "Delivery") return [`group:${name}`];
  return [`group:${name}`, ...(p.freightIncome ? ["netdelivery"] : []), "perpallet", "perstop", "deliverylb"];
}

const STATUS: Record<IncomeStatus, { label: string; cls: string }> = {
  finalized: { label: "Finalized", cls: "ordered" },
  packed: { label: "Packed", cls: "callback" },
  not_packed: { label: "Not packed", cls: "none" },
};

/** Income in short: a chain's stores as one line (tap to open), other customers one line each. */
function Income({ p, ii, onOpen }: { p: WeekPnl; ii: InvoiceIncome; onOpen: OnOpen }) {
  const { customers } = useStaffData();
  const [opened, setOpened] = useState<string[]>([]);
  const counted = ii.rows.filter((r) => r.status !== "not_packed");
  const statuses = [...new Set(counted.map((r) => r.status))];
  const same = statuses.length === 1 ? statuses[0] : null;
  // Chains first-come, then locations on their own, by income.
  const groups: { key: string; name: string; rows: LocationIncome[] }[] = [];
  for (const r of counted) {
    const key = r.chainId ?? r.customerId;
    const g = groups.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else groups.push({ key, name: r.chainId ? (customers?.byId.get(r.chainId)?.name ?? "Chain") : r.name, rows: [r] });
  }
  const total = (rows: LocationIncome[]) => rows.reduce((t, r) => t + (r.cents ?? BigInt(0)), BigInt(0));
  groups.sort((a, b) => Number(total(b.rows) - total(a.rows)));
  const tag = (s: IncomeStatus) => <span className={`tag ${STATUS[s].cls} ml-2`}>{STATUS[s].label}</span>;
  const extra = p.adjustments.filter((a) => !a.voided_at && a.side === "income" && a.line_key !== "freezer_in" && a.line_key !== "freezer_out");

  return (
    <section className="panel mt-3" aria-labelledby="pnl-income">
      <h3 id="pnl-income" className="m-0">
        Income
        {same && (
          <span className="small muted font-normal">
            {" "}
            · {same === "finalized" ? "all finalized" : "all packed, not invoiced"}
          </span>
        )}
      </h3>
      {!p.hasIncome ? (
        <p className="small m-0 mt-1">No income yet. Projected income shows once boxes are packed.</p>
      ) : (
        <table className="simple mt-1">
          <tbody>
            {groups.map((g) => {
              const chain = g.rows[0].chainId != null;
              const isOpen = opened.includes(g.key);
              const gs = [...new Set(g.rows.map((r) => r.status))];
              return (
                <Fragment key={g.key}>
                  <tr>
                    <td>
                      {chain ? (
                        <button type="button" className="copy p-0 text-left" onClick={() => setOpened(isOpen ? opened.filter((k) => k !== g.key) : [...opened, g.key])}>
                          {g.name} ({plural(g.rows.length, "store", "stores")}) {isOpen ? "▾" : "▸"}
                        </button>
                      ) : (
                        <Tap onClick={() => onOpen(["income"], g.rows[0].name)}>{g.name}</Tap>
                      )}
                      {!same && gs.length === 1 && tag(gs[0])}
                      {!same && gs.length > 1 && <span className="tag ml-2">Mixed</span>}
                    </td>
                    <td className="num text-right">{centsText(total(g.rows))}</td>
                  </tr>
                  {chain &&
                    isOpen &&
                    g.rows.map((r) => (
                      <tr key={r.customerId}>
                        <td className="pl-5">
                          <Tap onClick={() => onOpen(["income"], r.name)}>{r.name.replace(/^[^:]+: /, "")}</Tap>
                          {!same && gs.length > 1 && tag(r.status)}
                          {r.unpackedLines > 0 && <span className="small muted block">{plural(r.unpackedLines, "ordered line", "ordered lines")} not packed</span>}
                        </td>
                        <td className="num text-right">{r.cents != null ? centsText(r.cents) : ""}</td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
            {p.income.map((r) => (
              <tr key={r.key}>
                <td>
                  <Tap onClick={() => onOpen(["income"], r.name)}>{r.name}</Tap>
                  <span className="tag ml-2">Other income</span>
                </td>
                <td className="num text-right">{centsText(r.cents)}</td>
              </tr>
            ))}
            {extra.map((a) => (
              <OneOffRow key={a.id} a={a} onOpen={() => onOpen(["income"], a.kind === "one_off" ? a.label : a.reason)} />
            ))}
            {p.freezerIn && (p.freezerIn.rows.length > 0 || p.freezerIn.adj !== BigInt(0)) && (
              <tr>
                <td>
                  <Tap onClick={() => onOpen(["freezer_in"])}>Into freezer</Tap>
                  <span className="small muted block">{plural(p.freezerIn.rows.length, "box", "boxes")} put in the freezer</span>
                </td>
                <td className="num text-right">{centsText(p.freezerIn.total)}</td>
              </tr>
            )}
            {p.freezerOut && (p.freezerOut.rows.length > 0 || p.freezerOut.adj !== BigInt(0)) && (
              <tr>
                <td>
                  <Tap onClick={() => onOpen(["freezer_out"])}>Out of freezer</Tap>
                  <span className="small muted block">{plural(p.freezerOut.rows.length, "box", "boxes")} packed for orders, at the value they went in at</span>
                </td>
                <td className="num text-right">{p.freezerOut.total < BigInt(0) ? `-${centsText(-p.freezerOut.total)}` : centsText(p.freezerOut.total)}</td>
              </tr>
            )}
            {p.freightIncome !== BigInt(0) && (
              <tr>
                <td className="small muted">Of which freight on invoices</td>
                <td className="num small text-right">{centsText(p.freightIncome)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** An adjustment to income, or a one-off line, as a row under its section. */
function OneOffRow({ a, onOpen }: { a: PnlAdjustment; onOpen: () => void }) {
  const isOneOff = a.kind === "one_off";
  return (
    <tr>
      <td>
        <Tap onClick={onOpen}>{isOneOff ? a.label : "Adjustment"}</Tap>
        <span className="tag ml-2">{isOneOff ? "One-off" : "Adjustment"}</span>
        <span className="small muted block">{a.reason}</span>
      </td>
      <td className="num text-right">{isOneOff ? centsText(money(a.amount)) : signed(money(a.amount))}</td>
    </tr>
  );
}

/** The carcass weights category's detail key (producer pay). */
const producerKeys = (p: WeekPnl) => p.categories.filter((l) => l.method === "weigh_sheets").map((l) => categoryKey(l.categoryId));

/** What a category's number is, in a few words. */
function methodText(l: CategoryLine, p: WeekPnl): string {
  if (l.waiting) return l.waiting;
  const entries = l.entries ? `${l.entries} ${l.entries === 1 ? "entry" : "entries"}` : "";
  const r = l.rate;
  let s = "";
  switch (l.method) {
    case "weigh_sheets":
      s = p.hasSheets ? `${p.head} lambs on the carcass weights` : "No processing this week";
      break;
    case "per_lamb":
      s = r?.amount != null ? `${p.head} lambs × ${rateText(r.amount)}` : "";
      break;
    case "percent_income":
    case "percent_category":
      s = r?.percent != null && l.base != null ? `${factorText(r.percent)}% × ${centsText(l.base)}${l.projected ? " projected" : ""}` : "";
      break;
    case "fixed_weekly":
      s = "Fixed weekly";
      break;
    case "freight_pallet":
      s = l.freight && r?.amount != null ? `${l.freight.pallets.length} ${l.freight.pallets.length === 1 ? "pallet" : "pallets"} × ${rateText(r.amount)}` : "";
      break;
    case "freight_weight":
      s =
        l.freight && r?.amount != null
          ? `${carcassText(l.freight.lb)} lb ${l.freight.basis === "gross" ? "gross" : "net"} × $${Number(r.amount)}${
              l.freight.basis === "gross" && !Number(r.per_box_lb ?? 0) && !Number(r.per_pallet_lb ?? 0) ? " (no lb per box or pallet set yet)" : ""
            }`
          : "";
      break;
    case "per_truck_run": {
      const runs = `${p.runs.length} truck ${p.runs.length === 1 ? "run" : "runs"}`;
      const on = p.runs.filter((r) => r.maintenance).length;
      s = p.runs.length === 0 ? "No truck runs" : l.rate?.amount != null && on ? `${on} × ${rateText(l.rate.amount)} a run` : runs;
      break;
    }
    case "entered":
      s = entries || "None entered";
      return l.adj ? `${s}; ${signed(l.adj)} adjustments` : s;
  }
  return [s, entries ? `+ ${entries}` : "", l.adj ? `${signed(l.adj)} adjustments` : ""].filter(Boolean).join("; ");
}


/**
 * Expenses by group, each with its subtotal and its categories. $0 ones are
 * hidden ("Show all categories"), except one the checks expect (Processing,
 * Mohawk; truck runs): that shows "Not entered" in amber.
 */
function Expenses({ p, checks, onOpen }: { p: WeekPnl; checks: PnlCheck[]; onOpen: OnOpen }) {
  const [all, setAll] = useState(false);
  // On a phone each group is one line until opened.
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const expected =new Set(checks.map((c) => c.categoryId).filter(Boolean) as string[]);
  const shown = (l: CategoryLine) => all || l.total == null || l.total !== BigInt(0) || expected.has(l.categoryId) || l.entries > 0 || l.adj !== BigInt(0);
  const hidden = p.categories.filter((l) => !shown(l)).length;
  const missing = <span className="muted">Not worked out</span>;
  return (
    <section className="panel mt-3" aria-labelledby="pnl-expenses">
      <h3 id="pnl-expenses" className="m-0">
        Expenses
      </h3>
      <table className="simple mt-1">
        <tbody>
          {p.groups.map((g) => (
            <Fragment key={g.name}>
              <tr className="font-bold">
                <td className="pt-3">
                  <Tap onClick={() => onOpen(groupKeys(p, g.name))}>{g.complete ? g.name : `${g.name} so far`}</Tap>
                  <button
                    type="button"
                    className="copy ml-2 px-2 sm:hidden"
                    aria-label={openGroups.includes(g.name) ? `Fold ${g.name}` : `Open ${g.name}`}
                    onClick={() => setOpenGroups(openGroups.includes(g.name) ? openGroups.filter((x) => x !== g.name) : [...openGroups, g.name])}
                  >
                    {openGroups.includes(g.name) ? "▾" : "▸"}
                  </button>
                </td>
                <td className="num pt-3 text-right">{centsText(g.total)}</td>
              </tr>
              {g.lines.filter(shown).map((l) => {
                const notEntered = expected.has(l.categoryId) && l.total === BigInt(0);
                return (
                  <tr key={l.categoryId} className={openGroups.includes(g.name) ? "" : "max-sm:hidden"}>
                    <td className="pl-3">
                      <Tap onClick={() => onOpen([categoryKey(l.categoryId)])}>{l.name}</Tap>
                      {!l.active && <span className="tag ml-2">Retired</span>}
                      <span className="small muted block">{methodText(l, p)}</span>
                    </td>
                    <td className="num text-right align-top">
                      {notEntered ? <span className="tag callback">Not entered</span> : l.total != null ? centsText(l.total) : missing}
                    </td>
                  </tr>
                );
              })}
              {g.name === "Delivery" && p.freightIncome !== BigInt(0) && (
                <tr>
                  <td className="pl-3">
                    <Tap onClick={() => onOpen(["netdelivery"])}>Net delivery cost</Tap>
                    <span className="small muted block">Delivery − {centsText(p.freightIncome)} freight on invoices</span>
                  </td>
                  <td className="num text-right align-top">{centsText(p.netDelivery)}</td>
                </tr>
              )}
            </Fragment>
          ))}
          {p.oneOffExpense.length > 0 && (
            <>
              <tr className="font-bold">
                <td className="pt-3">One-off expenses</td>
                <td className="num pt-3 text-right">{centsText(p.oneOffExpenseCents)}</td>
              </tr>
              {p.oneOffExpense.map((a) => (
                <OneOffRow key={a.id} a={a} onOpen={() => onOpen(["oneoff-expense"], a.label)} />
              ))}
            </>
          )}
        </tbody>
      </table>
      {(hidden > 0 || all) && (
        <p className="small m-0 mt-2 noprint">
          <button type="button" className="copy p-0" onClick={() => setAll(!all)}>
            {all ? "Hide $0 categories" : `Show all categories (${hidden} at $0.00 hidden)`}
          </button>
        </p>
      )}
    </section>
  );
}

