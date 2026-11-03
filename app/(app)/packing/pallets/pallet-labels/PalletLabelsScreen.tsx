"use client";

// Pallet labels (Lucas, 11/2/26): one Letter landscape label for the outside
// of each pallet, two copies by default (one for each side). A pallet with
// no distributor, or mixed distributors, gets no label: the message says
// which customer to fix in Setup > Ships to.

import Link from "next/link";
import { useState } from "react";
import { WeekBar } from "@/components/Week";
import { longDate } from "@/lib/dates";
import { PrintWarnings, usePrintGuard } from "@/components/PrintGuard";
import { paperworkContext, paperworkWarnings, pickPallets } from "../Manifest";
import { PalletLabel } from "../Paperwork";
import { dateWords, usePaperworkWeek, usePrintOnce } from "../usePaperworkWeek";

export default function PalletLabelsScreen() {
  const { onWeek, bundle, palletId, date, print } = usePaperworkWeek();
  const [copies, setCopies] = useState(2);
  const picked = bundle.data && onWeek ? pickPallets(bundle.data, { palletId, date }) : null;
  const rows = picked ? picked.groups.flatMap((g) => g.pallets.map((r) => ({ g, r }))) : [];
  const warnings = bundle.data && picked ? paperworkWarnings(bundle.data, { palletId, date }, { asOf: { at: bundle.savedAt, fromPhone: bundle.fromPhone } }) : [];
  const guard = usePrintGuard(warnings);
  usePrintOnce(print, rows.length > 0, () => guard.print());

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!bundle.data || !picked)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const ctx = paperworkContext(bundle.data);
  const title = palletId
    ? `Pallet label for ${rows[0]?.r.pallet.tag ?? picked.blocked[0]?.pallet.tag ?? "this pallet"}`
    : `Pallet labels${date ? ` for ${dateWords(date === "none" ? null : date, longDate)}` : ""}`;
  return (
    <>
      <div className="screen-only">
        <WeekBar inv={bundle.data.packing.invNumber} />
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto">{title}</h2>
          <Link href="/packing/pallets" className="btn ghost">
            &larr; Pallets
          </Link>
          <label className="flex items-center gap-2">
            <span className="small">Copies of each</span>
            <select className="field w-auto!" value={copies} onChange={(e) => setCopies(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" disabled={!rows.length} onClick={() => guard.print()}>
            Print
          </button>
        </div>
        <p className="small muted mt-1">Letter, landscape. Two copies by default, one for each side of the pallet.</p>
        {picked.blocked.map(({ pallet, problem }) => (
          <p key={pallet.id} className="note bad" role="alert">
            <b>No label for {pallet.tag || "this pallet"}:</b> {problem}{" "}
            <Link href="/setup/pallets" className="copy">
              Setup &gt; Ships to
            </Link>
          </p>
        ))}
        {!rows.length && !picked.blocked.length && <div className="empty">No pallets {date ? "for this date" : "this week"} yet.</div>}
      </div>
      <PrintWarnings warnings={warnings} />
      {guard.dialog}
      <style>{`@media print { @page { size: letter landscape; margin: 0.4in; } }`}</style>
      <div className="pkmanifest">
        {rows.flatMap(({ g, r }) =>
          Array.from({ length: copies }, (_, i) => <PalletLabel key={`${r.pallet.id}|${i}`} row={r} group={g} ctx={ctx} />),
        )}
      </div>
    </>
  );
}
