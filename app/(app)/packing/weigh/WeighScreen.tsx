"use client";

// The Weigh Sheet (Lucas, 11/1/26), opened from Print and download and from
// Packing: the printout for writing each box's weight, by product. Works with
// no signal like the rest of Packing. Weights already in the app are filled
// in; "Type in from paper" is laid out the same.

import Link from "next/link";
import { useMemo } from "react";
import { downloadTable } from "@/components/download";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { weekName } from "@/lib/dates";
import { sheetLabels } from "@/lib/db/packing";
import { weighLayout, weighSections, weighTable } from "@/lib/packSheets";
import { invFileName } from "@/lib/weekInv";
import WeighPrint from "../sheets/WeighPrint";

export default function WeighScreen() {
  const { week } = useWeek();
  const toast = useToast();
  const bundle = usePackingBundle(week);
  const data = bundle.data?.packing ?? null;
  const layout = useMemo(() => (bundle.data ? weighLayout(weighSections(bundle.data.packing, sheetLabels(bundle.data.packing, bundle.data.boxes))) : null), [bundle.data]);

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!data || !layout)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const rows = layout.sections.reduce((n, s) => n + s.rows.length, 0);
  return (
    <>
      <div className="screen-only">
        <WeekBar inv={data.invNumber} />
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto">Weigh Sheet</h2>
          <Link href="/print" className="btn ghost">
            &larr; Print and download
          </Link>
          <Link href="/packing/paper" className="btn ghost">
            Type in from paper
          </Link>
          <button
            type="button"
            className="btn ghost"
            disabled={!rows}
            onClick={() =>
              void downloadTable(invFileName(data.invNumber, "Weigh Sheet", week), weighTable(layout.sections, data.invNumber, week), "Weigh Sheet").catch(() =>
                toast("Couldn't download. Try again."),
              )
            }
          >
            Download
          </button>
          <button type="button" className="btn" disabled={!rows} onClick={() => window.print()}>
            Print
          </button>
        </div>
        <p className="mt-2">
          {rows
            ? `${weekName(week)}: ${layout.sections.length} products, ${rows} lines, ${layout.pages.length} page${layout.pages.length === 1 ? "" : "s"}.`
            : "No orders for this week yet."}
        </p>
        <p className="small muted">
          By product, A to Z, as on the box labels; a row for each store with a box for each box&apos;s weight, plus one spare.
          Products with no box size get 3 boxes (Setup &gt; Boxes). Blank rows at the end for boxes not on the sheet. Prints
          landscape.
        </p>
      </div>
      {rows > 0 && (
        <div className="screen-only">
          <WeighPrint layout={layout} inv={data.invNumber} week={week} preview />
        </div>
      )}
      {rows > 0 && <WeighPrint layout={layout} inv={data.invNumber} week={week} />}
    </>
  );
}
