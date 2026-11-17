"use client";

// P&L Setup: truck drivers (Lucas, 11/16/26). Each driver's pay per run, from
// a date on: base + per extra stop − per skipped stop ($290, $40, $40 to
// start). Maintenance per run is charged only for drivers with it turned on
// (off to start). Admins only.

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { centsText } from "@/lib/calc/lambCost";
import { parseMoney } from "@/lib/calc/pnl";
import { driverRateOn, type DriverRate, type TruckDriver } from "@/lib/calc/truck";
import { niceDate, todayISO } from "@/lib/dates";
import { deleteDriverRate, loadDrivers, saveDriver, saveDriverRate } from "@/lib/db/trucks";

const money = (v: string | number) => centsText(BigInt(Math.round(Number(v) * 100)));
const dateText = (d: string) => `${niceDate(d)}, ${d.slice(0, 4)}`;
/** A typed amount that may be 0. */
const amountOk = (t: string) => (t.trim() === "0" ? "0" : parseMoney(t));
const rateWords = (r: DriverRate) => `${money(r.base)} a run, + ${money(r.per_extra)} per extra stop, − ${money(r.per_skipped)} per skipped stop`;

export default function TruckDrivers() {
  const db = getDb();
  const toast = useToast();
  const load = useCallback((d: SupabaseClient) => loadDrivers(d), []);
  const { data, refresh, error } = useLive("truck-drivers", load, ["truck_drivers", "truck_driver_rates"]);
  const [name, setName] = useState("");
  const after = (err: string | null, ok: string) => {
    toast(err ? `Couldn't save: ${err}` : ok);
    refresh();
    return !err;
  };
  if (error) return <p className="note bad mt-3">Couldn&apos;t load the drivers: {error}</p>;
  if (!data) return null;

  return (
    <section className="panel mt-3" aria-labelledby="truck-drivers">
      <h3 id="truck-drivers">Truck drivers</h3>
      <p className="small muted mt-1">
        Driver pay per run, from a start date on: base + per extra stop − per skipped stop. Truck runs are entered on the Truck
        runs page. Maintenance per run counts only for drivers with it on.
      </p>
      {data.drivers.length === 0 && <p className="small m-0">No drivers yet.</p>}
      <ul className="m-0 list-none p-0">
        {data.drivers.map((d) => (
          <DriverRow key={d.id} d={d} rates={data.rates.filter((r) => r.driver_id === d.id)} after={after} />
        ))}
      </ul>
      <form
        className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void saveDriver(db, { name, active: true, maintenance: false }, { from: "2026-10-08", base: "290", perExtra: "40", perSkipped: "40" }).then((err) => {
            if (after(err, `Added ${name.trim()}: $290 a run, ± $40 a stop, from Oct 8, 2026`)) setName("");
          });
        }}
      >
        <label className="grid min-w-[12rem] flex-1 gap-1">
          <span className="lbl m-0">New driver</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="btn ghost" disabled={!name.trim()}>
          Add
        </button>
      </form>
      <p className="small muted m-0 mt-1">A new driver starts at $290 a run, + $40 per extra stop, − $40 per skipped stop, from Oct 8, 2026.</p>
    </section>
  );
}

function DriverRow({ d, rates, after }: { d: TruckDriver; rates: DriverRate[]; after: (err: string | null, ok: string) => boolean }) {
  const db = getDb();
  const toast = useToast();
  const now = driverRateOn(rates, d.id, todayISO());
  const [from, setFrom] = useState(todayISO());
  const [base, setBase] = useState(now ? String(Number(now.base)) : "290");
  const [extra, setExtra] = useState(now ? String(Number(now.per_extra)) : "40");
  const [skipped, setSkipped] = useState(now ? String(Number(now.per_skipped)) : "40");
  const [note, setNote] = useState("");

  const add = async () => {
    const [b, x, s] = [amountOk(base), amountOk(extra), amountOk(skipped)];
    if (b == null || x == null || s == null) return toast("Type amounts like 290.00");
    after(await saveDriverRate(db, { driverId: d.id, from, base: b, perExtra: x, perSkipped: s, note }), `Saved from ${niceDate(from)}`);
  };

  return (
    <li className="border-t border-line py-1.5">
      <details>
        <summary className="cursor-pointer">
          <b className={d.active ? "" : "muted"}>{d.name}</b>
          {!d.active && <span className="tag ml-2">Off</span>}
          <span className="small muted">
            {" "}
            · {now ? rateWords(now) : "no rate today"} · maintenance {d.maintenance ? "on" : "off"}
          </span>
        </summary>
        <div className="mt-2 grid gap-2 pl-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn ghost"
              onClick={() => void saveDriver(db, { id: d.id, maintenance: !d.maintenance }).then((err) => after(err, `Maintenance ${d.maintenance ? "off" : "on"} for ${d.name}`))}
            >
              {d.maintenance ? "Turn maintenance off" : "Turn maintenance on"}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void saveDriver(db, { id: d.id, active: !d.active }).then((err) => after(err, d.active ? `${d.name} turned off` : `${d.name} back on`))}
            >
              {d.active ? "Turn off (no longer drives)" : "Turn back on"}
            </button>
          </div>
          <div>
            <div className="lbl m-0">Pay rates</div>
            <ul className="small m-0 list-none p-0">
              {[...rates]
                .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
                .map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3">
                    <span className="num">{rateWords(r)}</span>
                    <span className="muted">from {dateText(r.effective_from)}</span>
                    {r.note && <span className="muted">{r.note}</span>}
                    <button
                      type="button"
                      className="copy min-h-[44px] px-2"
                      onClick={() => {
                        if (confirm(`Delete ${d.name}'s rate starting ${dateText(r.effective_from)}?`)) void deleteDriverRate(db, r.id).then((err) => after(err, "Deleted"));
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
            </ul>
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <label className="grid gap-1">
              <span className="lbl m-0">Starts on</span>
              <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="lbl m-0">$ a run</span>
              <input className="field num w-24!" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="lbl m-0">+ per extra stop</span>
              <input className="field num w-24!" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="lbl m-0">− per skipped stop</span>
              <input className="field num w-24!" inputMode="decimal" value={skipped} onChange={(e) => setSkipped(e.target.value)} />
            </label>
            <label className="grid min-w-[8rem] flex-1 gap-1">
              <span className="lbl m-0">Note (optional)</span>
              <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button type="submit" className="btn ghost">
              Add rate
            </button>
          </form>
        </div>
      </details>
    </li>
  );
}
