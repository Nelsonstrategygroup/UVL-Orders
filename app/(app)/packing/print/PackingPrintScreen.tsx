"use client";

// The Pallet Sheet (Lucas, 11/1/26), opened from Print and download and from
// Packing: by store, a checkbox per product with what was ordered and how many
// boxes, Pallet and Initials once per store. It replaces the paper packing
// copy; box weights go on the Weigh Sheet.

import Link from "next/link";
import { useMemo } from "react";
import { downloadTable } from "@/components/download";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { weekName } from "@/lib/dates";
import { sheetLabels } from "@/lib/db/packing";
import { palletCustomers, palletLayout, palletTable } from "@/lib/packSheets";
import { invFileName } from "@/lib/weekInv";
import PalletPrint from "../sheets/PalletPrint";

export default function PackingPrintScreen() {
  const { week } = useWeek();
  const toast = useToast();
  const bundle = usePackingBundle(week);
  const data = bundle.data?.packing ?? null;
  const customers = useMemo(() => (bundle.data ? palletCustomers(bundle.data.packing, sheetLabels(bundle.data.packing, bundle.data.boxes)) : null), [bundle.data]);
  const pages = useMemo(() => (customers ? palletLayout(customers) : []), [customers]);

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!data || !customers)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const lines = customers.reduce((n, c) => n + c.lines.length, 0);
  return (
    <>
      <div className="screen-only">
        <WeekBar inv={data.invNumber} />
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto">Pallet Sheet</h2>
          <Link href="/print" className="btn ghost">
            &larr; Print and download
          </Link>
          <Link href="/packing/weigh" className="btn ghost">
            Weigh Sheet
          </Link>
          <button
            type="button"
            className="btn ghost"
            disabled={!lines}
            onClick={() =>
              void downloadTable(invFileName(data.invNumber, "Pallet Sheet", week), palletTable(customers, data.invNumber, week), "Pallet Sheet").catch(() =>
                toast("Couldn't download. Try again."),
              )
            }
          >
            Download
          </button>
          <button type="button" className="btn" disabled={!lines} onClick={() => window.print()}>
            Print
          </button>
        </div>
        <p className="mt-2">
          {lines
            ? `${weekName(week)}: ${customers.length} customers, ${lines} lines, ${pages.length} page${pages.length === 1 ? "" : "s"}.`
            : "No orders for this week yet."}
        </p>
        <p className="small muted">
          By store, in the usual order: a box to check for each product, what was ordered and how many boxes. Pallet and
          Initials once per store. Box weights go on the Weigh Sheet.
        </p>
      </div>
      {lines > 0 && (
        <div className="screen-only">
          <PalletPrint customers={customers} pages={pages} inv={data.invNumber} week={week} preview />
        </div>
      )}
      {lines > 0 && <PalletPrint customers={customers} pages={pages} inv={data.invNumber} week={week} />}
    </>
  );
}
