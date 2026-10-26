"use client";

// Type in from paper (change request 10/26/26): after a day packed on the
// paper copy (no internet), the weights are typed in here. Laid out exactly
// like the paper: the same customers and products in the same order, the
// same blanks with the same label numbers, and the total adding up. Tab goes
// straight across. Each box's weight is saved on its own, tied to its box
// and label number; like the rest of Packing it's saved on the phone first.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCan } from "@/components/CurrentUser";
import OfflineStatus from "@/components/offline/OfflineStatus";
import { useOutbox } from "@/components/offline/OutboxProvider";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { useToast } from "@/components/Toast";
import ViewOnly from "@/components/ViewOnly";
import { useWeek, WeekBar } from "@/components/Week";
import { fmt, num } from "@/lib/calc/num";
import type { SheetBlank, SheetRow } from "@/lib/calc/packSheet";
import { todayISO } from "@/lib/dates";
import { orderSheet, packLines, sheetLabels, type LineMark, type PackOrder } from "@/lib/db/packing";
import { isLocal, type Action } from "@/lib/offline/outbox";
import { blankLabel, PackNotes, rowWords } from "../PackSheet";
import { useLabelNumbers } from "../useLabelNumbers";

const NO_MARK: LineMark = { count: null, shorted: false, flagged: false, flagNote: "" };

