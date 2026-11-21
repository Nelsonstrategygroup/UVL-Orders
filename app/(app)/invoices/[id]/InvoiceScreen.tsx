"use client";

// One invoice (SPEC 15, stages 2 and 3): the printable invoice. A draft is
// live (Lucas, 11/8/26): its lines follow packing and prices every time it's
// opened or printed. On a draft: invoice date, number, a note for the
// customer, a discount on any line (with a note), lines added by hand (a fee
// or a credit, with a note), and Finalize (once every line has a price and a
// count), which locks the lines, total and number. Once finalized: the date
// and number, Mark sent, payments, Reopen (admins, no payments: live again),
// and Void (with a reason). A void invoice can be reissued as a new draft (-R1).
// A stand-alone sale (Lucas, 11/20/26) has no packing: products are picked
// from the list with the amount typed, priced from Setup > Prices.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCan, useMe } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { useWeek } from "@/components/Week";
import {
  invoiceState,
  invoiceTotals,
  paidCents,
  parseDiscount,
  parseSaleAmount,
  quantityText,
  SALE_AMOUNT_LABEL,
  STATE_LABEL,
  type PricedLine,
} from "@/lib/calc/invoice";
import { groupLead, packedWith } from "@/lib/calc/packTogether";
import { centsText, lineTotalCents, parsePrice, priceText } from "@/lib/calc/prices";
import { ago, isISODate, niceDate, todayISO, weekName } from "@/lib/dates";
import {
  addManualLine,
  addProductLine,
  addPayment,
  deleteDraft,
  deleteLine,
  deletePayment,
  finalizeInvoice,
  loadInvoice,
  markSent,
  reissueInvoice,
  reopenInvoice,
  setLineDiscount,
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
  const isAdmin = useMe().role === "admin";
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
  const sale = inv.sale_no != null;
  // A draft stays when nothing's packed only if it has lines added by hand or a note; then it can be deleted.
  const nothingPacked = !data.boxes.some((b) => b.customer_id === inv.customer_id) && !inv.invoice_lines.some((l) => l.kind === "packed");
  // A draft sale can always be deleted.
  const canDelete = draft && (sale || nothingPacked);
  const replaces = inv.replaces_id ? data.invoices.find((i) => i.id === inv.replaces_id) : undefined;
  const replacedBy = data.invoices.find((i) => i.replaces_id === inv.id);
  const live = data.invoices.find((i) => i.customer_id === inv.customer_id && i.status !== "void" && i.sale_no === inv.sale_no);
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

  // Prices not confirmed for this location (Setup > Prices; Lucas, 11/14/26): warn before it's printed or sent.
  const unconfirmed = inv.status !== "void" && !data.pricesConfirmed.has(inv.customer_id);
  const okUnconfirmed = (doing: string) =>
    !unconfirmed ||
    confirm(`Prices for ${sheet.customerName} aren't confirmed yet (Setup > Prices). Check them before this goes to the customer. ${doing} anyway?`);

  // What stops a draft being finalized, in plain words.
  const blockers = [
    !inv.number
      ? sale && !data.billing.get(inv.customer_id)?.invoice_code
        ? `It needs an invoice number. Give ${sheet.customerName} an invoice code in Setup > Invoicing, or type a number.`
        : "It needs an invoice number."
      : "",
    sale && inv.invoice_lines.length === 0 ? "Add a product." : "",
    t.priceNeeded ? `${t.priceNeeded} line${t.priceNeeded === 1 ? " has" : "s have"} no price (Setup > Prices).` : "",
    t.countNeeded ? `${t.countNeeded} line${t.countNeeded === 1 ? " needs" : "s need"} a count (on Packing).` : "",
  ].filter(Boolean);

  const remove = async () => {
    if (
      !confirm(
        sale
          ? `Delete this sale invoice for ${sheet.customerName}? Its lines and note go too.`
          : `Delete the draft for ${sheet.customerName}? Nothing is packed for it; the lines you added and the note go too.`,
      )
    )
      return;
    const err = await deleteDraft(db, inv.id);
    if (err) return after(err, "");
    toast("Draft deleted");
    setWeek(week);
    router.push("/invoices");
  };
  const finalize = async () => {
    if (
      !confirm(
        `Finalize ${inv.number} for ${centsText(t.totalCents)}? After this its lines, total and number are locked. An admin can reopen it if it's wrong.`,
      )
    )
      return;
    await run(() => finalizeInvoice(db, inv.id), "Finalized");
  };
  const reopen = async () => {
    if (
      !confirm(
        sale
          ? `Reopen ${inv.number ?? "this invoice"}? It becomes a draft again: its prices come from today's price list, and its total can change. Your name and the time are kept.`
          : `Reopen ${inv.number ?? "this invoice"}? It becomes a draft again: its lines follow packing and today's price list, and its total can change. Your name and the time are kept.`,
      )
    )
      return;
    await run(() => reopenInvoice(db, inv.id), sale ? "Reopened." : "Reopened. It follows packing again.");
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
            {sheet.customerName} · {sale ? "Sale · " : ""}
            {weekName(week)}
          </h2>
          <button type="button" className="btn" onClick={() => okUnconfirmed("Print") && window.print()}>
            Print
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              if (!okUnconfirmed("Save as PDF")) return;
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
          {draft && !sale && <span className="small muted"> · follows packing and prices until finalized</span>}
          {sale && <span className="small muted"> · a sale with no order{draft ? "; prices follow Setup > Prices until finalized" : ""}</span>}
          {inv.reopened_at && (
            <span className="small muted">
              {" "}
              · reopened {ago(inv.reopened_at)}
              {inv.reopened_by_name ? ` by ${inv.reopened_by_name}` : ""}
            </span>
          )}
          {replaces && (
            <span className="small">
              {" "}
              · replaces <Link href={`/invoices/${replaces.id}`}>{replaces.number ?? "the void invoice"}</Link>
            </span>
          )}
        </p>

        {unconfirmed && (
          <p className="note warn mt-2" role="alert">
            Prices for {sheet.customerName} aren&apos;t confirmed yet. Check them before you print or send this invoice. Someone who
            can change prices checks the box on Setup &gt; Prices once they match what this customer is really charged.
          </p>
        )}

        {data.changedSince.has(inv.id) && (
          <p className="note warn mt-2" role="alert">
            Packing changed after this invoice was finalized. It still bills what it was finalized with. If that&apos;s wrong,{" "}
            {isAdmin ? "reopen it (below)." : "ask an admin to reopen it."}
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
                {sale ? "This sale has another invoice: " : "This location has another invoice this week: "}
                <Link href={`/invoices/${live.id}`}>{live.number ?? "open it"}</Link>.
              </p>
            ) : (
              canEdit && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button type="button" className="btn" disabled={busy} onClick={() => void reissue()}>
                    Reissue
                  </button>
                  <span className="small muted">
                    {sale
                      ? "A new draft with the same lines, numbered -R. Prices come from the price list again."
                      : "A new draft from packing as it is now, numbered -R, with the same added lines and discounts."}
                  </span>
                </div>
              )
            )}
          </section>
        )}

        {canEdit && (draft || issued) && (
          <section className="panel mt-2">
            <div className="flex flex-wrap items-end gap-3">
              <DateField inv={inv} sale={sale} onSaved={after} />
              <NumberField inv={inv} onSaved={after} />
              {canDelete && (
                <div className="ml-auto flex flex-wrap gap-2">
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove()}>
                    Delete draft
                  </button>
                </div>
              )}
              {issued && (
                <div className="ml-auto flex flex-wrap gap-2">
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy || inv.payments.length > 0}
                      title={inv.payments.length ? "Delete its payments first" : undefined}
                      onClick={() => void reopen()}
                    >
                      Reopen
                    </button>
                  )}
                  <button
                    type="button"
                    className={inv.status === "sent" ? "btn ghost" : "btn"}
                    disabled={busy}
                    onClick={() => {
                      if (inv.status !== "sent" && !okUnconfirmed("Mark it sent")) return;
                      void run(() => markSent(db, inv.id, inv.status !== "sent"), inv.status === "sent" ? "Marked not sent" : "Marked sent");
                    }}
                  >
                    {inv.status === "sent" ? "Mark not sent" : "Mark sent"}
                  </button>
                </div>
              )}
            </div>
            {issued && (
              <p className="small muted mt-1 mb-0">
                The due date follows the invoice date. Prices stay as finalized.
                {isAdmin && (inv.payments.length ? " To reopen it, delete its payments first." : " Reopen makes it a live draft again.")}
              </p>
            )}
            {draft && !sale && nothingPacked && (
              <p className="small mt-1 mb-0">Nothing is packed for this location now. It stays because it has lines you added or a note.</p>
            )}

            {draft && (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="button" className="btn" disabled={busy || blockers.length > 0} onClick={() => void finalize()}>
                    Finalize
                  </button>
                  {blockers.length ? (
                    <span className="small">Not ready: {blockers.join(" ")}</span>
                  ) : (
                    <span className="small muted">Ready. Finalizing locks the lines, prices, total and number.</span>
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
                {sale ? (
                  <>
                    <h3 className="mt-3">Products, discounts and lines you add</h3>
                    <p className="small muted mt-1">
                      Pick a product and type how much. Prices come from Setup &gt; Prices on the invoice date. A discount is a dollar
                      amount (5.00) or a percent (10%), and needs a note.
                    </p>
                    <AddProduct invoiceId={inv.id} nextSort={Math.max(0, ...inv.invoice_lines.map((l) => l.sort)) + 1} onSaved={after} />
                  </>
                ) : (
                  <>
                    <h3 className="mt-3">Discounts and lines you add</h3>
                    <p className="small muted mt-1">
                      Quantities come from packing. To change one, fix it on Packing; this draft follows. A discount is a dollar
                      amount (5.00) or a percent (10%), and needs a note.
                    </p>
                  </>
                )}
                <ul className="m-0 mt-1 grid list-none gap-2 p-0">
                  {sheet.lines
                    // Mohawk charge lines come from Setup > Prices, not from here.
                    .filter((l) => l.kind !== "shorted" && l.kind !== "charge" && l.kind !== "freight")
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

function DateField({ inv, sale, onSaved }: { inv: InvoiceRow; sale: boolean; onSaved: (err: string | null, ok: string) => boolean }) {
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
              onSaved(
                err,
                inv.status !== "draft"
                  ? "Date saved. The due date follows."
                  : sale
                    ? "Date saved. Prices are from this date, and the sale is in the week holding it."
                    : "Date saved. Prices are from this date.",
              ),
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
        placeholder={inv.status === "draft" ? "Blank: automatic" : "Number needed"}
        title="Blank goes back to the week's number and the location code"
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
        {l.kind === "inventory" && (
          <span className="small muted">
            {quantityText(l.quantity, l.price_unit)}
            {l.boxes ? `, ${l.boxes} box${l.boxes === 1 ? "" : "es"}` : ""}
          </span>
        )}
        {(l.kind === "manual" || l.kind === "inventory") && (
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

/**
 * A product on a sale (Lucas, 11/20/26): picked from the list, the amount in
 * its price unit (pounds, cases or pieces), boxes if known. Products packed
 * in one box (Heart, Liver, Kidney) are one choice, as on the invoice.
 */
function AddProduct({ invoiceId, nextSort, onSaved }: { invoiceId: string; nextSort: number; onSaved: (err: string | null, ok: string) => boolean }) {
  const db = getDb();
  const toast = useToast();
  const { catalog } = useStaffData();
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [boxes, setBoxes] = useState("");
  if (!catalog) return null;
  // Active products in sort order; a packed-together group once, under its first product.
  const choices = catalog.products
    .filter((p) => p.active && groupLead(p.id, catalog.products) === p.id)
    .map((p) => {
      const group = packedWith(p.id, catalog.products);
      const name = group.length > 1 ? group.map((id) => catalog.productById.get(id)?.name ?? id).join(", ") : p.name;
      return { id: p.id, name, unit: p.price_unit };
    });
  const picked = choices.find((c) => c.id === productId);

  const add = async () => {
    if (!picked) return toast("Pick a product.");
    const q = parseSaleAmount(amount, picked.unit);
    if (!q) return toast(picked.unit === "lb" ? "Type the pounds, like 12.5" : `Type how many ${SALE_AMOUNT_LABEL[picked.unit].toLowerCase()}, like 2`);
    const b = boxes.trim() ? Number(boxes.trim()) : 0;
    if (!Number.isInteger(b) || b < 0) return toast("Boxes is a whole number, or leave it blank.");
    const ok = onSaved(
      await addProductLine(db, invoiceId, { productId: picked.id, description: picked.name, quantity: q, priceUnit: picked.unit, boxes: b, sort: nextSort }),
      `Added ${picked.name}`,
    );
    if (ok) {
      setProductId("");
      setAmount("");
      setBoxes("");
    }
  };

  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label className="grid gap-1">
        <span className="lbl m-0">Product</span>
        <select className="field" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Pick a product</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="lbl m-0">{picked ? SALE_AMOUNT_LABEL[picked.unit] : "How much"}</span>
        <input className="field num w-28!" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="grid gap-1">
        <span className="lbl m-0">Boxes (if known)</span>
        <input className="field num w-20!" inputMode="numeric" value={boxes} onChange={(e) => setBoxes(e.target.value)} />
      </label>
      <button type="submit" className="btn">
        Add product
      </button>
    </form>
  );
}
