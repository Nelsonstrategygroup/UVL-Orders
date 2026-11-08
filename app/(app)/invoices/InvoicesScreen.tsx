"use client";

// Invoices (SPEC 15): the week's invoices, one per location. Every packed
// location has a draft that follows packing and the price list until it's
// finalized (Lucas, 11/8/26: no more Make drafts or Update from packing).
// Each shows its number, boxes, weight and total, and whether prices or
// counts are still needed. Finalize all locks every draft that's ready.

import Link from "next/link";
import { useState } from "react";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { compareCustomerIds, displayName } from "@/lib/calc/customers";
import { invoiceState, lbText, paidCents, STATE_LABEL } from "@/lib/calc/invoice";
import { centsText, toFixedInt } from "@/lib/calc/prices";
import { finalizeInvoice } from "@/lib/db/invoices";
import { sheetFor, totalsOf } from "./sheet";
import { useInvoiceWeek } from "./useInvoiceWeek";

export default function InvoicesScreen() {
  const { week } = useWeek();
  const { catalog, customers } = useStaffData();
  const canEdit = useCan("invoices").change;
  const toast = useToast();
  const db = getDb();
  const { data, error, refresh } = useInvoiceWeek(week);
  const [busy, setBusy] = useState(false);

  if (error) return <p className="note bad">Couldn&apos;t load invoices: {error}</p>;
  if (!data || !customers)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const name = (id: string) => {
    const c = customers.byId.get(id);
    return c ? displayName(c, customers.byId) : "Unknown customer";
  };
  // The shared customer order: customers with locations first (Lucas, 11/6/26).
  const byCustomer = compareCustomerIds(customers.byId);
  const live = data.invoices.filter((i) => i.status !== "void");
  const voided = data.invoices.filter((i) => i.status === "void");
  const rows = live
    .map((inv) => {
      const sheet = sheetFor(data, inv, customers, catalog);
      // Weight: every box, as the manifests show it (per case boxes too).
      const lb = data.boxes.filter((b) => b.customer_id === inv.customer_id).reduce((s, b) => s + toFixedInt(b.weight, 3), BigInt(0));
      return { inv, sheet, t: totalsOf(sheet), lb };
    })
    .sort((a, b) => byCustomer(a.inv.customer_id, b.inv.customer_id));
  const invoiced = new Set(live.map((i) => i.customer_id));
  // Packed with no live invoice: only when its invoice was voided (Reissue makes the next one).
  const packedNoInvoice = data.packing.orders.filter((o) => o.boxes > 0 && !invoiced.has(o.customer_id));
  const orderedNothingPacked = data.packing.orders.filter((o) => o.status === "ordered" && o.lines > 0 && o.boxes === 0 && !invoiced.has(o.customer_id));
  const drafts = rows.filter((r) => r.inv.status === "draft");
  const ready = drafts.filter((r) => r.inv.number && r.t.priceNeeded === 0 && r.t.countNeeded === 0);
  const notReady = drafts.filter((r) => !ready.includes(r));
  const why = (r: (typeof rows)[number]) =>
    [!r.inv.number ? "number needed" : "", r.t.priceNeeded ? "price needed" : "", r.t.countNeeded ? "count needed" : ""].filter(Boolean).join(", ");
  const sum = rows.reduce(
    (s, r) => ({ boxes: s.boxes + r.t.boxes, lb: s.lb + r.lb, cents: s.cents + r.t.totalCents, complete: s.complete && r.t.complete }),
    { boxes: 0, lb: BigInt(0), cents: BigInt(0), complete: true },
  );
  const weekBoxes = data.boxes.length;
  const weekLb = data.boxes.reduce((s, b) => s + toFixedInt(b.weight, 3), BigInt(0));
  // Before packing starts, the notes about numbers and orders are just noise.
  const anyPacked = data.packing.orders.some((o) => o.boxes > 0) || rows.length > 0;
  const names = (ids: string[]) => [...ids].sort(byCustomer).map(name).join(", ");
  const anyPriceNeeded = rows.some((r) => r.t.priceNeeded > 0);

  const finalizeAll = async () => {
    const cents = ready.reduce((s, r) => s + r.t.totalCents, BigInt(0));
    const skip = notReady.length ? `

Not ready, left as drafts: ${notReady.map((r) => `${r.sheet.customerName} (${why(r)})`).join("; ")}.` : "";
    if (
      !confirm(
        `Finalize ${ready.length} invoice${ready.length === 1 ? "" : "s"} for ${centsText(cents)}? After this their lines, totals and numbers are locked. An admin can reopen one if it's wrong.${skip}`,
      )
    )
      return;
    setBusy(true);
    const failed: string[] = [];
    for (const r of ready) {
      const err = await finalizeInvoice(db, r.inv.id);
      if (err) failed.push(`${r.sheet.customerName}: ${err}`);
    }
    setBusy(false);
    const done = ready.length - failed.length;
    toast(failed.length ? `Finalized ${done}. Not finalized: ${failed.join(" ")}` : `Finalized ${done} invoice${done === 1 ? "" : "s"}`);
    refresh();
  };

  return (
    <>
      <WeekBar inv={data.weekNumber == null ? null : String(data.weekNumber)} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto">Invoices</h2>
        {canEdit && drafts.length > 0 && (
          <button type="button" className="btn" disabled={busy || ready.length === 0} onClick={() => void finalizeAll()}>
            Finalize all{ready.length > 0 && ready.length < drafts.length ? ` ${ready.length} ready` : ""}
          </button>
        )}
        {rows.length > 0 && (
          <Link href={`/invoices/print?week=${week}`} className="btn ghost">
            Print all
          </Link>
        )}
        <Link href="/invoices/open" className="btn ghost">
          Open invoices
        </Link>
      </div>

      {data.weekNumber == null && anyPacked && (
        <p className="note warn mt-2">
          This week has no invoice number yet, so its invoices have no number. Set it in{" "}
          <Link href="/setup/invoicing">Setup &gt; Invoicing</Link>. The drafts pick it up by themselves.
        </p>
      )}
      {packedNoInvoice.length > 0 && (
        <p className="note mt-2">
          {packedNoInvoice.length === 1 ? "1 location has" : `${packedNoInvoice.length} locations have`} boxes and no invoice yet:{" "}
          {names(packedNoInvoice.map((o) => o.customer_id))}. {packedNoInvoice.length === 1 ? "Its invoice was" : "Their invoices were"} voided:
          open the void invoice below and tap Reissue.
        </p>
      )}
      {drafts.length > 0 && (
        <p className="small muted mt-2 mb-0">
          Drafts follow packing and prices until they&apos;re finalized. Change a box on Packing and its invoice shows it the next time
          it&apos;s opened.
          {canEdit && notReady.length > 0 && ` Not ready to finalize: ${notReady.map((r) => `${r.sheet.customerName} (${why(r)})`).join("; ")}.`}
        </p>
      )}
      {data.packing.unassigned > 0 && (
        <p className="note bad mt-2">
          {data.packing.unassigned} box{data.packing.unassigned === 1 ? " has" : "es have"} no customer, so {data.packing.unassigned === 1 ? "it isn't" : "they aren't"} on
          any invoice. Give {data.packing.unassigned === 1 ? "it" : "them"} a customer on Packing.
        </p>
      )}
      {anyPacked && orderedNothingPacked.length > 0 && (
        <p className="note mt-2">
          Ordered, nothing packed, so no invoice: {names(orderedNothingPacked.map((o) => o.customer_id))}.
        </p>
      )}
      {anyPriceNeeded && (
        <p className="note mt-2">
          Some products have no price yet (Price needed). Prices are set in <Link href="/setup/prices">Setup &gt; Prices</Link>.
        </p>
      )}

      {rows.length === 0 && voided.length === 0 ? (
        <div className="empty">{data.packing.orders.some((o) => o.boxes > 0) ? "No invoices yet this week." : "Nothing packed this week yet."}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="simple mt-3">
            <thead>
              <tr>
                <th>Location</th>
                <th>Invoice</th>
                <th>Status</th>
                <th className="num">Boxes</th>
                <th className="num">Weight</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ inv, sheet, t, lb }) => (
                <tr key={inv.id}>
                  <td>
                    <Link href={`/invoices/${inv.id}`}>
                      <b>{sheet.customerName}</b>
                    </Link>
                  </td>
                  <td>{inv.number ?? <span className="tag extra">Number needed</span>}</td>
                  <td>
                    {STATE_LABEL[invoiceState(inv.status, t.totalCents, paidCents(inv.payments))]}
                    {data.changedSince.has(inv.id) && <span className="tag extra ml-1">Packing changed</span>}
                  </td>
                  <td className="num">{t.boxes}</td>
                  <td className="num">{lbText(lb)} lb</td>
                  <td className="num">
                    {centsText(t.totalCents)}
                    {t.priceNeeded > 0 && <span className="small block">{t.priceNeeded} Price needed</span>}
                    {t.countNeeded > 0 && <span className="small block">{t.countNeeded} Count needed</span>}
                  </td>
                </tr>
              ))}
              {voided.map((inv) => (
                <tr key={inv.id} className="muted">
                  <td>
                    <Link href={`/invoices/${inv.id}`}>{inv.issued?.customer_name ?? name(inv.customer_id)}</Link>
                  </td>
                  <td>
                    <s>{inv.number}</s>
                  </td>
                  <td colSpan={4}>
                    Void{inv.void_reason ? `: ${inv.void_reason}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={3}>
                  {rows.length} invoice{rows.length === 1 ? "" : "s"}
                </th>
                <th className="num">{sum.boxes}</th>
                <th className="num">{lbText(sum.lb)} lb</th>
                <th className="num">
                  {centsText(sum.cents)}
                  {!sum.complete && <span className="small block">so far</span>}
                </th>
              </tr>
            </tfoot>
          </table>
          <p className="small muted mt-1">
            This week&apos;s box records: {weekBoxes} box{weekBoxes === 1 ? "" : "es"}, {lbText(weekLb)} lb, as on the manifests.
            Weight is every box; per case lines (pepper sticks) bill by the box, not the pound.
          </p>
        </div>
      )}
    </>
  );
}
