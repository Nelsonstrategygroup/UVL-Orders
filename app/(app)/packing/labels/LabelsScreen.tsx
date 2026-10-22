"use client";

// The box label list (SPEC 12.5): one row per box, so Kathy can print every
// customer label before packing day. Each row has a label number for the
// week, and the labels print on Avery 5963 sheets (change request 10/23/26):
// rows remember when they were printed and show "Changed since printed" if
// the order changed after. Labels are never edited here: corrections go
// through the order, so the report, labels, and packing record agree.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import PrintLabels, { type PrintRow } from "./PrintLabels";
import { labelState, reportLabels, type StoredLabel } from "@/lib/calc/labels";
import { assignBoxLabels, recordLabelPrint } from "@/lib/db/labels";

export default function LabelsScreen() {
  const { week } = useWeek();
  const me = useMe();
  const toast = useToast();
  const bundle = usePackingBundle(week, todayISO());
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Label numbers and print state, for the rows on the report (by key).
  const [stored, setStored] = useState<{ sig: string; map: Map<string, StoredLabel> | null } | null>(null);
  const [reload, setReload] = useState(0);

  const data = bundle.data?.packing ?? null;
  const list = useMemo(() => (bundle.data ? packingLabels(bundle.data.packing, bundle.data.boxes) : null), [bundle.data]);
  const labels = useMemo(() => (list ? reportLabels(list) : []), [list]);
  const keys = labels.map((l) => l.key);
  const sig = `${week}|${reload}|${keys.join(",")}`;

  // Number any new rows (in report order) and get every row's print state.
  useEffect(() => {
    if (!keys.length) return;
    let live = true;
    assignBoxLabels(getDb(), week, keys).then((map) => live && setStored({ sig, map }));
    return () => {
      live = false;
    };
    // keys is captured by sig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, week]);

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!bundle.data || !data || !list)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  if (!data || !list) return null;
  const nums = stored?.sig === sig ? stored.map : null;
  const rows: PrintRow[] = nums
    ? labels
        .filter((l) => nums.has(l.key))
        .map((l) => ({
          key: l.key,
          print: l.print,
          productId: l.productId,
          customer: l.customer,
          number: nums.get(l.key)!.number,
          name: l.name,
          location: l.location,
          what: l.line2,
          boxNo: l.boxNo,
          boxCount: l.boxCount,
          boxType: l.boxType,
        }))
    : [];
  const changedKeys = labels.filter((l) => labelState(l, nums?.get(l.key)).changed).map((l) => l.key);

  async function printed(done: PrintRow[], all: boolean) {
    const err = await recordLabelPrint(getDb(), week, done.map((r) => ({ number: r.number, print: r.print })));
    if (err) toast("Printed, but couldn't note it. Check the signal.");
    // Printing them all also stamps the week, for This week's "Box labels" step.
    if (all) await saveWeek(getDb(), week, { labels_hash: list!.hash, labels_printed_at: new Date().toISOString(), labels_printed_by: me.id });
    setSelected(new Set());
    setReload((n) => n + 1);
    bundle.refresh();
  }

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
    const err = await saveWeek(getDb(), week, { labels_hash: list!.hash, labels_printed_at: now, labels_printed_by: me.id });
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
          <button type="button" className="btn ghost" disabled={!list.total} onClick={() => void print()}>
            Print report ({list.total} labels)
          </button>
        </div>
        <p className="small muted mt-1">
          One row for each box: the customer, then how many and what, the box, and &quot;1 of 2&quot; when a customer gets more than one
          box of something. Boxes follow the limits in Setup &gt; Boxes.
        </p>
        <LabelsChanged hash={list.hash} printedHash={data.labelsHash} printedAt={data.labelsPrintedAt} />
        {list.total > 0 && (
          <PrintLabels
            rows={rows}
            products={list.tables.map((t) => [t.product.id, t.product.name] as [string, string])}
            selected={selected}
            setSelected={setSelected}
            changedKeys={changedKeys}
            ready={!!nums}
            onPrinted={printed}
          />
        )}
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
                  <th className="ls-pick screen-only">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="ls-num">#</th>
                  <th>Label</th>
                  <th>Box</th>
                  <th />
                  <th className="ls-ck">✓</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, i) => {
                  const st = nums?.get(r.key);
                  const { printed: wasPrinted, changed } = labelState(r, st);
                  return (
                  <tr key={r.key} className={r.noBox ? "ls-nobox" : i % 2 ? "zebra" : undefined}>
                    <td className="ls-pick screen-only">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-forest"
                        aria-label={`Select label ${st?.number ?? ""}: ${r.customer}, ${r.line2}`}
                        checked={selected.has(r.key)}
                        disabled={!st}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(r.key);
                          else next.delete(r.key);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td className="ls-num">{st ? `#${st.number}` : ""}</td>
                    <td>
                      <b>{r.customer}</b>
                      <br />
                      {r.line2}
                      {changed ? (
                        <span className="ls-changed">Changed since printed</span>
                      ) : wasPrinted ? (
                        <span className="ls-printed screen-only">
                          Printed {formatWhen(st!.printed_at!)}
                          {st!.printed_by_name ? ` by ${st!.printed_by_name}` : ""}
                        </span>
                      ) : null}
                    </td>
                    <td>{r.boxType}</td>
                    <td className="ls-of">{r.ofN}</td>
                    <td className="ls-ck">☐</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        </div>
      </div>
    </>
  );
}
