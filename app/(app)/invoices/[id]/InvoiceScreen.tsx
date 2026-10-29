"use client";

// One invoice (SPEC 15, stage 2): the printable invoice, and on a draft the
// changes: invoice date, number, a note for the customer, a discount on any
// line (with a note), lines added by hand (a fee or a credit, with a note),
// Update from packing, and Delete draft.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { useWeek } from "@/components/Week";
import { parseDiscount, type PricedLine } from "@/lib/calc/invoice";
import { centsText, lineTotalCents, parsePrice, priceText } from "@/lib/calc/prices";
import { isISODate, weekName } from "@/lib/dates";
import { addManualLine, deleteDraft, deleteLine, loadInvoice, setLineDiscount, updateDraft, updateInvoice, type InvoiceRow } from "@/lib/db/invoices";
import InvoiceSheet from "../InvoiceSheet";
import { sheetFor } from "../sheet";
import { useInvoiceWeek } from "../useInvoiceWeek";

export default function InvoiceScreen({ id }: { id: string }) {
  // Wrapped, so "loading" (null) and "not there" (row null) differ.
  const load = useCallback(async (db: SupabaseClient) => ({ row: await loadInvoice(db, id) }), [id]);
  const { data, error } = useLive(`invoice-${id}`, load, ["invoices"]);
  if (error) return <p className="note bad">Couldn&apos;t load the invoice: {error}</p>;
  if (!data) return <div className="empty">Loading...</div>;
  const inv = data.row;
  if (!inv)
    return (
      <div className="empty">
        This invoice isn&apos;t there any more. <Link href="/invoices">Back to invoices</Link>
      </div>
    );
  return <InvoiceView id={id} week={inv.week_id} />;
}

function InvoiceView({ id, week }: { id: string; week: string }) {
  const db = getDb();
  const toast = useToast();
  const router = useRouter();
  const { setWeek } = useWeek();
  const { catalog, customers } = useStaffData();
  const canEdit = useCan("invoices").change;
  const { data, error, refresh } = useInvoiceWeek(week);
  const [busy, setBusy] = useState(false);

  if (error) return <p className="note bad">Couldn&apos;t load the invoice: {error}</p>;
  if (!data || !customers) return <div className="empty">Loading...</div>;
  const inv = data.invoices.find((i) => i.id === id);
  if (!inv) return <div className="empty">Loading...</div>;

  const sheet = sheetFor(data, inv, customers, catalog);
  const draft = inv.status === "draft";
  const editable = canEdit && draft;
  const outOfDate = data.outOfDate.has(inv.id);
  const after = (err: string | null, ok: string) => {
    toast(err ? `Couldn't save: ${err}` : ok);
    refresh();
    return !err;
  };

  const update = async () => {
    setBusy(true);
    after(await updateDraft(db, inv.id), "Updated from packing");
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm(`Delete the draft for ${sheet.customerName}? Make drafts makes it again from packing.`)) return;
    const err = await deleteDraft(db, inv.id);
    if (err) return after(err, "");
    toast("Draft deleted");
    setWeek(week);
    router.push("/invoices");
  };

  return (
    <>
      <div className="screen-only">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/invoices" className="btn ghost" onClick={() => setWeek(week)}>
            &larr; Invoices
          </Link>
          <h2 className="mr-auto">
            {sheet.customerName} · {weekName(week)}
          </h2>
          <button type="button" className="btn" onClick={() => window.print()}>
            Print
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              toast('In the print window, choose "Save as PDF" as the printer.');
              setTimeout(() => window.print(), 600);
            }}
          >
            Save as PDF
          </button>
        </div>

        {outOfDate && (
          <p className="note warn mt-2" role="alert">
            <b>Out of date.</b> Packing changed after this draft was made (a box moved, added or reweighed).{" "}
            {editable ? "Update it to bill what's packed now. Lines you added and discounts are kept." : ""}
          </p>
        )}

        {editable && (
          <section className="panel mt-2">
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1">
                <span className="lbl m-0">Invoice date</span>
                <input
                  key={`date:${inv.invoice_date}`}
                  type="date"
                  className="field"
                  defaultValue={inv.invoice_date}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (!isISODate(v)) {
                      e.target.value = inv.invoice_date;
                      return;
                    }
                    if (v !== inv.invoice_date) void updateInvoice(db, inv.id, { invoice_date: v }).then((err) => after(err, "Date saved. Prices are from this date."));
                  }}
                />
              </label>
              <NumberField inv={inv} onSaved={after} />
              <div className="ml-auto flex flex-wrap gap-2">
                <button type="button" className={outOfDate ? "btn" : "btn ghost"} disabled={busy} onClick={() => void update()}>
                  Update from packing
                </button>
                <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove()}>
                  Delete draft
                </button>
              </div>
            </div>
            <label className="mt-3 grid gap-1">
              <span className="lbl m-0">Note for the customer (prints on the invoice)</span>
              <textarea
                key={`memo:${inv.memo}`}
                className="field"
                rows={2}
                defaultValue={inv.memo}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== inv.memo) void updateInvoice(db, inv.id, { memo: v }).then((err) => after(err, "Saved"));
                }}
              />
            </label>
            <h3 className="mt-3">Discounts and lines you add</h3>
            <p className="small muted mt-1">
              Quantities come from packing. To change one, fix it on Packing, then Update from packing. A discount is a dollar amount
              (5.00) or a percent (10%), and needs a note.
            </p>
            <ul className="m-0 mt-1 grid list-none gap-2 p-0">
              {sheet.lines
                .filter((l) => l.kind !== "shorted")
                .map((l) => (
                  <LineEdit key={`${l.id}:${l.discount_kind}:${l.discount}:${l.note}`} line={l} onSaved={after} />
                ))}
            </ul>
            <AddLine invoiceId={inv.id} nextSort={Math.max(0, ...inv.invoice_lines.map((l) => l.sort)) + 1} onSaved={after} />
          </section>
        )}
      </div>
      <InvoiceSheet {...sheet} />
    </>
  );
}

