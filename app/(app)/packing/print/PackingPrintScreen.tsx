"use client";

// The paper packing copy (change request 10/26/26), opened from Print and
// download and from Packing: the backup for when the internet is down. One
// blank per box with its label number, so Chris writes each box's weight; the
// weights are typed in afterwards on "Type in from paper", laid out the same.

import Link from "next/link";
import { useCan } from "@/components/CurrentUser";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { useWeek, WeekBar } from "@/components/Week";
import { weekName } from "@/lib/dates";
import { packLines } from "@/lib/db/packing";
import { PaperSheet } from "../PackSheet";
import { useLabelNumbers } from "../useLabelNumbers";

export default function PackingPrintScreen() {
  const { week } = useWeek();
  const bundle = usePackingBundle(week);
  const canPacking = useCan("packing").change;
  const canWeek = useCan("week").change;
  const canOrders = useCan("orders").change;
  const canNumber = canPacking || canWeek || canOrders;
  const { missing } = useLabelNumbers(week, bundle.data, bundle.refresh, canNumber);
  const data = bundle.data?.packing ?? null;

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!data || !bundle.data)
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
          <Link href="/packing/paper" className="btn ghost">
            Type in from paper
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
          The backup for when there&apos;s no internet. Each box gets a blank with its label number above it. Products
          with no box size get 6 blanks with a space to write the label number. Weights already in the app are filled in.
        </p>
        {missing > 0 && (
          <p className="note warn">
            {missing} box{missing === 1 ? " has" : "es have"} no label number yet. Open this page with internet to number
            them, so the paper matches the labels.
          </p>
        )}
      </div>
      {data.orders.length > 0 && (
        <div className="screen-only pk-scroll">
          <PaperSheet data={data} boxes={bundle.data.boxes} preview />
        </div>
      )}
      <PaperSheet data={data} boxes={bundle.data.boxes} />
    </>
  );
}
