"use client";

// The lower part of the Freezer screen (11/20/26): boxes in the freezer, labels
// an admin still has to confirm, the freezer value (admins), and past counts.

import Link from "next/link";
import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { freezerBalance, REMOVE_REASONS } from "@/lib/calc/freezer";
import { centsText } from "@/lib/calc/prices";
import { cents } from "@/lib/calc/pnl";
import { niceDate } from "@/lib/dates";
import {
  confirmFreezerBox,
  loadFreezerScreen,
  removeFreezerBox,
  setFreezerIncome,
  takeFromFreezer,
  type FreezerScreenData,
} from "@/lib/db/freezer";

type Box = FreezerScreenData["boxes"][number];

const REASON_WORD: Record<string, string> = {
  added_manually: "Added manually",
  found: "Found in freezer",
  put_away: "Put away outside packing",
  leftover: "Leftover from packing",
  stock_in: "Stock-in count",
  other: "Other",
};

export function FreezerExtras({ canChange, isAdmin, nameOf }: { canChange: boolean; isAdmin: boolean; nameOf: (id: string) => string }) {
  const db = getDb();
  const toast = useToast();
  const load = useCallback((d: SupabaseClient) => loadFreezerScreen(d, isAdmin), [isAdmin]);
  const { data, error, refresh } = useLive(`freezer-extras:${isAdmin}`, load, ["freezer_boxes", "freezer_takes", "freezer_counts"]);
  const [taking, setTaking] = useState<Box | null>(null);

  if (error) return <p className="note bad mt-4">Couldn&apos;t load the freezer boxes: {error}</p>;
  if (!data) return null;

  const inNow = data.boxes.filter((b) => b.qty_left > 0);
  const toConfirm = inNow.filter((b) => !b.product_confirmed);
  const balance = freezerBalance(inNow.map((b) => ({ ...b, price: b.price ?? null, price_unit: b.price_unit ?? null, percent: b.percent ?? null, value: b.value ?? null, note: b.value_note })));
  const percent = data.rates.length ? data.rates[data.rates.length - 1] : null;

  async function run(p: Promise<string | null>, ok: string) {
    const err = await p;
    refresh();
    toast(err ? `Couldn't save: ${err}` : ok);
  }

  return (
    <>
      {isAdmin && (
        <section className="panel mt-4">
          <h3>Freezer value</h3>
          <p className="mb-1">
            <b className="text-xl">{centsText(balance.cents)}</b> for {balance.boxes} {balance.boxes === 1 ? "box" : "boxes"} in the freezer now.
          </p>
          <p className="small muted mb-0">
            Each box counts at {percent ? `${percent.percent}%` : "a percent"} of its default sale price on the day it went in (P&amp;L Setup).
            {balance.noValue > 0 && ` ${balance.noValue} ${balance.noValue === 1 ? "box has" : "boxes have"} no freezer value: no default price or no weight.`}
            {" "}Only admins see this.
          </p>
        </section>
      )}

      {isAdmin && toConfirm.length > 0 && (
        <section className="panel mt-4">
          <h3>Labels to confirm</h3>
          <p className="small muted">The app didn&apos;t know these labels. Someone chose the product. Check it; the app learns the label.</p>
          <table className="simple">
            <tbody>
              {toConfirm.map((b) => (
                <ConfirmRow key={b.id} b={b} nameOf={nameOf} onConfirm={(pid) => void run(confirmFreezerBox(db, b.id, pid), "Product confirmed")} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel mt-4">
        <h3>Boxes in the freezer ({inNow.length})</h3>
        {inNow.length ? (
          <div className="overflow-x-auto">
            <table className="simple">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Left</th>
                  <th className="num">Lb</th>
                  <th>Lot</th>
                  <th>Added</th>
                  {isAdmin && <th className="num">Value</th>}
                  {isAdmin && <th>Freezer income</th>}
                  {canChange && <th />}
                </tr>
              </thead>
              <tbody>
                {inNow.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {nameOf(b.product_id)}
                      {b.serial && <span className="small muted block">Serial {b.serial}</span>}
                    </td>
                    <td className="num">{b.qty_left}</td>
                    <td className="num">{b.weight_lb ?? ""}</td>
                    <td>{b.lot ?? ""}</td>
                    <td className="small">
                      {niceDate(b.added_on)}
                      <span className="muted block">{REASON_WORD[b.reason] ?? b.reason}</span>
                    </td>
                    {isAdmin && <td className="num">{b.value != null ? centsText(cents(b.value)) : <span className="small muted">{b.value_note.replace("No freezer value: ", "")}</span>}</td>}
                    {isAdmin && (
                      <td>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-5 w-5"
                            checked={b.counts_as_income}
                            onChange={(e) => void run(setFreezerIncome(db, b.id, e.target.checked), e.target.checked ? "Counts as freezer income" : "Doesn't count as freezer income")}
                          />
                          <span className="small">Week of {niceDate(b.week_id)}</span>
                        </label>
                      </td>
                    )}
                    {canChange && (
                      <td className="whitespace-nowrap">
                        <button type="button" className="copy min-h-[44px]" onClick={() => setTaking(b)}>
                          Take out
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">No boxes recorded yet. Use Add to freezer or a freezer count.</div>
        )}
      </section>

      <section className="panel mt-4">
        <h3>Freezer counts</h3>
        {data.counts.length ? (
          <table className="simple">
            <tbody>
              {data.counts.map((c) => {
                const t = (c.results as { totals?: { app: number; counted: number; difference: number } } | null)?.totals;
                return (
                  <tr key={c.id}>
                    <td className="small whitespace-nowrap">{niceDate(c.count_date)}</td>
                    <td>
                      <Link href={`/freezer/count/${c.id}`}>{c.kind === "stock_in" ? "Stock-in count" : "Freezer count"}</Link>
                      {c.product_ids?.length ? <span className="small muted block">Only some products</span> : null}
                    </td>
                    <td className="small">{c.status === "applied" ? "Applied" : "Thrown away"}</td>
                    <td className="small muted">{t && c.kind === "reconcile" ? `Counted ${t.counted}, app ${t.app}, difference ${t.difference > 0 ? "+" : ""}${t.difference}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty">No counts yet.</div>
        )}
      </section>

      {taking && (
        <TakeOut
          b={taking}
          name={nameOf(taking.product_id)}
          onClose={() => setTaking(null)}
          onRemoveMistake={async () => {
            setTaking(null);
            await run(removeFreezerBox(db, taking.id), "Box removed");
          }}
          onTake={async (qty, reason, note) => {
            setTaking(null);
            await run(takeFromFreezer(db, { box_id: taking.id, qty, reason, note }), "Taken out of the freezer");
          }}
        />
      )}
    </>
  );
}

function ConfirmRow({ b, nameOf, onConfirm }: { b: Box; nameOf: (id: string) => string; onConfirm: (pid: string) => void }) {
  const [pid, setPid] = useState(b.product_id);
  return (
    <tr>
      <td>
        {nameOf(b.product_id)}
        <span className="small muted block">
          GTIN {b.gtin ?? "none"}
          {b.serial ? ` · Serial ${b.serial}` : ""}
          {b.weight_lb ? ` · ${b.weight_lb} lb` : ""}
        </span>
      </td>
      <td>
        <ConfirmSelect value={pid} onChange={setPid} />
      </td>
      <td>
        <button type="button" className="btn" onClick={() => onConfirm(pid)}>
          Confirm
        </button>
      </td>
    </tr>
  );
}

/** The product list, from the catalog the Freezer screen already has. */
function ConfirmSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { catalog } = useStaffData();
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Product">
      {(catalog?.products ?? [])
        .filter((p) => p.active || p.id === value)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
    </select>
  );
}

function TakeOut({
  b,
  name,
  onClose,
  onTake,
  onRemoveMistake,
}: {
  b: Box;
  name: string;
  onClose: () => void;
  onTake: (qty: number, reason: string, note: string) => Promise<void>;
  onRemoveMistake: () => Promise<void>;
}) {
  const [qty, setQty] = useState(String(b.qty_left));
  const [reason, setReason] = useState("sold");
  const [note, setNote] = useState("");
  const q = Number(qty);
  const ok = q > 0 && q <= b.qty_left && (reason !== "other" || note.trim() !== "");
  return (
    <Sheet title={`Take out: ${name}`} onClose={onClose}>
      <label className="lbl" htmlFor="to-qty">
        How many (of {b.qty_left} left)
      </label>
      <input id="to-qty" className="field" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))} />
      <label className="lbl" htmlFor="to-reason">
        Why
      </label>
      <select id="to-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
        {REMOVE_REASONS.filter(([v]) => v !== "not_found").map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <label className="lbl" htmlFor="to-note">
        Note{reason === "other" ? "" : " (optional)"}
      </label>
      <input id="to-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="small muted mt-2">This changes freezer inventory only. It doesn&apos;t change any order, invoice or the P&amp;L.</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn ghost mr-auto"
          onClick={() => {
            if (window.confirm(`Remove ${name} completely? Use this only if it was added by mistake.`)) void onRemoveMistake();
          }}
        >
          Added by mistake
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={!ok} onClick={() => void onTake(q, reason, note.trim())}>
          Take out
        </button>
      </div>
    </Sheet>
  );
}
