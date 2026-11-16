"use client";

// P&L stage B (Lucas, 11/15/26): adjustments and one-off lines. A calculated
// number is never changed in place: an adjustment is its own line with a
// reason (required) and an optional photo or PDF, and who and when come from
// the database. Adjustments are voided with a reason, never deleted.

import { useState } from "react";
import { getDb } from "@/components/data/StaffData";
import { useToast } from "@/components/Toast";
import { centsText } from "@/lib/calc/lambCost";
import { cents, parseMoney, type ExpenseCategory, type PnlAdjustment, type WeekPnl } from "@/lib/calc/pnl";
import { stamp } from "@/lib/calc/pnlDetail";
import { addAdjustment, fileLink, voidAdjustment } from "@/lib/db/pnl";
import { shrinkPhoto } from "@/lib/shrinkPhoto";

/** The lines an adjustment can be made to, as the P&L names them. */
export function lineOptions(p: WeekPnl, categories: ExpenseCategory[]): { key: string; label: string }[] {
  return [
    { key: "income", label: "Income" },
    { key: "producer", label: "Producer cost" },
    ...p.charges.map((c) => ({ key: `charge:${c.name}`, label: `Charge: ${c.name}` })),
    ...categories
      .filter((c) => c.active || p.expenses.some((r) => r.categoryId === c.id))
      .map((c) => ({ key: `category:${c.id}`, label: `Expense: ${c.name}` })),
  ];
}

/** What an adjustment adjusts, in words. */
export function lineLabel(a: PnlAdjustment, options: { key: string; label: string }[]): string {
  if (a.kind === "one_off") return a.side === "income" ? "One-off income" : "One-off expense";
  return options.find((o) => o.key === a.line_key)?.label ?? a.line_key ?? "";
}

/** Opens an attached file in a new tab (a short-lived private link). */
export function FileButton({ path, name }: { path: string; name: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="copy min-h-[44px] px-1"
      onClick={async () => {
        // Open the tab first (browsers block tabs opened after a wait), then point it at the file.
        const tab = window.open("", "_blank");
        const url = await fileLink(getDb(), path);
        if (!url) {
          tab?.close();
          return toast("Couldn't open the file.");
        }
        if (tab) tab.location.href = url;
        else window.location.href = url;
      }}
    >
      {name || "Attachment"}
    </button>
  );
}

/** A photo or PDF picked for an adjustment or an expense. */
export function FilePick({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  return (
    <label className="grid gap-1">
      <span className="lbl m-0">Photo or PDF (optional)</span>
      <input type="file" className="field" accept="image/*,application/pdf" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file && <span className="small muted">{file.name}</span>}
    </label>
  );
}

/**
 * Add an adjustment to a line (lineKey fixed, or picked from the list), or a
 * one-off income or expense line (oneOff).
 */
export function AdjustForm({
  week,
  options,
  lineKey,
  oneOff = false,
  onSaved,
}: {
  week: string;
  options: { key: string; label: string }[];
  /** A fixed line, or "category" to pick an expense category, or none to pick any line. */
  lineKey?: string;
  oneOff?: boolean;
  onSaved: () => void;
}) {
  const db = getDb();
  const toast = useToast();
  const choices = lineKey === "category" ? options.filter((o) => o.key.startsWith("category:")) : options;
  const fixed = lineKey && lineKey !== "category" ? lineKey : "";
  const [line, setLine] = useState(fixed);
  const [side, setSide] = useState<"income" | "expense">("expense");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const key = fixed || line;

  const save = async () => {
    const v = parseMoney(amount);
    if (!oneOff && !key) return toast("Pick the line to adjust");
    if (oneOff && !label.trim()) return toast("Type a name for the line");
    if (v == null) return toast("Type an amount like -250.00 or 125.50");
    if (!reason.trim()) return toast("Type a reason");
    setBusy(true);
    const err = await addAdjustment(db, {
      week,
      kind: oneOff ? "one_off" : "adjustment",
      lineKey: oneOff ? null : key,
      side: oneOff ? side : key === "income" ? "income" : "expense",
      label,
      amount: v,
      reason,
      file: file ? { blob: await shrinkPhoto(file), name: file.name } : null,
    });
    setBusy(false);
    toast(err ? `Couldn't save: ${err}` : oneOff ? "One-off line added" : "Adjustment added");
    if (!err) {
      setAmount("");
      setReason("");
      setLabel("");
      setFile(null);
      onSaved();
    }
  };

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {oneOff ? (
        <div className="flex flex-wrap gap-2">
          <label className="grid gap-1">
            <span className="lbl m-0">Income or expense</span>
            <select className="field" value={side} onChange={(e) => setSide(e.target.value as "income" | "expense")}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
          <label className="grid min-w-[12rem] flex-1 gap-1">
            <span className="lbl m-0">Name</span>
            <input className="field" placeholder="Freight bill (Heritage)" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
        </div>
      ) : (
        !fixed && (
          <label className="grid gap-1">
            <span className="lbl m-0">Line</span>
            <select className="field" value={line} onChange={(e) => setLine(e.target.value)}>
              <option value="">Pick a line</option>
              {choices.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )
      )}
      <div className="flex flex-wrap gap-2">
        <label className="grid gap-1">
          <span className="lbl m-0">Amount ($){oneOff ? "" : ", + adds, − takes off"}</span>
          <input className="field num w-32!" inputMode="decimal" placeholder={oneOff ? "412.50" : "-250.00"} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="grid min-w-[12rem] flex-1 gap-1">
          <span className="lbl m-0">Reason (required)</span>
          <input className="field" placeholder={oneOff ? "Bill #4471" : "Dock: 2 lambs condemned at Mohawk"} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <FilePick file={file} onFile={setFile} />
      <div>
        <button type="submit" className="btn" disabled={busy || !amount.trim() || !reason.trim()}>
          {busy ? "Saving..." : oneOff ? "Add one-off line" : "Add adjustment"}
        </button>
      </div>
    </form>
  );
}