function NumberField({ inv, onSaved }: { inv: InvoiceRow; onSaved: (err: string | null, ok: string) => boolean }) {
  const db = getDb();
  return (
    <label className="grid gap-1">
      <span className="lbl m-0">Invoice number</span>
      <input
        key={`num:${inv.number ?? ""}`}
        className="field w-40!"
        defaultValue={inv.number ?? ""}
        placeholder="Number needed"
        onBlur={(e) => {
          const el = e.target;
          const v = el.value.trim().toUpperCase();
          if (v === (inv.number ?? "")) return;
          void updateInvoice(db, inv.id, { number: v || null }).then((err) => {
            if (err) el.value = inv.number ?? "";
            onSaved(err, "Invoice number saved");
          });
        }}
      />
    </label>
  );
}

function LineEdit({ line: l, onSaved }: { line: PricedLine; onSaved: (err: string | null, ok: string) => boolean }) {
  const db = getDb();
  const toast = useToast();
  const start = l.discount == null ? "" : l.discount_kind === "percent" ? `${Number(l.discount)}%` : String(Number(l.discount));
  const [disc, setDisc] = useState(start);
  const [note, setNote] = useState(l.note);
  const [open, setOpen] = useState(false);
  const changed = disc.trim() !== start || note.trim() !== l.note;

  const save = async () => {
    const d = disc.trim() ? parseDiscount(disc) : null;
    if (disc.trim() && !d) return toast("Type a discount like 5.00 or 10%");
    if (d && !note.trim()) return toast("A discount needs a note");
    if (d?.kind === "amount" && l.grossCents != null && lineTotalCents(1, d.value) > l.grossCents)
      return toast("The discount is more than the line");
    if (l.kind === "manual" && !note.trim()) return toast("A line you add needs a note");
    if (onSaved(await setLineDiscount(db, l.id, d, note.trim()), "Saved")) setOpen(false);
  };
  const remove = async () => {
    if (!confirm(`Remove "${l.description}" from this invoice?`)) return;
    onSaved(await deleteLine(db, l.id), "Line removed");
  };

  return (
    <li className="rounded border border-line p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b className="mr-auto">{l.description}</b>
        <span className="num">
          {l.totalCents != null ? centsText(l.totalCents) : l.priceNeeded ? "Price needed" : "Count needed"}
          {l.discountCents > BigInt(0) && <span className="small muted"> (less {centsText(l.discountCents)})</span>}
        </span>
        {l.kind === "manual" && <span className="small muted">Added by hand, {priceText(l.price ?? 0)} each</span>}
        <button type="button" className="copy min-h-[44px] px-2" onClick={() => setOpen(!open)}>
          {open ? "Close" : l.discount != null ? "Change discount" : l.kind === "manual" ? "Change note" : "Discount"}
        </button>
        {l.kind === "manual" && (
          <button type="button" className="copy min-h-[44px] px-2" onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
      {open && (
        <form
          className="mt-1 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-1">
            <span className="lbl m-0">Discount</span>
            <input className="field num w-28!" value={disc} placeholder="5.00 or 10%" onChange={(e) => setDisc(e.target.value)} />
          </label>
          <label className="grid flex-1 gap-1">
            <span className="lbl m-0">Note (why)</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" className="btn ghost" disabled={!changed}>
            Save
          </button>
          {l.discount != null && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => void setLineDiscount(db, l.id, null, l.kind === "manual" ? l.note : "").then((err) => onSaved(err, "Discount removed"))}
            >
              No discount
            </button>
          )}
        </form>
      )}
    </li>
  );
}

function AddLine({ invoiceId, nextSort, onSaved }: { invoiceId: string; nextSort: number; onSaved: (err: string | null, ok: string) => boolean }) {
  const db = getDb();
  const toast = useToast();
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [credit, setCredit] = useState(false);

  const add = async () => {
    const q = parsePrice(qty);
    const p = parsePrice(price);
    if (!desc.trim()) return toast("What is it? (for example Delivery)");
    if (!q || Number(q) <= 0) return toast("Type how many, like 1");
    if (!p) return toast("Type a price like 25.00");
    if (!note.trim()) return toast("A line you add needs a note");
    const ok = onSaved(
      await addManualLine(db, invoiceId, { description: desc.trim(), quantity: q, unitPrice: credit ? `-${p}` : p, note: note.trim(), sort: nextSort }),
      credit ? "Credit added" : "Line added",
    );
    if (ok) {
      setDesc("");
      setQty("1");
      setPrice("");
      setNote("");
      setCredit(false);
    }
  };

  return (
    <details className="mt-3">
      <summary className="copy">Add a line (a fee, or a credit)</summary>
      <form
        className="mt-1 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="grid gap-1">
          <span className="lbl m-0">What</span>
          <input className="field" value={desc} placeholder="Delivery" onChange={(e) => setDesc(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">How many</span>
          <input className="field num w-20!" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Price each</span>
          <input className="field num w-28!" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="checkbox" className="h-6 w-6 accent-forest" checked={credit} onChange={(e) => setCredit(e.target.checked)} />
          It&apos;s a credit (takes money off)
        </label>
        <label className="grid flex-1 gap-1">
          <span className="lbl m-0">Note (why)</span>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn ghost">
          Add
        </button>
      </form>
    </details>
  );
}
