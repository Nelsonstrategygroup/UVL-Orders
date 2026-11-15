"use client";

// Weigh sheets, the week (SPEC 16.3-16.5, Lamb cost stage 2): the week's
// sheets from Mohawk's kill log (one per producer per kill date), then each
// producer's lambs, weights and pay, then the week total. Warns, never
// blocks, when the lambs on the sheets don't match This week's lamb count.

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useWeekData } from "@/components/data/useWeekData";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import {
  averageLbText,
  carcassText,
  centsText,
  liveText,
  sheetPay,
  sizeCounts,
  weekPay,
  type Producer,
} from "@/lib/calc/lambCost";
import { longDate, weekDays } from "@/lib/dates";
import { loadLambCostSetup } from "@/lib/db/lambCost";
import { createSheet, loadWeekSheets } from "@/lib/db/weighSheets";
import { weekCalc } from "@/lib/weekCalc";

const TABLES = ["kill_sheets", "kill_lambs", "kill_adjustments", "kill_sheet_photos", "producers"];

export default function WeighSheetsScreen() {
  const { week } = useWeek();
  const { catalog } = useStaffData();
  const loadSheets = useCallback((d: SupabaseClient) => loadWeekSheets(d, week), [week]);
  const { data, error } = useLive(`weigh-sheets:${week}`, loadSheets, TABLES);
  const loadSetup = useCallback((d: SupabaseClient) => loadLambCostSetup(d), []);
  const { data: setup } = useLive("lamb-cost-setup", loadSetup, ["producers", "lamb_cost_settings", "producer_rates"]);
  // The week's ONE lamb count, the number This week shows (read only).
  const { data: weekData } = useWeekData(week);

  if (error) return <p className="note bad">Couldn&apos;t load weigh sheets: {error}</p>;
  if (!data || !setup || !catalog) return (
    <>
      <WeekBar />
      <p className="small muted">Loading...</p>
    </>
  );

  const producerName = (id: string) => setup.producers.find((p) => p.id === id)?.name ?? "Unknown producer";
  const pays = data.sheets.map((s) => sheetPay(s, data.lambs, data.adjustments));
  const total = weekPay(pays);
  const lambCount = weekData ? weekCalc(weekData, catalog).c.final : null;
  const sizes = sizeCounts(
    data.lambs.map((l) => Number(l.carcass_lb)),
    catalog.sizes,
  );

  return (
    <div className="max-w-[960px]">
      <WeekBar />
      <h2 className="mt-2 mb-1">Weigh sheets</h2>
      <p className="small muted mt-0">
        Mohawk&apos;s kill log: one sheet for each producer and kill date. Only admins can see this.
      </p>

      {lambCount != null && data.sheets.length > 0 && total.head !== lambCount && (
        <p className="note mt-2" role="status">
          The sheets have <b>{total.head}</b> lambs. This week&apos;s lamb count is <b>{lambCount}</b>. Check the sheets
          against the paper.
        </p>
      )}

      <section className="panel mt-3" aria-labelledby="ws-sheets">
        <h3 id="ws-sheets">Sheets this week</h3>
        {data.sheets.length === 0 ? (
          <p className="small muted mt-1">No sheets for this week yet.</p>
        ) : (
          <table className="simple mt-1">
            <thead>
              <tr>
                <th>Producer</th>
                <th>Kill date</th>
                <th className="text-right">Lambs</th>
                <th className="text-right">Carcass lb</th>
                <th className="text-right">Pay</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pays.map((p) => (
                <tr key={p.sheet.id}>
                  <td>
                    <b>{producerName(p.sheet.producer_id)}</b>
                  </td>
                  <td className="whitespace-nowrap">{longDate(p.sheet.kill_date)}</td>
                  <td className="num text-right">{p.count}</td>
                  <td className="num text-right">{carcassText(p.carcass)}</td>
                  <td className="num text-right">{centsText(p.cents)}</td>
                  <td className="text-right">
                    <Link className="btn ghost" href={`/weigh-sheets/${p.sheet.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <NewSheet producers={setup.producers} days={weekDays(week)} hasRate={setup.settings.length > 0} />
      </section>

      {data.sheets.length > 0 && (
        <section className="panel mt-3" aria-labelledby="ws-producers">
          <h3 id="ws-producers">By producer</h3>
          <div className="overflow-x-auto">
            <table className="simple mt-1">
              <thead>
                <tr>
                  <th>Producer</th>
                  <th className="text-right">Lambs</th>
                  <th className="text-right">Carcass lb</th>
                  <th className="text-right">Live lb</th>
                  <th className="text-right">Average carcass</th>
                  <th className="text-right">Pay</th>
                </tr>
              </thead>
              <tbody>
                {total.producers.map((p) => (
                  <tr key={p.producerId}>
                    <td>
                      <b>{producerName(p.producerId)}</b>
                      {p.sheets > 1 && <span className="small muted"> · {p.sheets} sheets</span>}
                    </td>
                    <td className="num text-right">{p.head}</td>
                    <td className="num text-right">{carcassText(p.carcass)}</td>
                    <td className="num text-right">{liveText(p.live)}</td>
                    <td className="num text-right">{averageLbText(p.carcass, p.head)}</td>
                    <td className="num text-right">{centsText(p.cents)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td>Week total</td>
                  <td className="num text-right">{total.head}</td>
                  <td className="num text-right">{carcassText(total.carcass)}</td>
                  <td className="num text-right">{liveText(total.live)}</td>
                  <td className="num text-right">{averageLbText(total.carcass, total.head)}</td>
                  <td className="num text-right">{centsText(total.cents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small muted mt-2 mb-0">
            Each lamb is worked out exactly. Totals are rounded to the cent once, so a total can be a cent off the sheets
            added up.
          </p>
        </section>
      )}

      {total.head > 0 && (
        <section className="panel mt-3" aria-labelledby="ws-sizes">
          <h3 id="ws-sizes">Lambs by size</h3>
          <p className="small mt-1 mb-0">
            {sizes
              .filter((s) => s.count > 0 || s.label !== "Unassigned")
              .map((s) => `${s.label} ${s.count}`)
              .join(" · ")}
          </p>
          <p className="small muted mt-1 mb-0">
            From Setup &gt; Lamb sizes. A weight in no size, or in two sizes that overlap, is Unassigned.
          </p>
        </section>
      )}
    </div>
  );
}

/** Start a sheet: producer and kill date (any day of this week). */
function NewSheet({ producers, days, hasRate }: { producers: Producer[]; days: string[]; hasRate: boolean }) {
  const db = getDb();
  const toast = useToast();
  const router = useRouter();
  const on = producers.filter((p) => p.active);
  const [producerId, setProducerId] = useState("");
  const [killDate, setKillDate] = useState("");
  const [busy, setBusy] = useState(false);

  if (!hasRate) return <p className="note small mt-3">Add a rate in Setup &gt; Lamb cost first.</p>;
  if (on.length === 0)
    return (
      <p className="small mt-3 mb-0">
        Add a producer in <Link href="/setup/lamb-cost">Setup &gt; Lamb cost</Link> first.
      </p>
    );

  const start = async () => {
    if (!producerId) return toast("Pick the producer");
    if (!killDate) return toast("Pick the kill date");
    setBusy(true);
    const { id, error } = await createSheet(db, producerId, killDate);
    setBusy(false);
    if (error || !id) return toast(`Couldn't start the sheet: ${error ?? "no answer"}`);
    router.push(`/weigh-sheets/${id}`);
  };

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <label className="grid gap-1">
        <span className="lbl m-0">Producer (top of the sheet)</span>
        <select className="field" value={producerId} onChange={(e) => setProducerId(e.target.value)}>
          <option value="">Pick a producer</option>
          {on.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="lbl m-0">Kill date</span>
        <select className="field" value={killDate} onChange={(e) => setKillDate(e.target.value)}>
          <option value="">Pick the day</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {longDate(d)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn" disabled={busy || !producerId || !killDate}>
        Start a sheet
      </button>
    </form>
  );
}