/** The week's adjustments and one-off lines, voided ones too, with Void; and the two forms. */
export function AdjustmentsPanel({
  week,
  p,
  categories,
  refresh,
}: {
  week: string;
  p: WeekPnl;
  categories: ExpenseCategory[];
  refresh: () => void;
}) {
  const db = getDb();
  const toast = useToast();
  const options = lineOptions(p, categories);
  const [form, setForm] = useState<"" | "adjust" | "oneoff">("");
  const voidIt = async (a: PnlAdjustment) => {
    const why = prompt(`Void this ${a.kind === "one_off" ? "line" : "adjustment"} (${centsText(cents(a.amount))}, ${a.reason})? Type why:`);
    if (why == null) return;
    if (!why.trim()) return toast("Type why it's being voided");
    const err = await voidAdjustment(db, a.id, why);
    toast(err ? `Couldn't void it: ${err}` : "Voided");
    refresh();
  };

  return (
    <section className="panel mt-3" aria-labelledby="pnl-adjustments">
      <h3 id="pnl-adjustments">Adjustments and one-off lines</h3>
      <p className="small muted mt-1">
        A correction to a line goes here with a reason; the calculated number is never changed. A one-off line is income or an
        expense that has no category (a freight bill, a credit). They can be voided, not deleted.
      </p>
      {p.adjustments.length === 0 ? (
        <p className="small m-0">None this week.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {p.adjustments.map((a) => (
            <li key={a.id} className={`border-t border-line py-1.5 ${a.voided_at ? "muted" : ""}`}>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="min-w-0 flex-1">
                  <b className={a.voided_at ? "line-through" : ""}>{lineLabel(a, options)}</b>
                  {a.kind === "one_off" && <span>: {a.label}</span>}
                  {a.voided_at && <span className="tag ml-2">Voided</span>}
                </span>
                <span className={`num ${a.voided_at ? "line-through" : ""}`}>
                  {a.kind === "adjustment" && cents(a.amount) > BigInt(0) ? "+" : ""}
                  {cents(a.amount) < BigInt(0) ? `-${centsText(-cents(a.amount))}` : centsText(cents(a.amount))}
                </span>
                {!a.voided_at && (
                  <button type="button" className="copy noprint min-h-[44px] px-2" onClick={() => void voidIt(a)}>
                    Void
                  </button>
                )}
              </div>
              <div className="small">{a.reason}</div>
              <div className="small muted">
                Added by {a.created_by_name || "someone"}, {stamp(a.created_at)}
                {a.voided_at && ` · Voided by ${a.voided_by_name || "someone"}, ${stamp(a.voided_at)}: ${a.void_reason}`}
              </div>
              {a.attachment_path && (
                <div className="noprint">
                  <FileButton path={a.attachment_path} name={a.attachment_name} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="noprint mt-2 flex flex-wrap gap-2">
        <button type="button" className={form === "adjust" ? "btn" : "btn ghost"} onClick={() => setForm(form === "adjust" ? "" : "adjust")}>
          Adjust a line
        </button>
        <button type="button" className={form === "oneoff" ? "btn" : "btn ghost"} onClick={() => setForm(form === "oneoff" ? "" : "oneoff")}>
          Add a one-off line
        </button>
      </div>
      {form && (
        <div className="noprint mt-2 border-t border-line pt-2">
          <AdjustForm key={form} week={week} options={options} oneOff={form === "oneoff"} onSaved={refresh} />
        </div>
      )}
    </section>
  );
}
