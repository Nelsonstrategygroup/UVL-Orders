"use client";

// One invoice (SPEC 15, stages 2 and 3): the printable invoice. On a draft:
// invoice date, number, a note for the customer, a discount on any line (with
// a note), lines added by hand (a fee or a credit, with a note), Update from
// packing, Delete draft, and Finalize (once every line has a price and a
// count). Once finalized: the date and number, Mark sent, payments, and Void
// (with a reason). A void invoice can be reissued as a new draft (-R1).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { useWeek } from "@/components/Week";
import { invoiceState, invoiceTotals, paidCents, parseDiscount, STATE_LABEL, type PricedLine } from "@/lib/calc/invoice";
import { centsText, lineTotalCents, parsePrice, priceText } from "@/lib/calc/prices";
import { ago, isISODate, niceDate, todayISO, weekName } from "@/lib/dates";
import {
  addManualLine,
  addPayment,
  deleteDraft,
  deleteLine,
  deletePayment,
  finalizeInvoice,
  loadInvoice,
  markSent,
  reissueInvoice,
  setLineDiscount,
  updateDraft,
  updateInvoice,
  voidInvoice,
  type InvoiceRow,
  type PaymentMethod,
} from "@/lib/db/invoices";
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
  const t = invoiceTotals(sheet.lines);
  const draft = inv.status === "draft";
  const issued = inv.status === "finalized" || inv.status === "sent";
  const editable = canEdit && draft;
  const outOfDate = data.outOfDate.has(inv.id);
  const replaces = inv.replaces_id ? data.invoices.find((i) => i.id === inv.replaces_id) : undefined;
  const replacedBy = data.invoices.find((i) => i.replaces_id === inv.id);
  const live = data.invoices.find((i) => i.customer_id === inv.customer_id && i.status !== "void");
  const after = (err: string | null, ok: string) => {
    toast(err ? `Couldn't save: ${err}` : ok);
    refresh();
    return !err;
  };
  const run = async (f: () => Promise<string | null>, ok: string) => {
    setBusy(true);
    const r = after(await f(), ok);
    setBusy(false);
    return r;
  };

  // What stops a draft being finalized, in plain words.
  const blockers = [
    !inv.number ? "It needs an invoice number." : "",
    outOfDate ? "Packing changed: Update from packing first." : "",
    t.priceNeeded ? `${t.priceNeeded} line${t.priceNeeded === 1 ? " has" : "s have"} no price (Setup > Prices).` : "",
    t.countNeeded ? `${t.countNeeded} line${t.countNeeded === 1 ? " needs" : "s need"} a count (on Packing).` : "",
  ].filter(Boolean);

  const remove = async () => {
    if (!confirm(`Delete the draft for ${sheet.customerName}? Make drafts makes it again from packing.`)) return;
    const err = await deleteDraft(db, inv.id);
    if (err) return after(err, "");
    toast("Draft deleted");
    setWeek(week);
    router.push("/invoices");
  };
  const finalize = async () => {
    if (
      !confirm(
        `Finalize ${inv.number} for ${centsText(t.totalCents)}? After this its lines can't change; a mistake is fixed by voiding it and reissuing.`,
      )
    )
      return;
    await run(() => finalizeInvoice(db, inv.id), "Finalized");
  };
  const reissue = async () => {
    setBusy(true);
    const r = await reissueInvoice(db, inv.id);
    setBusy(false);
    if (r.error || !r.id) return after(r.error ?? "Couldn't reissue.", "");
    toast("Reissued as a new draft");
    router.push(`/invoices/${r.id}`);
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

        <p className="mt-1 mb-0">
          <b>{STATE_LABEL[invoiceState(inv.status, t.totalCents, paidCents(inv.payments))]}</b>
          {inv.finalized_at && <span className="small muted"> · finalized {ago(inv.finalized_at)}</span>}
          {inv.sent_at && <span className="small muted"> · sent {ago(inv.sent_at)}</span>}
          {replaces && (
            <span className="small">
              {" "}
              · replaces <Link href={`/invoices/${replaces.id}`}>{replaces.number ?? "the void invoice"}</Link>
            </span>
          )}
        </p>

        {outOfDate && (
          <p className="note warn mt-2" role="alert">
            <b>Out of date.</b> Packing changed after this draft was made (a box moved, added or reweighed).{" "}
            {editable ? "Update it to bill what's packed now. Lines you added and discounts are kept." : ""}
          </p>
        )}
        {data.changedSince.has(inv.id) && (
          <p className="note warn mt-2" role="alert">
            Packing changed after this invoice was finalized. It still bills what it was finalized with. If that&apos;s wrong, void it
            and reissue.
          </p>
        )}

        {inv.status === "void" && (
          <section className="panel mt-2">
            <p className="m-0">
              <b>Void</b>
              {inv.void_reason ? `: ${inv.void_reason}` : ""}. Nothing is owed on it.
            </p>
            {replacedBy ? (
              <p className="mb-0">
                Reissued as <Link href={`/invoices/${replacedBy.id}`}>{replacedBy.number ?? "a new invoice"}</Link>.
              </p>
            ) : live ? (
              <p className="mb-0">
                This location has another invoice this week: <Link href={`/invoices/${live.id}`}>{live.number ?? "open it"}</Link>.
              </p>
            ) : (
              canEdit && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button type="button" className="btn" disabled={busy} onClick={() => void reissue()}>
                    Reissue
                  </button>
                  <span className="small muted">
                    A new draft from packing as it is now, numbered -R, with the same added lines and discounts.
                  </span>
                </div>
              )
            )}
          </section>
        )}

        {canEdit && (draft || issued) && (
          <section className="panel mt-2">
            <div className="flex flex-wrap items-end gap-3">
              <DateField inv={inv} onSaved={after} />
              <NumberField inv={inv} onSaved={after} />
              {draft && (
                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={outOfDate ? "btn" : "btn ghost"}
                    disabled={busy}
                    onClick={() => void run(() => updateDraft(db, inv.id), "Updated from packing")}
                  >
                    Update from packing
                  </button>
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove()}>
                    Delete draft
                  </button>
                </div>
              )}
              {issued && (
                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={inv.status === "sent" ? "btn ghost" : "btn"}
                    disabled={busy}
                    onClick={() =>
                      void run(() => markSent(db, inv.id, inv.status !== "sent"), inv.status === "sent" ? "Marked not sent" : "Marked sent")
                    }
                  >
                    {inv.status === "sent" ? "Mark not sent" : "Mark sent"}
                  </button>
                </div>
              )}
            </div>
            {issued && <p className="small muted mt-1 mb-0">The due date follows the invoice date. Prices stay as finalized.</p>}

            {draft && (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="button" className="btn" disabled={busy || blockers.length > 0} onClick={() => void finalize()}>
                    Finalize
                  </button>
                  {blockers.length ? (
                    <span className="small">Not ready: {blockers.join(" ")}</span>
                  ) : (
                    <span className="small muted">Ready. After finalizing, the lines and prices can&apos;t change.</span>
                  )}
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
                  Quantities come from packing. To change one, fix it on Packing, then Update from packing. A discount is a dollar
                  amount (5.00) or a percent (10%), and needs a note.
                </p>
                <ul className="m-0 mt-1 grid list-none gap-2 p-0">
                  {sheet.lines
                    .filter((l) => l.kind !== "shorted")
                    .map((l) => (
                      <LineEdit key={`${l.id}:${l.discount_kind}:${l.discount}:${l.note}`} line={l} onSaved={after} />
                    ))}
                </ul>
                <AddLine invoiceId={inv.id} nextSort={Math.max(0, ...inv.invoice_lines.map((l) => l.sort)) + 1} onSaved={after} />
              </>
            )}
          </section>
        )}

        {issued && (
          <Payments
            inv={inv}
            balance={t.totalCents - paidCents(inv.payments)}
            canEdit={canEdit}
            onSaved={after}
            onVoid={(reason) => run(() => voidInvoice(db, inv.id, reason), "Voided")}
          />
        )}
      </div>
      <InvoiceSheet {...sheet} />
    </>
  );
}

