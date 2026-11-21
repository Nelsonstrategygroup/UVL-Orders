"use client";

// P&L Setup: Freezer value (Kathy's rule, 11/20/26). Product put in the
// freezer counts at this percent of its default sale price, because some of
// it never sells at full price. Each from a date on, like the other rates: a
// box uses the newest percent on or before the day it went in, and keeps it.
// Admins only.

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { niceDate, todayISO } from "@/lib/dates";
import { deleteFreezerRate, saveFreezerRate } from "@/lib/db/freezer";

type Rate = { id: string; effective_from: string; percent: number; note: string };

async function loadRates(db: SupabaseClient): Promise<Rate[]> {
  const { data, error } = await db.from("freezer_value_rates").select("id, effective_from, percent, note").order("effective_from", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Rate[]).map((r) => ({ ...r, percent: Number(r.percent) }));
}

export default function FreezerValueSetup() {
  const db = getDb();
  const toast = useToast();
  const load = useCallback((d: SupabaseClient) => loadRates(d), []);
  const { data, error, refresh } = useLive("freezer-value-rates", load, []);
  const [percent, setPercent] = useState("");
  const [from, setFrom] = useState(() => todayISO());
  const [note, setNote] = useState("");
  if (error) return <p className="note bad mt-3">Couldn&apos;t load the freezer value: {error}</p>;
  if (!data) return null;
  const n = Number(percent);
  const ok = percent.trim() !== "" && n >= 0 && n <= 100;

  return (
    <section className="panel mt-3" aria-labelledby="pnl-freezer">
      <h3 id="pnl-freezer">Freezer value: percent of default sale price</h3>
      <p className="small muted mt-1">
        Product put in the freezer counts on the Weekly P&amp;L at this percent of its default sale price on the day it went in (Into
        freezer). What comes out for an order is taken back at the value it went in at (Out of freezer). A change applies to boxes put in
        from its date on; boxes already in keep their value.
      </p>
      <table className="simple">
        <tbody>
          {data.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">From {niceDate(r.effective_from)}, {r.effective_from.slice(0, 4)}</td>
              <td className="num">
                <b>{r.percent}%</b>
              </td>
              <td className="small muted">{r.note}</td>
              <td>
                <button
                  type="button"
                  className="copy min-h-[44px] px-2"
                  onClick={() => {
                    if (!confirm(`Remove the ${r.percent}% from ${niceDate(r.effective_from)}? Boxes already in keep their value.`)) return;
                    void deleteFreezerRate(db, r.id).then((e) => {
                      toast(e ? `Couldn't remove it: ${e}` : "Removed");
                      refresh();
                    });
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.length && <p className="note">No percent set: boxes put in the freezer have no value until one is.</p>}
      <form
        className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return toast("Enter a percent from 0 to 100");
          void saveFreezerRate(db, { effective_from: from, percent: n, note: note.trim() }).then((err) => {
            toast(err ? `Couldn't save: ${err}` : `${n}% from ${niceDate(from)}`);
            if (!err) {
              setPercent("");
              setNote("");
            }
            refresh();
          });
        }}
      >
        <label className="grid gap-1">
          <span className="lbl m-0">Percent</span>
          <input className="field w-24" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">From</span>
          <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value || todayISO())} />
        </label>
        <label className="grid min-w-[10rem] flex-1 gap-1">
          <span className="lbl m-0">Note</span>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn ghost" disabled={!ok}>
          Save
        </button>
      </form>
    </section>
  );
}
