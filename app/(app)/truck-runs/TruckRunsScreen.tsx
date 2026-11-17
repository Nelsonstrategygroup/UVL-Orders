"use client";

// Truck runs (Lucas, 11/16/26): each delivery run with its date, driver,
// stops (picked from customer locations and distributors, or typed), extra
// and skipped stops, fuel, a note and a receipt. Driver pay is worked out
// from the driver's rate (P&L Setup). Each run counts toward the week that
// contains its date. Office, Billing and admins enter them.

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import { centsText } from "@/lib/calc/lambCost";
import { parseMoney } from "@/lib/calc/pnl";
import { runPay, stopsMade, type RunPay, type StopKind } from "@/lib/calc/truck";
import { isISODate, longDate, weekDays, weekName } from "@/lib/dates";
import { deleteRun, loadDrivers, loadWeekRuns, saveRun, type StopInput } from "@/lib/db/trucks";
import { shrinkPhoto } from "@/lib/shrinkPhoto";
import { FileButton } from "../pnl/Adjustments";

const KIND_LABEL: Record<StopKind, string> = { stop: "Stop", extra: "Extra stop", skipped: "Skipped" };

async function loadPoints(db: SupabaseClient) {
  const { data } = await db.from("consolidation_points").select("id, name, short_name, active").order("name");
  return ((data ?? []) as { id: string; name: string; short_name: string; active: boolean }[]).filter((p) => p.active);
}

