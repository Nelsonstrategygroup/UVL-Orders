"use client";

// The box label list (SPEC 12.5): one row per box, so Kathy can print every
// customer label before packing day. Printing saves a fingerprint of the
// list; Packing and This week then say if orders change afterward.

import Link from "next/link";
import { useState } from "react";
import { useMe } from "@/components/CurrentUser";
import { getDb } from "@/components/data/db";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { todayISO, weekName } from "@/lib/dates";
import { formatWhen } from "@/lib/format";
import { packingLabels } from "@/lib/db/packing";
import { saveWeek } from "@/lib/db/save";
import LabelsChanged from "./LabelsChanged";

export default function LabelsScreen() {
  const { week } = useWeek();
  const me = useMe();
  const toast = useToast();
  const bundle = usePackingBundle(week, todayISO());
  const [printedAt, setPrintedAt] = useState<string | null>(null);

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!bundle.data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const data = bundle.data.packing;
  const list = packingLabels(data, bundle.data.boxes);
  const stamp = printedAt ?? new Date().toISOString();
  // One line per product and reason, listing the customers and amounts.
  const problemGroups: { product: string; why: string; who: string[] }[] = [];
  for (const x of list.problems) {
    const g = problemGroups.find((y) => y.product === x.product && y.why === x.why);
    const who = `${x.customer} ${x.amount}`;
    if (g) g.who.push(who);
    else problemGroups.push({ product: x.product, why: x.why, who: [who] });
  }

  async function print() {
    const now = new Date().toISOString();
    setPrintedAt(now);
    // Remember what was printed, so a later order change shows on Packing and This week.
    const err = await saveWeek(getDb(), week, { labels_hash: list.hash, labels_printed_at: now, labels_printed_by: me.id });
    if (err) toast("Printed, but couldn't note it. Check the signal.");
    bundle.refresh();
    setTimeout(() => window.print(), 50);
  }

  return (
    <>
      <div className="screen-only">
        <WeekBar processDate={data.processDate} />
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto">Box Label Report</h2>
          <Link href="/packing" className="btn ghost">
            Back to Packing
          </Link>
          <button type="button" className="btn" disabled={!list.total} onClick={() => void print()}>
            Print report ({list.total} labels)
          </button>
        </div>
        <p className="small muted mt-1">
          One row for each box: the customer, then how many and what, the box, and &quot;1 of 2&quot; when a customer gets more than one
          box of something. Boxes follow the limits in Setup &gt; Boxes.
        </p>
        <LabelsChanged hash={list.hash} printedHash={data.labelsHash} printedAt={data.labelsPrintedAt} />
      </div>

      <div className="labelsheet">
        <header className="ls-head">
          <h1>Box Label Report · Packing {weekName(week)}</h1>
          <div>
            {data.invNumber && <>INV# {data.invNumber} · </>}
            Printed {formatWhen(stamp)} · {list.total} labels
          </div>
        </header>

        {list.problems.length > 0 && (
          <div className="ls-problems" role="alert">
            <b>Fix these in Setup &gt; Boxes, then print again:</b>
            <ul>
              {problemGroups.map((g) => (
                <li key={g.product + g.why}>
                  <b>{g.product}</b>: {g.why}. {g.who.join("; ")}.
                </li>
              ))}
            </ul>
          </div>
        )}

        {!list.tables.length && !list.problems.length && <p className="empty">No orders to label for this week.</p>}

        <div className="ls-cols">
          {list.tables.map((t) => (
            <table key={t.product.id} className="ls-table">
              <caption>
                {t.product.name}
                <span>
                  {" "}
                  · {t.rows.length} label{t.rows.length === 1 ? "" : "s"}
                  {t.weightUnknown ? " · can't check weight" : ""}
                </span>
              </caption>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Box</th>
                  <th />
                  <th className="ls-ck">✓</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, i) => (
                  <tr key={i} className={i % 2 ? "zebra" : undefined}>
                    <td>
                      <b>{r.customer}</b>
                      <br />
                      {r.line2}
                    </td>
                    <td>{r.boxType}</td>
                    <td className="ls-of">{r.ofN}</td>
                    <td className="ls-ck">☐</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </div>
    </>
  );
}
