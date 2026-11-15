"use client";

// P&L Setup, stage 3 cards (SPEC 16.6): charges worked out each week (per
// lamb, like ALB/OSC; percent of income, like Marketing), each from a date
// on, and the expense categories. Admins only.

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { factorText, parseRate, rateText } from "@/lib/calc/lambCost";
import { chargesOn, type ExpenseCategory } from "@/lib/calc/pnl";
import { niceDate, todayISO, packingMonday } from "@/lib/dates";
import { addLambCharge, addPercentCharge, deleteCharge, loadPnlSetup, saveCategory, type PnlSetup } from "@/lib/db/pnl";

const TABLES = ["pnl_lamb_charges", "pnl_percent_charges", "expense_categories"];
const dateText = (d: string) => `${niceDate(d)}, ${d.slice(0, 4)}`;

export default function PnlSetupCards() {
  const load = useCallback((d: SupabaseClient) => loadPnlSetup(d), []);
  const { data, refresh, error } = useLive("pnl-setup", load, TABLES);
  const toast = useToast();
  if (error) return <p className="note bad mt-3">Couldn&apos;t load the P&amp;L charges: {error}</p>;
  if (!data) return <p className="small muted mt-3">Loading...</p>;
  const after = (err: string | null, ok: string) => {
    toast(err ? `Couldn't save: ${err}` : ok);
    refresh();
    return !err;
  };
  return (
    <>
      <Charges data={data} kind="lamb" after={after} />
      <Charges data={data} kind="percent" after={after} />
      <Categories categories={data.categories} after={after} />
    </>
  );
}

type After = (err: string | null, ok: string) => boolean;

/** "$1.80 per lamb" or "4%". */
const amountText = (kind: "lamb" | "percent", v: string | number) => (kind === "lamb" ? `${rateText(v)} per lamb` : `${factorText(v)}%`);

