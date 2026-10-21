"use client";

// The paper packing copy (SPEC 5.6), opened from Print and download: the
// same checklist Packing prints, on its own page so Packing stays for packing.

import Link from "next/link";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { useWeek, WeekBar } from "@/components/Week";
import { todayISO, weekName } from "@/lib/dates";
import { packLines } from "@/lib/db/packing";
import { PrintCopy } from "../PackingScreen";

export default function PackingPrintScreen() {
  const { week } = useWeek();
  const bundle = usePackingBundle(week, todayISO());
  const data = bundle.data?.packing ?? null;

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const lines = data.orders.reduce((n, o) => n + packLines(o, data.products).length, 0);
  return (
    <>
      <div className="screen-only">
        <WeekBar inv={data.invNumber} />
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto">Paper packing copy</h2>
          <Link href="/print" className="btn ghost">
            &larr; Print and download
          </Link>
          <button type="button" className="btn" disabled={!data.orders.length} onClick={() => window.print()}>
            Print
          </button>
        </div>
        <p className="mt-2">
          {data.orders.length
            ? `Packing list for ${weekName(week)}: ${data.orders.length} customers, ${lines} lines.`
            : "No orders for this week yet."}
        </p>
        <p className="small muted">
          A checklist for each customer with spaces for weights, boxes, not filled, pallet, and initials. Weights already
          entered in the app are filled in.
        </p>
      </div>
      <PrintCopy data={data} />
    </>
  );
}
