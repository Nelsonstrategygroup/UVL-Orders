"use client";

// Invoices (SPEC 15, stage 2): the week's invoices, one per location, made
// from the box records with Make drafts. Each shows its number, boxes,
// weight and total, and whether prices or counts are still needed or the
// packing changed since it was made (Out of date).

import Link from "next/link";
import { useState } from "react";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { displayName } from "@/lib/calc/customers";
import { lbText } from "@/lib/calc/invoice";
import { centsText, toFixedInt } from "@/lib/calc/prices";
import { makeDrafts, updateDraft } from "@/lib/db/invoices";
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
  const live = data.invoices.filter((i) => i.status !== "void");
  const rows = live
    .map((inv) => {
      const sheet = sheetFor(data, inv, customers, catalog);
      // Weight: every box, as the manifests show it (per case boxes too).
      const lb = data.boxes.filter((b) => b.customer_id === inv.customer_id).reduce((s, b) => s + toFixedInt(b.weight, 3), BigInt(0));
      return { inv, sheet, t: totalsOf(sheet), lb };
    })
    .sort((a, b) => a.sheet.customerName.localeCompare(b.sheet.customerName, undefined, { numeric: true }));
  const invoiced = new Set(live.map((i) => i.customer_id));
  const packedNoInvoice = data.packing.orders.filter((o) => o.boxes > 0 && !invoiced.has(o.customer_id));
  const orderedNothingPacked = data.packing.orders.filter((o) => o.status === "ordered" && o.lines > 0 && o.boxes === 0 && !invoiced.has(o.customer_id));
  const outOfDate = rows.filter((r) => data.outOfDate.has(r.inv.id));
  const sum = rows.reduce(
    (s, r) => ({ boxes: s.boxes + r.t.boxes, lb: s.lb + r.lb, cents: s.cents + r.t.totalCents, complete: s.complete && r.t.complete }),
    { boxes: 0, lb: BigInt(0), cents: BigInt(0), complete: true },
  );
  const weekBoxes = data.boxes.length;
  const weekLb = data.boxes.reduce((s, b) => s + toFixedInt(b.weight, 3), BigInt(0));
  const anyPriceNeeded = rows.some((r) => r.t.priceNeeded > 0);

  const make = async () => {
    setBusy(true);
    const { made, error: err } = await makeDrafts(db, week);
    setBusy(false);
    toast(err ? `Couldn't make drafts: ${err}` : made ? `Made ${made} draft${made === 1 ? "" : "s"}` : "Every location packed this week already has an invoice.");
    refresh();
  };
  const updateAll = async () => {
    setBusy(true);
    let failed = 0;
    for (const r of outOfDate) if (await updateDraft(db, r.inv.id)) failed++;
    setBusy(false);
    toast(failed ? `${failed} couldn't be updated. Try again.` : "Drafts updated");
    refresh();
  };

  return (
    <>
      <WeekBar inv={data.weekNumber == null ? null : String(data.weekNumber)} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto">Invoices</h2>
        {canEdit && (
          <button type="button" className="btn" disabled={busy} onClick={() => void make()}>
            Make drafts
          </button>
        )}
        {canEdit && outOfDate.length > 0 && (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void updateAll()}>
            Update {outOfDate.length} out of date
          </button>
        )}
        {rows.length > 0 && (
          <Link href={`/invoices/print?week=${week}`} className="btn ghost">
            Print all
          </Link>
        )}
      </div>

      {data.weekNumber == null && (
        <p className="note warn mt-2">
          This week has no invoice number yet, so its invoices have no number. Set it in{" "}
          <Link href="/setup/invoicing">Setup &gt; Invoicing</Link>, then Update the drafts.
        </p>
      )}
      {packedNoInvoice.length > 0 && (
        <p className="note mt-2">
          {packedNoInvoice.length === 1 ? "1 location has" : `${packedNoInvoice.length} locations have`} boxes and no invoice yet:{" "}
          {packedNoInvoice.map((o) => name(o.customer_id)).join(", ")}. {canEdit ? "Tap Make drafts." : ""}
        </p>
      )}
      {outOfDate.length > 0 && (
        <p className="note warn mt-2">
          Packing changed after {outOfDate.length === 1 ? "1 draft was" : `${outOfDate.length} drafts were`} made (a box moved, added or
          reweighed): {outOfDate.map((r) => r.sheet.customerName).join(", ")}. Update them to bill what&apos;s packed now.
        </p>
      )}
      {data.packing.unassigned > 0 && (
        <p className="note bad mt-2">
          {data.packing.unassigned} box{data.packing.unassigned === 1 ? " has" : "es have"} no customer, so {data.packing.unassigned === 1 ? "it isn't" : "they aren't"} on
          any invoice. Give {data.packing.unassigned === 1 ? "it" : "them"} a customer on Packing.
        </p>
      )}
      {orderedNothingPacked.length > 0 && (
        <p className="note mt-2">
          Ordered, nothing packed, so no invoice: {orderedNothingPacked.map((o) => name(o.customer_id)).join(", ")}.
        </p>
      )}
      {anyPriceNeeded && (
        <p className="note mt-2">
          Some products have no price yet (Price needed). Prices are set in <Link href="/setup/prices">Setup &gt; Prices</Link>.
        </p>
      )}

      {rows.length === 0 ? (
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
                    {inv.status === "draft" ? "Draft" : inv.status}
                    {data.outOfDate.has(inv.id) && <span className="tag extra ml-1">Out of date</span>}
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
            This week&apos;s box records: {weekBoxes} box{weekBoxes === 1 ? "" : "es"}, {lbText(weekLb)} lb , as on the manifests.
            Weight is every box; per case lines (pepper sticks) bill by the box, not the pound.
          </p>
        </div>
      )}
    </>
  );
}
