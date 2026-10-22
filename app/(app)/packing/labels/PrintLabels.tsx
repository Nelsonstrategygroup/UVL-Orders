"use client";

// Printing box labels on Avery 5963 sheets from the Box Label Report (change
// request 10/23/26): Print all or Print selected, starting at any position
// on a partly used sheet, as a PDF drawn at exact sizes. Selecting is done
// on the report rows; this is the panel above them.

import { useState } from "react";
import { getLabelOffset } from "@/components/labelOffset";
import { useToast } from "@/components/Toast";
import { alignmentPdf, labelsPdf, parseRange, PER_SHEET, type PrintLabel } from "@/lib/labels/avery5963";

/** Open a PDF in a new tab to print. The tab is opened on the tap, so it isn't blocked. */
async function openPdf(make: () => Promise<Uint8Array>, name: string) {
  const tab = window.open("", "_blank");
  const bytes = await make();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  if (tab) tab.location.href = url;
  else {
    // Pop-ups blocked: download it instead.
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type PrintRow = PrintLabel & { key: string; print: string; productId: string; customer: string };

export default function PrintLabels({
  rows,
  products,
  selected,
  setSelected,
  changedKeys,
  ready,
  onPrinted,
}: {
  /** Every box row with its label number, in report order. */
  rows: PrintRow[];
  /** The report's products, in order: [id, name]. */
  products: [string, string][];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  /** Rows changed since they were printed. */
  changedKeys: string[];
  /** Label numbers loaded (they need signal). */
  ready: boolean;
  /** After a print: record which labels went out (and whether it was everything). */
  onPrinted: (printed: PrintRow[], all: boolean) => Promise<void>;
}) {
  const toast = useToast();
  const [start, setStart] = useState(1);
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);
  const customers = [...new Set(rows.map((r) => r.customer))].sort((a, b) => a.localeCompare(b));
  const chosen = rows.filter((r) => selected.has(r.key));

  async function print(list: PrintRow[], all: boolean) {
    if (!list.length) return;
    setBusy(true);
    try {
      await openPdf(() => labelsPdf(list, { start, offset: getLabelOffset() }), "box-labels.pdf");
      await onPrinted(list, all);
      // The next print starts where this one ended, for a partly used sheet.
      setStart(((start - 1 + list.length) % PER_SHEET) + 1);
    } catch {
      toast("Couldn't make the labels. Try again.");
    }
    setBusy(false);
  }

  const pick = (keys: string[]) => setSelected(new Set(keys));

  return (
    <section className="panel mt-3 lp">
      <h3 className="m-0">Print labels (Avery 5963)</h3>
      {!ready ? (
        <p className="note small mt-2 mb-0">Label numbers need signal. Connect, then come back to print labels.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-start gap-4">
            <div>
              <span className="lbl m-0">Start at label</span>
              <div className="startgrid" role="group" aria-label="Start at label">
                {Array.from({ length: PER_SHEET }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" aria-pressed={start === n} onClick={() => setStart(n)} aria-label={`Start at label ${n}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid flex-1 gap-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn" disabled={busy || !rows.length} onClick={() => void print(rows, true)}>
                  Print all ({rows.length})
                </button>
                <button type="button" className="btn ghost" disabled={busy || !chosen.length} onClick={() => void print(chosen, false)}>
                  Print selected ({chosen.length})
                </button>
              </div>
              <p className="small m-0">
                <b>Print at Actual size / 100%, not Fit to page.</b>
              </p>
              <p className="small muted m-0">
                A partly used sheet: tap the first empty label. Labels go left to right, top to bottom.{" "}
                <button type="button" className="copy" onClick={() => void openPdf(() => alignmentPdf(getLabelOffset()), "alignment-test.pdf")}>
                  Alignment test
                </button>{" "}
                (plain paper; set an offset in My account if it&apos;s off)
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <button type="button" className="btn ghost" onClick={() => pick(rows.map((r) => r.key))}>
              Select all
            </button>
            <button type="button" className="btn ghost" disabled={!selected.size} onClick={() => pick([])}>
              Clear
            </button>
            {changedKeys.length > 0 && (
              <button type="button" className="btn ghost text-barn" onClick={() => pick(changedKeys)}>
                Select changed ({changedKeys.length})
              </button>
            )}
            <label className="grid gap-1">
              <span className="lbl m-0">Select product</span>
              <select className="field" value="" onChange={(e) => e.target.value && pick(rows.filter((r) => r.productId === e.target.value).map((r) => r.key))}>
                <option value="">Pick...</option>
                {products.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="lbl m-0">Select customer</span>
              <select className="field" value="" onChange={(e) => e.target.value && pick(rows.filter((r) => r.customer === e.target.value).map((r) => r.key))}>
                <option value="">Pick...</option>
                {customers.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="lbl m-0">Labels (e.g. 14-20)</span>
              <span className="flex gap-1">
                <input className="field w-28!" value={range} onChange={(e) => setRange(e.target.value)} placeholder="14-20" />
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!parseRange(range).size}
                  onClick={() => {
                    const want = parseRange(range);
                    pick(rows.filter((r) => want.has(r.number)).map((r) => r.key));
                  }}
                >
                  Select
                </button>
              </span>
            </label>
          </div>
        </>
      )}
    </section>
  );
}
