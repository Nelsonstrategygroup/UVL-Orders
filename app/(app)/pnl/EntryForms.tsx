"use client";

// Weekly P&L entries (Lucas, 11/17/26, moved off the summary page): other
// income and expense entries typed in by hand, with their files. Shown on the
// Entries page for the week (/pnl/entries).

import { useState } from "react";
import Link from "next/link";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useToast } from "@/components/Toast";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import { centsText } from "@/lib/calc/lambCost";
import { parseMoney, type ExpenseCategory, type ExpenseEntry, type IncomeEntry } from "@/lib/calc/pnl";
import { longDate, niceDate, weekDays } from "@/lib/dates";
import { addExpense, addExpenseFile, addIncome, deleteEntry } from "@/lib/db/pnl";
import { shrinkPhoto } from "@/lib/shrinkPhoto";
import { FileButton } from "./Adjustments";

export function Entries({
  week,
  income,
  expenses,
  files,
  categories,
  refresh,
  readOnly = false,
}: {
  week: string;
  income: IncomeEntry[];
  expenses: ExpenseEntry[];
  files: { id: string; expense_id: string; path: string; name: string }[];
  categories: ExpenseCategory[];
  refresh: () => void;
  /** A closed week: listed, not changed. */
  readOnly?: boolean;
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
        <h3 id="pnl-add-income">Other income</h3>
        <p className="small muted mt-1">
          Income that isn&apos;t on an invoice, entered by hand. Invoices are counted already: don&apos;t enter them here.
        </p>
        <EntryList
          rows={income.map((e) => ({ id: e.id, date: e.entry_date, what: e.customer_name, amount: e.amount, note: e.note }))}
          onDelete={readOnly ? undefined : (id, label) => void remove("pnl_income", id, label)}
        />
        {!readOnly && (<EntryForm
          days={days}
          whatLabel="Customer"
          options={choices.map((c) => ({ id: c.id, label: customers ? displayName(c, customers.byId) : c.name }))}
          onAdd={async (x) => {
            const err = await addIncome(db, { date: x.date, customerId: x.whatId, customerName: x.whatLabel, amount: x.amount, note: x.note });
            toast(err ? `Couldn't save: ${err}` : "Income saved");
            refresh();
            return !err;
          }}
        />)}
      </section>

      <section className="panel mt-3" aria-labelledby="pnl-add-expense">
        <h3 id="pnl-add-expense">Expense entries</h3>
        <p className="small muted mt-1">
          Butcher (Mohawk), labor, freight and anything else, as needed. Categories are in{" "}
          <Link href="/setup/lamb-cost">Setup &gt; P&amp;L Setup</Link>.
        </p>
        <EntryList
          rows={expenses.map((e) => ({ id: e.id, date: e.entry_date, what: catName(e.category_id), amount: e.amount, note: e.note }))}
          files={files}
          onAttach={readOnly ? undefined : async (id, file) => {
            const err = await addExpenseFile(db, week, id, { blob: await shrinkPhoto(file), name: file.name });
            toast(err ? `Couldn't attach it: ${err}` : "Attached");
            refresh();
          }}
          onDelete={readOnly ? undefined : (id, label) => void remove("pnl_expenses", id, label)}
        />
        {!readOnly && (<EntryForm
          days={days}
          whatLabel="Category"
          options={categories.filter((c) => c.active && c.method === "entered").map((c) => ({ id: c.id, label: c.name }))}
          onAdd={async (x) => {
            const err = await addExpense(db, { date: x.date, categoryId: x.whatId, amount: x.amount, note: x.note });
            toast(err ? `Couldn't save: ${err}` : "Expense saved");
            refresh();
            return !err;
          }}
        />)}
      </section>
    </div>
  );
}

function EntryList({
  rows,
  onDelete,
  files,
  onAttach,
}: {
  rows: { id: string; date: string; what: string; amount: string | number; note: string }[];
  onDelete?: (id: string, label: string) => void;
  /** Expense entries: their files, and attaching one. */
  files?: { id: string; expense_id: string; path: string; name: string }[];
  onAttach?: (id: string, file: File) => Promise<void>;
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
              {files
                ?.filter((x) => x.expense_id === r.id)
                .map((x) => (
                  <span key={x.id} className="small block">
                    <FileButton path={x.path} name={x.name} />
                  </span>
                ))}
            </span>
            <span className="num">{amount}</span>
            {onAttach && (
              <label className="copy min-h-[44px] cursor-pointer px-2">
                Attach
                <input
                  type="file"
                  className="sr-only"
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void onAttach(r.id, file);
                  }}
                />
              </label>
            )}
            {onDelete && <button type="button" className="copy min-h-[44px] px-2" onClick={() => onDelete(r.id, `${r.what} ${amount} on ${niceDate(r.date)}`)}>
              Delete
            </button>}
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