function DateField({ inv, onSaved }: { inv: InvoiceRow; onSaved: (err: string | null, ok: string) => boolean }) {
  const db = getDb();
  return (
    <label className="grid gap-1">
      <span className="lbl m-0">Invoice date</span>
      <input
        key={`date:${inv.invoice_date}`}
        type="date"
        className="field"
        defaultValue={inv.invoice_date}
        // Saved as soon as a whole date is picked; a year still being typed (0202) isn't a date yet.
        onChange={(e) => {
          const v = e.target.value;
          if (!isISODate(v) || v < "2020-01-01" || v > "2100-12-31") return;
          if (v !== inv.invoice_date)
            void updateInvoice(db, inv.id, { invoice_date: v }).then((err) =>
              onSaved(err, inv.status === "draft" ? "Date saved. Prices are from this date." : "Date saved. The due date follows."),
            );
        }}
      />
    </label>
  );
}

const METHOD_LABEL: Record<PaymentMethod, string> = { ach: "ACH (bank)", check: "Check", other: "Other" };

function Payments({
  inv,
  balance,
  canEdit,
  onSaved,
  onVoid,
}: {
  inv: InvoiceRow;
  balance: bigint;
  canEdit: boolean;
  onSaved: (err: string | null, ok: string) => boolean;
  onVoid: (reason: string) => Promise<boolean>;
}) {
  const db = getDb();
  const toast = useToast();
  const [paidOn, setPaidOn] = useState(todayISO());
  const [amount, setAmount] = useState(balance > BigInt(0) ? centsText(balance).replace(/[$,]/g, "") : "");
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);

  const add = async () => {
    const a = parsePrice(amount);
    if (!a || lineTotalCents(1, a) <= BigInt(0)) return toast("Type the amount, like 250.00");
    if (!/^\d+(\.\d{1,2})?$/.test(a)) return toast("An amount has at most 2 decimals (cents).");
    if (!isISODate(paidOn)) return toast("Pick the date it was paid.");
    if (lineTotalCents(1, a) > balance && !confirm(`That's more than the ${centsText(balance)} still owed. Record it anyway?`)) return;
    const err = await addPayment(db, { invoiceId: inv.id, paidOn, amount: a, method, reference: reference.trim(), note: note.trim() });
    if (onSaved(err, "Payment recorded")) {
      setAmount("");
      setReference("");
      setNote("");
    }
  };

  return (
    <section className="panel mt-2">
      <h3>Payments</h3>
      {inv.payments.length ? (
        <table className="simple mt-1">
          <thead>
            <tr>
              <th>Paid</th>
              <th>How</th>
              <th>Reference</th>
              <th className="num">Amount</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {[...inv.payments]
              .sort((a, b) => a.paid_on.localeCompare(b.paid_on))
              .map((p) => (
                <tr key={p.id}>
                  <td>
                    {niceDate(p.paid_on)}, {p.paid_on.slice(0, 4)}
                  </td>
                  <td>{METHOD_LABEL[p.method]}</td>
                  <td>
                    {p.reference}
                    {p.note && <span className="small muted block">{p.note}</span>}
                  </td>
                  <td className="num">{centsText(paidCents([p]))}</td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className="copy min-h-[44px] px-2"
                        onClick={() => {
                          if (confirm(`Delete the ${centsText(paidCents([p]))} payment from ${niceDate(p.paid_on)}?`))
                            void deletePayment(db, p.id).then((err) => onSaved(err, "Payment deleted"));
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <p className="small muted mt-1">No payments yet.</p>
      )}
      <p className="mt-1 mb-0">
        <b>
          {balance > BigInt(0)
            ? `Still owed: ${centsText(balance)}`
            : balance < BigInt(0)
              ? `Overpaid by ${centsText(-balance)}`
              : "Paid in full"}
        </b>
      </p>

      {canEdit && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="grid gap-1">
            <span className="lbl m-0">Paid on</span>
            <input type="date" className="field" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="lbl m-0">Amount</span>
            <input className="field num w-32!" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="lbl m-0">How</span>
            <select className="field" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="lbl m-0">{method === "check" ? "Check number" : method === "ach" ? "ACH reference" : "Reference"}</span>
            <input className="field w-36!" value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label className="grid flex-1 gap-1">
            <span className="lbl m-0">Note</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" className="btn">
            Record payment
          </button>
        </form>
      )}

      {canEdit && (
        <div className="mt-3">
          {!voiding ? (
            <button type="button" className="copy min-h-[44px] px-0" onClick={() => setVoiding(true)}>
              Void this invoice...
            </button>
          ) : (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!reason.trim()) return toast("Say why it's void.");
                void onVoid(reason.trim()).then((ok) => ok && setVoiding(false));
              }}
            >
              <label className="grid flex-1 gap-1">
                <span className="lbl m-0">Why is it void?</span>
                <input className="field" value={reason} placeholder="Wrong weight on the Racks" onChange={(e) => setReason(e.target.value)} />
              </label>
              <button type="submit" className="btn ghost">
                Void it
              </button>
              <button type="button" className="btn ghost" onClick={() => setVoiding(false)}>
                Cancel
              </button>
              <span className="small muted basis-full">
                Void keeps it on record, marked VOID. Then Reissue makes a corrected one.
                {inv.payments.length ? " Delete its payments first, then record them on the reissued invoice." : ""}
              </span>
            </form>
          )}
        </div>
      )}
    </section>
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
