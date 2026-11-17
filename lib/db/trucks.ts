// Truck runs and drivers (Lucas, 11/16/26). Runs and stops: anyone with
// Change on Truck runs (Office, Billing, admins). Drivers and their pay
// rates: admins (P&L Setup). Receipts go in the private truck-files bucket.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriverRate, RunStop, StopKind, TruckDriver, TruckRun } from "../calc/truck";
import { withSource } from "./source";

const SRC = "truck runs";
const BUCKET = "truck-files";

function plain(e: { message: string; code?: string } | null): string | null {
  if (!e) return null;
  if (e.code === "23505" && /truck_drivers_name/.test(e.message)) return "There's already a driver with that name.";
  if (e.code === "23505" && /truck_driver_rates/.test(e.message)) return "That driver already has a rate starting that day.";
  if (e.code === "23503" && /truck_runs/.test(e.message)) return "This driver has runs, so they can only be turned off.";
  if (e.code === "42501") return "You can't change this.";
  return e.message;
}

export type DriverSetup = { drivers: TruckDriver[]; rates: DriverRate[] };

export async function loadDrivers(db: SupabaseClient): Promise<DriverSetup> {
  const [d, r] = await Promise.all([
    db.from("truck_drivers").select("id, name, active, maintenance, note").order("name"),
    db.from("truck_driver_rates").select("id, driver_id, effective_from, base, per_extra, per_skipped, note").order("effective_from", { ascending: false }),
  ]);
  const err = d.error ?? r.error;
  if (err) throw new Error(err.message);
  return { drivers: (d.data ?? []) as TruckDriver[], rates: (r.data ?? []) as DriverRate[] };
}

/** Add a driver (no id) or change one. A new driver starts on the given rate. */
export async function saveDriver(
  db: SupabaseClient,
  x: { id?: string; name?: string; active?: boolean; maintenance?: boolean; note?: string },
  firstRate?: { from: string; base: string; perExtra: string; perSkipped: string },
): Promise<string | null> {
  const { id, ...rest } = x;
  const row = { ...rest, ...(rest.name != null ? { name: rest.name.trim() } : {}) };
  if (id) {
    const { error } = await withSource(db.from("truck_drivers").update(row).eq("id", id), "P&L Setup");
    return plain(error);
  }
  const { data, error } = await withSource(db.from("truck_drivers").insert(row).select("id").single(), "P&L Setup");
  if (error || !data || !firstRate) return plain(error);
  return saveDriverRate(db, { driverId: (data as { id: string }).id, ...firstRate, note: "" });
}

/** A driver's pay rate from a date on (one on the same date is replaced). */
export async function saveDriverRate(
  db: SupabaseClient,
  r: { driverId: string; from: string; base: string; perExtra: string; perSkipped: string; note: string },
): Promise<string | null> {
  const { error } = await withSource(
    db
      .from("truck_driver_rates")
      .upsert(
        { driver_id: r.driverId, effective_from: r.from, base: r.base, per_extra: r.perExtra, per_skipped: r.perSkipped, note: r.note.trim() },
        { onConflict: "driver_id,effective_from" },
      ),
    "P&L Setup",
  );
  return plain(error);
}

export async function deleteDriverRate(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await withSource(db.from("truck_driver_rates").delete().eq("id", id), "P&L Setup");
  return plain(error);
}

const RUN_COLS = "id, run_date, week_id, driver_id, fuel, note, receipt_path, receipt_name, created_by, created_at";

export type WeekRuns = { runs: TruckRun[]; stops: RunStop[] };

/** The week's runs (by the order week of their dates) and their stops. */
export async function loadWeekRuns(db: SupabaseClient, week: string): Promise<WeekRuns> {
  const { data, error } = await db.from("truck_runs").select(RUN_COLS).eq("week_id", week).order("run_date").order("created_at");
  if (error) throw new Error(error.message);
  const runs = (data ?? []) as TruckRun[];
  if (!runs.length) return { runs, stops: [] };
  const s = await db
    .from("truck_run_stops")
    .select("id, run_id, kind, customer_id, point_id, name, sort")
    .in(
      "run_id",
      runs.map((r) => r.id),
    )
    .order("sort");
  if (s.error) throw new Error(s.error.message);
  return { runs, stops: (s.data ?? []) as RunStop[] };
}

export type StopInput = { kind: StopKind; customerId: string | null; pointId: string | null; name: string };

/** Add a run (no id) or change one; its stops are replaced with these. */
export async function saveRun(
  db: SupabaseClient,
  x: { id?: string; date: string; driverId: string; fuel: string | null; note: string; stops: StopInput[]; receipt?: { blob: Blob; name: string } | null },
): Promise<string | null> {
  let path: string | null | undefined;
  if (x.receipt) {
    const ext = x.receipt.blob.type === "application/pdf" ? "pdf" : x.receipt.blob.type === "image/png" ? "png" : x.receipt.blob.type === "image/webp" ? "webp" : "jpg";
    path = `${x.date}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from(BUCKET).upload(path, x.receipt.blob, { contentType: x.receipt.blob.type || "image/jpeg", upsert: false });
    if (up.error) return /mime|type/i.test(up.error.message) ? "Attach a photo or a PDF." : /size|large/i.test(up.error.message) ? "That file is too big (10 MB at most)." : up.error.message;
  }
  const row = {
    run_date: x.date,
    driver_id: x.driverId,
    fuel: x.fuel,
    note: x.note.trim(),
    ...(path ? { receipt_path: path, receipt_name: x.receipt!.name } : {}),
  };
  const res = x.id
    ? await withSource(db.from("truck_runs").update(row).eq("id", x.id).select("id").single(), SRC)
    : await withSource(db.from("truck_runs").insert(row).select("id").single(), SRC);
  if (res.error || !res.data) {
    if (path) await db.storage.from(BUCKET).remove([path]);
    return plain(res.error);
  }
  const runId = (res.data as { id: string }).id;
  const del = await withSource(db.from("truck_run_stops").delete().eq("run_id", runId), SRC);
  if (del.error) return plain(del.error);
  if (x.stops.length) {
    const ins = await withSource(
      db.from("truck_run_stops").insert(
        x.stops.map((s, i) => ({ run_id: runId, kind: s.kind, customer_id: s.customerId, point_id: s.pointId, name: s.name.trim(), sort: i + 1 })),
      ),
      SRC,
    );
    if (ins.error) return plain(ins.error);
  }
  return null;
}

export async function deleteRun(db: SupabaseClient, run: TruckRun): Promise<string | null> {
  const { error } = await withSource(db.from("truck_runs").delete().eq("id", run.id), SRC);
  if (!error && run.receipt_path) await db.storage.from(BUCKET).remove([run.receipt_path]);
  return plain(error);
}