function Charges({ data, kind, after }: { data: PnlSetup; kind: "lamb" | "percent"; after: After }) {
  const db = getDb();
  const toast = useToast();
  type Row = { id: string; name: string; effective_from: string; note: string; value: string | number };
  const rows: Row[] =
    kind === "lamb"
      ? data.lambCharges.map((r) => ({ id: r.id, name: r.name, effective_from: r.effective_from, note: r.note, value: r.per_lamb }))
      : data.percentCharges.map((r) => ({ id: r.id, name: r.name, effective_from: r.effective_from, note: r.note, value: r.percent }));
  const names = [...new Set(rows.map((r) => r.name))].sort();
  const thisWeek = packingMonday(todayISO());
  const current = new Map(chargesOn(rows, thisWeek, (r) => r.value).map((r) => [r.name, r]));
  const [name, setName] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const title = kind === "lamb" ? "Charges per lamb" : "Charges as a percent of income";
  const help =
    kind === "lamb"
      ? "Times the week's lambs on the weigh sheets (ALB/OSC: 103 lambs × $1.80)."
      : "Times the week's income (Marketing: 4% of the week's income).";

  const add = async () => {
    const v = parseRate(value);
    if (!name.trim()) return toast("Type the charge's name");
    if (v == null) return toast(kind === "lamb" ? "Type the amount like 1.80" : "Type the percent like 4");
    if (kind === "percent" && Number(v) > 100) return toast("A percent is from 0 to 100");
    const err =
      kind === "lamb"
        ? await addLambCharge(db, { name, from, perLamb: v, note })
        : await addPercentCharge(db, { name, from, percent: v, note });
    if (after(err, `Saved: ${name.trim()} ${amountText(kind, v)} from ${niceDate(from)}`)) {
      setValue("");
      setNote("");
    }
  };
  const remove = async (id: string, label: string) => {
    if (!confirm(`Delete ${label}?`)) return;
    after(await deleteCharge(db, kind === "lamb" ? "pnl_lamb_charges" : "pnl_percent_charges", id), "Deleted");
  };

  return (
    <section className="panel mt-3" aria-labelledby={`pnl-${kind}`}>
      <h3 id={`pnl-${kind}`}>{title}</h3>
      <p className="small muted mt-1">
        {help} Each change applies from its start date on. To stop a charge, add 0 from a date.
      </p>
      {names.length === 0 && <p className="small m-0">None yet.</p>}
      <ul className="m-0 list-none p-0">
        {names.map((n) => {
          const now = current.get(n);
          return (
            <li key={n} className="border-t border-line py-1.5">
              <b>{n}</b>
              <span className="small muted"> · {now ? `this week ${amountText(kind, now.value)}` : "not charged this week"}</span>
              <ul className="small m-0 list-none p-0">
                {rows
                  .filter((r) => r.name === n)
                  .map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3">
                      <span className="num">{amountText(kind, r.value)}</span>
                      <span className="muted">from {dateText(r.effective_from)}</span>
                      {r.note && <span className="muted">{r.note}</span>}
                      <button type="button" className="copy min-h-[44px] px-2" onClick={() => void remove(r.id, `${n} from ${dateText(r.effective_from)}`)}>
                        Delete
                      </button>
                    </li>
                  ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <form
        className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="grid gap-1">
          <span className="lbl m-0">Name</span>
          <input className="field w-40!" list={`pnl-names-${kind}`} value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id={`pnl-names-${kind}`}>
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Starts on</span>
          <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">{kind === "lamb" ? "$ per lamb" : "Percent"}</span>
          <input className="field num w-24!" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="grid min-w-[8rem] flex-1 gap-1">
          <span className="lbl m-0">Note (optional)</span>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn ghost" disabled={!name.trim() || !value.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

function Categories({ categories, after }: { categories: ExpenseCategory[]; after: After }) {
  const db = getDb();
  const [adding, setAdding] = useState("");
  const on = categories.filter((c) => c.active);
  const off = categories.filter((c) => !c.active);
  const nextSort = categories.reduce((m, c) => Math.max(m, c.sort), 0) + 1;

  const row = (c: ExpenseCategory) => (
    <li key={c.id} className="flex flex-wrap items-center gap-2 border-t border-line py-1.5">
      <input
        className="field min-w-[12rem] flex-1"
        aria-label={`Name of ${c.name}`}
        defaultValue={c.name}
        key={c.name}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (!v) e.target.value = c.name;
          else if (v !== c.name) void saveCategory(db, { id: c.id, name: v, active: c.active }).then((err) => after(err, `Renamed to ${v}`));
        }}
      />
      <button
        type="button"
        className="btn ghost"
        onClick={() => void saveCategory(db, { id: c.id, name: c.name, active: !c.active }).then((err) => after(err, c.active ? `${c.name} retired` : `${c.name} back in use`))}
      >
        {c.active ? "Retire" : "Use again"}
      </button>
    </li>
  );

  return (
    <section className="panel mt-3" aria-labelledby="pnl-cats">
      <h3 id="pnl-cats">Expense categories</h3>
      <p className="small muted mt-1">
        What expenses are entered under on the weekly P&amp;L. Retire one you no longer use; its past expenses still show.
      </p>
      <ul className="m-0 list-none p-0">{on.map(row)}</ul>
      {off.length > 0 && (
        <details className="mt-2">
          <summary className="copy">Retired ({off.length})</summary>
          <ul className="m-0 list-none p-0">{off.map(row)}</ul>
        </details>
      )}
      <form
        className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!adding.trim()) return;
          void saveCategory(db, { name: adding, active: true, sort: nextSort }).then((err) => {
            if (after(err, `Added ${adding.trim()}`)) setAdding("");
          });
        }}
      >
        <label className="grid min-w-[12rem] flex-1 gap-1">
          <span className="lbl m-0">New category</span>
          <input className="field" value={adding} onChange={(e) => setAdding(e.target.value)} />
        </label>
        <button type="submit" className="btn ghost" disabled={!adding.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}
