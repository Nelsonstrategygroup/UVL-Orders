"use client";

// Weekly P&L (SPEC 16.6, Lamb cost stage 3). A P&L, not accounting: the
// week's income entries, producer cost from the weigh sheets, charges worked
// out from the week, and expense entries. Every dated entry counts toward the
// order week containing its date. Printable: the entry forms don't print.
// Where something is missing it says so instead of showing a number.

import { useCallback, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import { averageLbText, carcassText, centsText, factorText, fixedRounded, liveText, rateText, sheetPay, weekPay } from "@/lib/calc/lambCost";
import { parseMoney, weekPnl, type ExpenseCategory, type ExpenseEntry, type IncomeEntry, type WeekPnl } from "@/lib/calc/pnl";
import { longDate, niceDate, weekDays, weekName } from "@/lib/dates";
import { loadLambCostSetup } from "@/lib/db/lambCost";
import { addExpense, addIncome, deleteEntry, loadPnlSetup, loadWeekEntries } from "@/lib/db/pnl";
import { loadWeekSheets } from "@/lib/db/weighSheets";

const TABLES = ["pnl_expenses", "pnl_income", "kill_sheets", "kill_lambs", "kill_adjustments", "producers"];
const SETUP_TABLES = ["pnl_lamb_charges", "pnl_percent_charges", "expense_categories"];

async function loadWeek(db: SupabaseClient, week: string) {
  const [entries, sheets, inv] = await Promise.all([
    loadWeekEntries(db, week),
    loadWeekSheets(db, week),
    db.from("weeks").select("invoice_number").eq("id", week).maybeSingle(),
  ]);
  return { ...entries, sheets, inv: (inv.data as { invoice_number?: number | null } | null)?.invoice_number ?? null };
}

export default function PnlScreen() {
  const { week } = useWeek();
  const load = useCallback((d: SupabaseClient) => loadWeek(d, week), [week]);
  const { data, error, refresh } = useLive(`pnl:${week}`, load, TABLES);
  const loadSetup = useCallback((d: SupabaseClient) => loadPnlSetup(d), []);
  const { data: setup } = useLive("pnl-setup", loadSetup, SETUP_TABLES);
  const loadProducers = useCallback((d: SupabaseClient) => loadLambCostSetup(d), []);
  const { data: lc } = useLive("lamb-cost-setup", loadProducers, ["producers", "lamb_cost_settings", "producer_rates"]);

  const head = (
    <div className="noprint">
      <WeekBar />
    </div>
  );
  if (error) return <>{head}<p className="note bad">Couldn&apos;t load the P&amp;L: {error}</p></>;
  if (!data || !setup || !lc) return <>{head}<p className="small muted">Loading...</p></>;

  const pays = data.sheets.sheets.map((s) => sheetPay(s, data.sheets.lambs, data.sheets.adjustments));
  const pay = weekPay(pays);
  const p = weekPnl({
    week,
    pay,
    income: data.income,
    expenses: data.expenses,
    categories: setup.categories,
    lambCharges: setup.lambCharges,
    percentCharges: setup.percentCharges,
  });
  const producerName = (id: string) => lc.producers.find((x) => x.id === id)?.name ?? "Unknown producer";

  return (
    <div className="max-w-[900px]">
      {head}
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0">
          Weekly P&amp;L · {weekName(week)}
          {data.inv != null && <span className="muted"> · INV# {data.inv}</span>}
        </h2>
        <button type="button" className="btn ghost noprint" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <p className="small muted mt-1">
        Thursday {niceDate(weekDays(week)[0])} to Wednesday {niceDate(weekDays(week)[6])}. Every entry counts toward the week
        that contains its date. A P&amp;L, not accounting: payments aren&apos;t tracked.
      </p>

      <Summary p={p} />

      <section className="panel mt-3" aria-labelledby="pnl-income">
        <h3 id="pnl-income">Income by customer</h3>
        {p.income.length === 0 ? (
          <p className="note mt-1 mb-0">No income entered.</p>
        ) : (
          <table className="simple mt-1">
            <tbody>
              {p.income.map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.name}
                    {r.entries > 1 && <span className="small muted"> · {r.entries} entries</span>}
                  </td>
                  <td className="num text-right">{centsText(r.cents)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td>Total income</td>
                <td className="num text-right">{centsText(p.incomeCents)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="panel mt-3" aria-labelledby="pnl-producers">
        <h3 id="pnl-producers">Producer cost</h3>
        {!p.hasSheets ? (
          <p className="note mt-1 mb-0">
            No weigh sheet for this week. <Link href="/weigh-sheets" className="noprint">Weigh sheets</Link>
          </p>
        ) : (
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
                    <td>{producerName(r.producerId)}</td>
                    <td className="num text-right">{r.head}</td>
                    <td className="num text-right">{carcassText(r.carcass)}</td>
                    <td className="num text-right">{liveText(r.live)}</td>
                    <td className="num text-right">{averageLbText(r.carcass, r.head)}</td>
                    <td className="num text-right">{centsText(r.cents)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td>Producer cost</td>
                  <td className="num text-right">{pay.head}</td>
                  <td className="num text-right">{carcassText(pay.carcass)}</td>
                  <td className="num text-right">{liveText(pay.live)}</td>
                  <td className="num text-right">{averageLbText(pay.carcass, pay.head)}</td>
                  <td className="num text-right">{centsText(pay.cents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel mt-3" aria-labelledby="pnl-charges">
        <h3 id="pnl-charges">Charges</h3>
        {p.charges.length === 0 ? (
          <p className="small muted mt-1 mb-0">No charges this week (P&amp;L Setup).</p>
        ) : (
          <table className="simple mt-1">
            <tbody>
              {p.charges.map((c) => (
                <tr key={`${c.kind}:${c.name}`}>
                  <td>
                    <b>{c.name}</b>
                    <span className="block small">
                      {c.kind === "lamb"
                        ? c.cents == null
                          ? "No weigh sheet for this week."
                          : `${c.lambs} lambs × ${rateText(c.rate)}`
                        : c.cents == null
                          ? "No income entered."
                          : `${factorText(c.percent)}% × ${centsText(c.income)} income`}
                    </span>
                  </td>
                  <td className="num text-right align-top">{c.cents == null ? <span className="muted">Not worked out</span> : centsText(c.cents)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td>Charges{p.charges.some((c) => c.cents == null) ? " so far" : ""}</td>
                <td className="num text-right">{centsText(p.chargeCents)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="panel mt-3" aria-labelledby="pnl-expenses">
        <h3 id="pnl-expenses">Expenses by category</h3>
        {p.expenses.length === 0 ? (
          <p className="small muted mt-1 mb-0">No expenses entered.</p>
        ) : (
          <table className="simple mt-1">
            <tbody>
              {p.expenses.map((r) => (
                <tr key={r.categoryId}>
                  <td>
                    {r.name}
                    {r.entries > 1 && <span className="small muted"> · {r.entries} entries</span>}
                  </td>
                  <td className="num text-right">{centsText(r.cents)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td>Entered expenses</td>
                <td className="num text-right">{centsText(p.expenseCents)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <Entries week={week} income={data.income} expenses={data.expenses} categories={setup.categories} refresh={refresh} />
    </div>
  );
}

/** Income, total expense, profit, per head, per carcass lb: or what's missing. */
function Summary({ p }: { p: WeekPnl }) {
  const waits = [!p.hasSheets && "No weigh sheet for this week.", !p.hasIncome && "No income entered."].filter(Boolean) as string[];
  const row = (label: string, value: React.ReactNode, strong = false) => (
    <tr className={strong ? "font-bold" : ""}>
      <td>{label}</td>
      <td className="num text-right">{value}</td>
    </tr>
  );
  const missing = <span className="muted">Not worked out</span>;
  return (
    <section className="panel mt-3" aria-labelledby="pnl-summary">
      <h3 id="pnl-summary">This week</h3>
      {waits.length > 0 && (
        <p className="note mt-1">
          {waits.join(" ")} Profit{p.hasSheets ? "" : ", total expense"}, profit per head and cost per carcass lb wait for
          both.
        </p>
      )}
      <table className="simple mt-1">
        <tbody>
          {row("Income", p.hasIncome ? centsText(p.incomeCents) : missing)}
          {row("Producer cost", p.hasSheets ? centsText(p.producerCents) : missing)}
          {row("Charges", centsText(p.chargeCents))}
          {row("Entered expenses", centsText(p.expenseCents))}
          {row("Total expense", p.totalExpense != null ? centsText(p.totalExpense) : missing, true)}
          {row("Profit", p.profit != null ? centsText(p.profit) : missing, true)}
          {row("Profit per head", p.profitPerHead != null ? `${centsText(p.profitPerHead)} (${p.head} head)` : missing)}
          {row("Cost per carcass lb", p.costPerCarcassLb != null ? `$${fixedRounded(p.costPerCarcassLb, 4, 2)}` : missing)}
        </tbody>
      </table>
    </section>
  );
}

// ----- Entering income and expenses (not printed) -----

function Entries({
  week,
  income,
  expenses,
  categories,
  refresh,
}: {
  week: string;
  income: IncomeEntry[];
  expenses: ExpenseEntry[];
  categories: ExpenseCategory[];
  refresh: () => void;
}) {
  const db = getDb();
  const toast = useToast();
  const { customers } = useStaffData();
  const days = weekDays(week);
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "Unknown category";
  const hasLocations = new Set((customers?.list ?? []).map((c) => c.parent_customer_id).filter(Boolean));
  const choices = customers
    ? sortByDisplayName(
        customers.list.filter((c) => c.active && !hasLocations.has(c.id)),
        customers.byId,
      )
    : [];

  const remove = async (table: "pnl_expenses" | "pnl_income", id: string, label: string) => {
    if (!confirm(`Delete ${label}?`)) return;
    const err = await deleteEntry(db, table, id);
    toast(err ? `Couldn't delete it: ${err}` : "Deleted");
    refresh();
  };

  return (
    <div className="noprint">
      <section className="panel mt-3" aria-labelledby="pnl-add-income">
        <h3 id="pnl-add-income">Income entries</h3>
        <p className="small muted mt-1">Until invoices are used here: what each customer paid for this week, entered by hand.</p>
        <EntryList
          rows={income.map((e) => ({ id: e.id, date: e.entry_date, what: e.customer_name, amount: e.amount, note: e.note }))}
          onDelete={(id, label) => void remove("pnl_income", id, label)}
        />
        <EntryForm
          days={days}
          whatLabel="Customer"
          options={choices.map((c) => ({ id: c.id, label: customers ? displayName(c, customers.byId) : c.name }))}
          onAdd={async (x) => {
            const err = await addIncome(db, { date: x.date, customerId: x.whatId, customerName: x.whatLabel, amount: x.amount, note: x.note });
            toast(err ? `Couldn't save: ${err}` : "Income saved");
            refresh();
            return !err;
          }}
        />
      </section>

      <section className="panel mt-3" aria-labelledby="pnl-add-expense">
        <h3 id="pnl-add-expense">Expense entries</h3>
        <p className="small muted mt-1">
          Butcher (Mohawk), labor, freight and anything else, as needed. Categories are in{" "}
          <Link href="/setup/lamb-cost">Setup &gt; P&amp;L Setup</Link>.
        </p>
        <EntryList
          rows={expenses.map((e) => ({ id: e.id, date: e.entry_date, what: catName(e.category_id), amount: e.amount, note: e.note }))}
          onDelete={(id, label) => void remove("pnl_expenses", id, label)}
        />
        <EntryForm
          days={days}
          whatLabel="Category"
          options={categories.filter((c) => c.active).map((c) => ({ id: c.id, label: c.name }))}
          onAdd={async (x) => {
            const err = await addExpense(db, { date: x.date, categoryId: x.whatId, amount: x.amount, note: x.note });
            toast(err ? `Couldn't save: ${err}` : "Expense saved");
            refresh();
            return !err;
          }}
        />
      </section>
    </div>
  );
}

function EntryList({
  rows,
  onDelete,
}: {
  rows: { id: string; date: string; what: string; amount: string | number; note: string }[];
  onDelete: (id: string, label: string) => void;
}) {
  if (rows.length === 0) return <p className="small m-0">None yet this week.</p>;
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((r) => {
        const amount = centsText(BigInt(Math.round(Number(r.amount) * 100)));
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 border-t border-line py-1.5">
            <span className="small muted w-24">{longDate(r.date).split(",")[0].slice(0, 3)} {niceDate(r.date)}</span>
            <span className="min-w-0 flex-1">
              {r.what}
              {r.note && <span className="small muted block">{r.note}</span>}
            </span>
            <span className="num">{amount}</span>
            <button type="button" className="copy min-h-[44px] px-2" onClick={() => onDelete(r.id, `${r.what} ${amount} on ${niceDate(r.date)}`)}>
              Delete
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EntryForm({
  days,
  whatLabel,
  options,
  onAdd,
}: {
  days: string[];
  whatLabel: string;
  options: { id: string; label: string }[];
  onAdd: (x: { date: string; whatId: string; whatLabel: string; amount: string; note: string }) => Promise<boolean>;
}) {
  const toast = useToast();
  const [date, setDate] = useState(days[4]); // the packing Monday
  const [whatId, setWhatId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const day = days.includes(date) ? date : days[4];

  const add = async () => {
    const v = parseMoney(amount);
    if (!whatId) return toast(`Pick the ${whatLabel.toLowerCase()}`);
    if (v == null) return toast("Type an amount like 1250.00");
    setBusy(true);
    const ok = await onAdd({ date: day, whatId, whatLabel: options.find((o) => o.id === whatId)?.label ?? "", amount: v, note });
    setBusy(false);
    if (ok) {
      setAmount("");
      setNote("");
    }
  };

  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label className="grid gap-1">
        <span className="lbl m-0">Date</span>
        <select className="field" value={day} onChange={(e) => setDate(e.target.value)}>
          {days.map((d) => (
            <option key={d} value={d}>
              {longDate(d)}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="lbl m-0">{whatLabel}</span>
        <select className="field max-w-[16rem]" value={whatId} onChange={(e) => setWhatId(e.target.value)}>
          <option value="">Pick one</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="lbl m-0">Amount ($)</span>
        <input className="field num w-28!" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="grid min-w-[8rem] flex-1 gap-1">
        <span className="lbl m-0">Note (optional)</span>
        <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit" className="btn" disabled={busy || !whatId || !amount.trim()}>
        Add
      </button>
    </form>
  );
}