export default function PaperEntryScreen() {
  const { week } = useWeek();
  const toast = useToast();
  const { enqueue } = useOutbox();
  const bundle = usePackingBundle(week, todayISO());
  const canPack = useCan("packing").change;
  useLabelNumbers(week, bundle.data, bundle.refresh, canPack);
  // "Add a box": extra blanks, by order|product.
  const [extra, setExtra] = useState<Record<string, number>>({});
  // Label numbers typed above a blank before its weight.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const labels = useMemo(() => (bundle.data ? sheetLabels(bundle.data.packing, bundle.data.boxes) : []), [bundle.data]);
  const data = bundle.data?.packing ?? null;

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const save = (a: Action) => void enqueue(a).catch(() => toast("Couldn't save on this phone. Try again."));
  const name = (pid: string) => data.products.get(pid)?.name ?? pid;

  return (
    <>
      <WeekBar inv={data.invNumber} />
      <OfflineStatus savedAt={bundle.savedAt} fromPhone={bundle.fromPhone} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">Type in from paper</h2>
        <Link href="/packing/print" className="btn ghost">
          Paper packing copy
        </Link>
        <Link href="/packing" className="btn ghost">
          &larr; Packing
        </Link>
      </div>
      <p className="small muted">
        The same order as the paper. Type each box&apos;s weight under its label number. Tab moves to the next box. Totals add
        up as you go.
      </p>
      {!canPack && <ViewOnly what="packing" />}
      {!data.orders.length && <div className="empty">No orders for this week yet.</div>}

      <fieldset disabled={!canPack} className="m-0 min-w-0 border-0 p-0">
        {data.orders.map((o) => {
          const lines = new Map(packLines(o, data.products));
          const mine = Object.fromEntries(
            Object.entries(extra)
              .filter(([k]) => k.startsWith(`${o.id}|`))
              .map(([k, n]) => [k.slice(o.id.length + 1), n]),
          );
          return (
            <section key={o.id} className="pe-cust panel mt-4" aria-label={o.customerName}>
              <h3 className="m-0">
                {o.customerName}
                {o.group && (
                  <span className="small muted font-normal">
                    {" "}
                    · {o.group}
                    {o.spot ? `, ${o.spot}` : ""}
                  </span>
                )}
              </h3>
              <PackNotes o={o} />
              {orderSheet(o, data, labels, mine).map((row) => {
                const line = lines.get(row.productId);
                const mark = o.marks[row.productId] ?? NO_MARK;
                return (
                  <div key={row.productId} className="pe-row">
                    <div className="pe-prod">
                      <b>{name(row.productId)}</b>
                      <div className="small">{rowWords(row, line)}</div>
                      {!row.known && <div className="small muted italic">box count unknown</div>}
                      {line && (
                        <label className="mt-1 flex items-center gap-2 small">
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-forest"
                            checked={mark.shorted}
                            onChange={(e) => save({ type: "mark", order_id: o.id, product_id: row.productId, mark: { ...mark, shorted: e.target.checked } })}
                          />
                          Not filled
                        </label>
                      )}
                    </div>
                    <div className="pe-blanks">
                      {row.blanks.map((b) => (
                        <Blank
                          key={b.slot}
                          o={o}
                          row={row}
                          b={b}
                          draft={drafts[`${o.id}|${row.productId}|${b.slot}`] ?? ""}
                          setDraft={(v) => setDrafts((d) => ({ ...d, [`${o.id}|${row.productId}|${b.slot}`]: v }))}
                          save={save}
                          productName={name(row.productId)}
                        />
                      ))}
                      <div className="pe-cell pe-total">
                        <span className="pe-lab">Total lbs</span>
                        <output className="pe-sum num" aria-label={`${name(row.productId)} total`}>
                          {row.total > 0 ? fmt(row.total) : "0"}
                        </output>
                      </div>
                      <button
                        type="button"
                        className="btn ghost pe-add"
                        onClick={() => setExtra((x) => ({ ...x, [`${o.id}|${row.productId}`]: (x[`${o.id}|${row.productId}`] ?? 0) + 1 }))}
                      >
                        + Add a box
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </fieldset>
    </>
  );
}

/** One blank: the label number (printed, or typed as on the paper) and the weight. */
function Blank({
  o,
  row,
  b,
  draft,
  setDraft,
  save,
  productName,
}: {
  o: PackOrder;
  row: SheetRow;
  b: SheetBlank;
  draft: string;
  setDraft: (v: string) => void;
  save: (a: Action) => void;
  productName: string;
}) {
  const w = b.weight;
  const local = w && isLocal(w as { id: string });
  const target = w ? (local ? { client_id: w.client_id ?? "" } : { weight_id: w.id }) : null;
  const typedLabel = (v: string) => (v.trim() === "" ? null : Math.round(num(v)) || null);
  const where = b.planned ? blankLabel(b) : `box ${b.slot}`;

  return (
    <div className="pe-cell">
      {b.planned ? (
        <span className="pe-lab">{blankLabel(b)}</span>
      ) : (
        <input
          key={`l:${w?.id ?? "new"}:${w?.label_no ?? ""}`}
          className="pe-labin num"
          inputMode="numeric"
          placeholder="Label #"
          aria-label={`${productName}, ${where}: label number`}
          defaultValue={w ? (w.label_no ?? "") : draft}
          onBlur={(e) => {
            const n = typedLabel(e.target.value);
            if (w && target) {
              if (n !== w.label_no) save({ type: "weight-edit", order_id: o.id, ...target, weight: w.weight, label_no: n });
            } else setDraft(e.target.value);
          }}
        />
      )}
      <input
        key={`w:${w?.id ?? "new"}:${w?.weight ?? ""}`}
        className="pe-weight num"
        inputMode="decimal"
        aria-label={`${productName}, ${where}: weight in lb`}
        defaultValue={w ? fmt(w.weight) : ""}
        onBlur={(e) => {
          const v = e.target.value.trim();
          const lb = Math.round(num(v) * 100) / 100;
          if (w && target) {
            if (v === "" || !(lb > 0)) save({ type: "weight-remove", order_id: o.id, ...target });
            else if (lb !== w.weight) save({ type: "weight-edit", order_id: o.id, ...target, weight: lb, label_no: w.label_no });
          } else if (lb > 0) {
            save({
              type: "weight-add",
              client_id: crypto.randomUUID(),
              order_id: o.id,
              product_id: row.productId,
              weight: lb,
              box_no: null,
              at: new Date().toISOString(),
              slot: b.slot,
              label_no: b.planned ? b.labelNo : typedLabel(draft),
            });
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </div>
  );
}
