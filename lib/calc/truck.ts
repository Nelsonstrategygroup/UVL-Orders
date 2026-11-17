// Truck runs (Lucas, 11/16/26): driver pay per run from the driver's rate on
// the run's date: base + per extra stop × extra stops − per skipped stop ×
// skipped stops. Fuel is what was entered on the run. Maintenance counts on
// runs by drivers who have it turned on. Money is exact (BigInt cents).

import { toFixedInt } from "./prices";

export type TruckDriver = { id: string; name: string; active: boolean; maintenance: boolean; note: string };
export type DriverRate = {
  id: string;
  driver_id: string;
  effective_from: string;
  base: string | number;
  per_extra: string | number;
  per_skipped: string | number;
  note: string;
};
export type TruckRun = {
  id: string;
  run_date: string;
  week_id: string;
  driver_id: string;
  fuel: string | number | null;
  note: string;
  receipt_path: string | null;
  receipt_name: string;
  created_by?: string | null;
  created_at?: string;
};
export type StopKind = "stop" | "extra" | "skipped";
export type RunStop = { id: string; run_id: string; kind: StopKind; customer_id: string | null; point_id: string | null; name: string; sort: number };

export type RunPay = {
  run: TruckRun;
  driverName: string;
  /** The driver's rate on the run's date; null: none set (pay can't be worked out). */
  rate: DriverRate | null;
  stops: RunStop[];
  /** Regular stops made (in the base pay). */
  regular: number;
  extra: number;
  skipped: number;
  /** base + extra × per extra − skipped × per skipped; null without a rate. */
  pay: bigint | null;
  /** Fuel entered; null: not entered yet. */
  fuel: bigint | null;
  /** Maintenance counts on this run (the driver has it on). */
  maintenance: boolean;
};

const c = (v: string | number) => toFixedInt(v, 2);

/** A driver's newest rate on or before the date. */
export function driverRateOn(rates: DriverRate[], driverId: string, date: string): DriverRate | null {
  let best: DriverRate | null = null;
  for (const r of rates) {
    if (r.driver_id !== driverId || r.effective_from > date) continue;
    if (!best || r.effective_from > best.effective_from) best = r;
  }
  return best;
}

/** One run's pay, fuel and stops. */
export function runPay(run: TruckRun, stops: RunStop[], drivers: TruckDriver[], rates: DriverRate[]): RunPay {
  const mine = stops.filter((s) => s.run_id === run.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const count = (k: StopKind) => mine.filter((s) => s.kind === k).length;
  const driver = drivers.find((d) => d.id === run.driver_id);
  const rate = driverRateOn(rates, run.driver_id, run.run_date);
  const extra = count("extra");
  const skipped = count("skipped");
  return {
    run,
    driverName: driver?.name ?? "A driver no longer listed",
    rate,
    stops: mine,
    regular: count("stop"),
    extra,
    skipped,
    pay: rate ? c(rate.base) + c(rate.per_extra) * BigInt(extra) - c(rate.per_skipped) * BigInt(skipped) : null,
    fuel: run.fuel == null || run.fuel === "" ? null : c(run.fuel),
    maintenance: !!driver?.maintenance,
  };
}

/** Stops made on a run: regular and extra (skipped ones weren't made). */
export const stopsMade = (r: RunPay) => r.regular + r.extra;
