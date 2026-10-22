"use client";

// The box label list (SPEC 12.5): one row per box, so Kathy can print every
// customer label before packing day. Printing saves a fingerprint of the
// list; This week then says if orders change afterward.

import Link from "next/link";
import { useState } from "react";
import { useMe } from "@/components/CurrentUser";
import { getDb } from "@/components/data/db";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { todayISO, weekName } from "@/lib/dates";
import { boxCellsToCheck } from "@/lib/calc/boxes";
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
  // Products with no box size yet get normal tables with box "?"; the top line links to them.
  const noBox = list.tables.filter((t) => t.noBox);
  const noBoxNote = noBox.length ? ` (${noBox.length} product${noBox.length === 1 ? "" : "s"} without box sizes)` : "";
  // Boxes still to check are simply not used; one quiet line, not a warning.
  const toCheck = boxCellsToCheck(
    bundle.data.boxes.limits,
    [...data.products.values()].filter((p) => p.active).map((p) => p.id),
  );

  async function print() {
    const now = new Date().toISOString();
    setPrintedAt(now);
    // Remember what was printed, so a later order change shows on This week.
    const err = await saveWeek(getDb(), week, { labels_hash: list.hash, labels_printed_at: now, labels_printed_by: me.id });
    if (err) toast("Printed, but couldn't note it. Check the signal.");
    bundle.refresh();
    setTimeout(() => window.print(), 50);
  }

  return (
    <>
      <div className="screen-only">
        <WeekBar inv={data.invNumber} />
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto">Box Label Report</h2>
          <Link href="/week" className="btn ghost">
            &larr; This week
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
            Printed {formatWhen(stamp)} · {list.total} labels{noBoxNote}
          </div>
        </header>

        {noBox.length > 0 && (
          <p className="ls-nobox-top">
            {noBox.length} product{noBox.length === 1 ? " has" : "s have"} no box size yet:{" "}
            {noBox.map((t, i) => (
              <span key={t.product.id}>
                {i > 0 && ", "}
                <a href={`#lt-${t.product.id}`}>{t.product.name}</a>
              </span>
            ))}
            .
          </p>
        )}
        {list.weightUnknown && (
          <p className="ls-tocheck">
            Weights per piece aren&apos;t set for some products, so the 45 lb limit is only checked for products sold by the
            pound.{" "}
            <Link href="/setup/products" className="copy">
              Setup &gt; Products
            </Link>
          </p>
        )}
        {toCheck > 0 && (
          <p className="ls-tocheck">
            Some box sizes are still to be checked in{" "}
            <Link href="/setup/boxes" className="copy">
              Setup &gt; Boxes
            </Link>{" "}
            ({toCheck}).
          </p>
        )}

        {!list.tables.length && <p className="empty">No orders to label for this week.</p>}

        <div className="ls-cols">
          {list.tables.map((t) => (
            <table key={t.product.id} id={`lt-${t.product.id}`} className="ls-table">
              <caption>
                {t.product.name}
                <span>
                  {" "}
                  · {t.rows.length} label{t.rows.length === 1 ? "" : "s"}
                </span>
                {t.noBox && (
                  <span className="ls-nobox-note">
                    Box size not worked out. Needs a weight per pack in Setup &gt; Products, or a pack count in Setup &gt; Boxes.
                    One label per customer for now; a large order may need more than one box.
                  </span>
                )}
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
                  <tr key={i} className={r.noBox ? "ls-nobox" : i % 2 ? "zebra" : undefined}>
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