export default function TruckRunsScreen() {
  const { week, setWeek } = useWeek();
  const asked = useSearchParams().get("week");
  useEffect(() => {
    if (asked && isISODate(asked) && asked !== week) setWeek(asked);
    // Only when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const canEdit = useCan("trucks").change;
  const load = useCallback((d: SupabaseClient) => loadWeekRuns(d, week), [week]);
  const { data, error, refresh } = useLive(`truck-runs:${week}`, load, ["truck_runs", "truck_run_stops"]);
  const loadD = useCallback((d: SupabaseClient) => loadDrivers(d), []);
  const { data: drivers } = useLive("truck-drivers", loadD, ["truck_drivers", "truck_driver_rates"]);
  const loadP = useCallback((d: SupabaseClient) => loadPoints(d), []);
  const { data: points } = useLive("consolidation-points", loadP, ["consolidation_points"]);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const head = (
    <div className="noprint">
      <WeekBar />
    </div>
  );
  if (error) return <>{head}<p className="note bad">Couldn&apos;t load the truck runs: {error}</p></>;
  if (!data || !drivers) return <>{head}<p className="small muted">Loading...</p></>;
  const runs = data.runs.map((r) => runPay(r, data.stops, drivers.drivers, drivers.rates));
  const fuel = runs.reduce((t, r) => t + (r.fuel ?? BigInt(0)), BigInt(0));
  const pay = runs.reduce((t, r) => t + (r.pay ?? BigInt(0)), BigInt(0));

  return (
    <div className="max-w-[900px]">
      {head}
      <h2 className="mt-2 mb-0">Truck runs · {weekName(week)}</h2>
      <p className="small muted mt-1">
        Each delivery run, with its driver, stops and fuel. A run counts toward the week that contains its date (Thursday{" "}
        {longDate(weekDays(week)[0]).split(", ")[1]} to Wednesday {longDate(weekDays(week)[6]).split(", ")[1]}). Driver pay comes
        from the driver&apos;s rate in P&amp;L Setup.
      </p>
      {runs.length > 0 && (
        <p className="small">
          {runs.length} {runs.length === 1 ? "run" : "runs"} · {runs.reduce((t, r) => t + stopsMade(r), 0)} stops made · driver pay{" "}
          {centsText(pay)}
          {runs.some((r) => r.pay == null) ? " so far" : ""} · fuel {centsText(fuel)}
          {runs.some((r) => r.fuel == null) ? " so far" : ""}
        </p>
      )}
      {runs.length === 0 && editing !== "new" && <p className="note">No truck runs entered for this week.</p>}
      <ul className="m-0 list-none p-0">
        {runs.map((r) =>
          editing === r.run.id ? (
            <li key={r.run.id} className="panel mt-3">
              <RunForm week={week} run={r} drivers={drivers.drivers} points={points ?? []} onDone={() => (setEditing(null), refresh())} />
            </li>
          ) : (
            <RunCard key={r.run.id} r={r} canEdit={canEdit} onEdit={() => setEditing(r.run.id)} onDeleted={refresh} />
          ),
        )}
      </ul>
      {canEdit &&
        (editing === "new" ? (
          <section className="panel mt-3" aria-label="New truck run">
            <RunForm week={week} drivers={drivers.drivers} points={points ?? []} onDone={() => (setEditing(null), refresh())} />
          </section>
        ) : (
          <div className="mt-3">
            <button type="button" className="btn" onClick={() => setEditing("new")}>
              Add a run
            </button>
          </div>
        ))}
      {canEdit && drivers.drivers.filter((d) => d.active).length === 0 && (
        <p className="note mt-3">No drivers yet. An admin adds them in Setup &gt; P&amp;L Setup.</p>
      )}
    </div>
  );
}

function RunCard({ r, canEdit, onEdit, onDeleted }: { r: RunPay; canEdit: boolean; onEdit: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const remove = async () => {
    if (!confirm(`Delete the run on ${longDate(r.run.run_date)} (${r.driverName})?`)) return;
    const err = await deleteRun(getDb(), r.run);
    toast(err ? `Couldn't delete it: ${err}` : "Deleted");
    onDeleted();
  };
  return (
    <li className="panel mt-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="m-0 min-w-0 flex-1">
          {longDate(r.run.run_date)} · {r.driverName}
        </h3>
        <span className="num">{r.pay != null ? `Pay ${centsText(r.pay)}` : <span className="muted">No pay rate</span>}</span>
      </div>
      <div className="small mt-1">
        {r.regular} {r.regular === 1 ? "stop" : "stops"}
        {r.extra > 0 && `, ${r.extra} extra`}
        {r.skipped > 0 && `, ${r.skipped} skipped`}
        {r.rate && r.pay != null && (
          <span className="muted">
            {" "}
            · {centsText(BigInt(Math.round(Number(r.rate.base) * 100)))} base
            {r.extra > 0 && ` + ${r.extra} × ${centsText(BigInt(Math.round(Number(r.rate.per_extra) * 100)))}`}
            {r.skipped > 0 && ` − ${r.skipped} × ${centsText(BigInt(Math.round(Number(r.rate.per_skipped) * 100)))}`}
          </span>
        )}
      </div>
      {r.stops.length > 0 && (
        <ol className="small m-0 mt-1 pl-5">
          {r.stops.map((s) => (
            <li key={s.id}>
              {s.name}
              {s.kind !== "stop" && <span className="tag ml-2">{KIND_LABEL[s.kind]}</span>}
            </li>
          ))}
        </ol>
      )}
      <div className="small mt-1">
        Fuel: {r.fuel != null ? <b className="num">{centsText(r.fuel)}</b> : <span className="tag callback">Not entered</span>}
        {r.run.receipt_path && (
          <span className="ml-2">
            <FileButton path={r.run.receipt_path} name={r.run.receipt_name || "Receipt"} bucket="truck-files" />
          </span>
        )}
      </div>
      {r.run.note && <div className="small muted">{r.run.note}</div>}
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn ghost" onClick={onEdit}>
            Change
          </button>
          <button type="button" className="btn ghost" onClick={() => void remove()}>
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

function RunForm({
  week,
  run,
  drivers,
  points,
  onDone,
}: {
  week: string;
  run?: RunPay;
  drivers: { id: string; name: string; active: boolean }[];
  points: { id: string; name: string; short_name: string }[];
  onDone: () => void;
}) {
  const db = getDb();
  const toast = useToast();
  const { customers } = useStaffData();
  const [date, setDate] = useState(run?.run.run_date ?? weekDays(week)[5]); // the shipping Tuesday
  const [driverId, setDriverId] = useState(run?.run.driver_id ?? drivers.find((d) => d.active)?.id ?? "");
  const [stops, setStops] = useState<StopInput[]>(
    run?.stops.map((s) => ({ kind: s.kind, customerId: s.customer_id, pointId: s.point_id, name: s.name })) ?? [],
  );
  const [pick, setPick] = useState("");
  const [typed, setTyped] = useState("");
  const [fuel, setFuel] = useState(run?.run.fuel != null ? String(run.run.fuel) : "");
  const [note, setNote] = useState(run?.run.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const hasLocations = new Set((customers?.list ?? []).map((c) => c.parent_customer_id).filter(Boolean));
  const locations = customers
    ? sortByDisplayName(
        customers.list.filter((c) => c.active && !hasLocations.has(c.id)),
        customers.byId,
      )
    : [];
  const options = [
    ...points.map((p) => ({ value: `p:${p.id}`, label: `${p.name} (distributor)` })),
    ...locations.map((c) => ({ value: `c:${c.id}`, label: customers ? displayName(c, customers.byId) : c.name })),
  ];

  const addPicked = () => {
    const o = options.find((x) => x.value === pick);
    if (!o) return;
    const [t, id] = [pick.slice(0, 1), pick.slice(2)];
    setStops([...stops, { kind: "stop", customerId: t === "c" ? id : null, pointId: t === "p" ? id : null, name: o.label.replace(/ \(distributor\)$/, "") }]);
    setPick("");
  };
  const addTyped = () => {
    if (!typed.trim()) return;
    setStops([...stops, { kind: "extra", customerId: null, pointId: null, name: typed.trim() }]);
    setTyped("");
  };
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    setStops(next);
  };

  const save = async () => {
    if (!driverId) return toast("Pick the driver");
    if (!isISODate(date)) return toast("Pick the run's date");
    const f = fuel.trim() ? parseMoney(fuel) : null;
    if (fuel.trim() && f == null) return toast("Type the fuel like 112.40");
    setBusy(true);
    const err = await saveRun(db, {
      id: run?.run.id,
      date,
      driverId,
      fuel: f,
      note,
      stops,
      receipt: file ? { blob: await shrinkPhoto(file), name: file.name } : null,
    });
    setBusy(false);
    toast(err ? `Couldn't save: ${err}` : "Run saved");
    if (!err) onDone();
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3 className="m-0">{run ? "Change the run" : "New run"}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="lbl m-0">Date</span>
          <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Driver</span>
          <select className="field" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Pick one</option>
            {drivers
              .filter((d) => d.active || d.id === driverId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="grid gap-1">
        <span className="lbl m-0">Stops, in order</span>
        {stops.length === 0 && <p className="small m-0">None yet.</p>}
        <ol className="m-0 grid gap-1 pl-5">
          {stops.map((s, i) => (
            <li key={i}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-[10rem] flex-1">{s.name}</span>
                <select
                  className="field"
                  aria-label={`What ${s.name} was`}
                  value={s.kind}
                  onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, kind: e.target.value as StopKind } : x)))}
                >
                  <option value="stop">Stop</option>
                  <option value="extra">Extra stop</option>
                  <option value="skipped">Skipped</option>
                </select>
                <button type="button" className="copy min-h-[44px] px-2" aria-label="Earlier" onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="copy min-h-[44px] px-2" aria-label="Later" onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="copy min-h-[44px] px-2" onClick={() => setStops(stops.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-end gap-2">
          <select className="field min-w-[14rem] flex-1" aria-label="Add a stop" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Pick a location or distributor</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn ghost" disabled={!pick} onClick={addPicked}>
            Add stop
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <input className="field min-w-[14rem] flex-1" aria-label="Another stop" placeholder="Another stop, typed (added as extra)" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <button type="button" className="btn ghost" disabled={!typed.trim()} onClick={addTyped}>
            Add
          </button>
        </div>
        <p className="small muted m-0">Stop: on the regular route. Extra stop: added (pays more). Skipped: on the route but not made (pays less).</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="lbl m-0">Fuel ($)</span>
          <input className="field num w-28!" inputMode="decimal" placeholder="112.40" value={fuel} onChange={(e) => setFuel(e.target.value)} />
        </label>
        <label className="grid min-w-[10rem] flex-1 gap-1">
          <span className="lbl m-0">Note (optional)</span>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="lbl m-0">Fuel receipt, photo or PDF (optional){run?.run.receipt_path ? ": a new one replaces it" : ""}</span>
        <input type="file" className="field" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn" disabled={busy || !driverId}>
          {busy ? "Saving..." : "Save run"}
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
