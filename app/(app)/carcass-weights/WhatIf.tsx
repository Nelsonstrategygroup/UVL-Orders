"use client";

// What if (Lucas, 11/18/26): for owners and admins. Try another live factor or
// rate and see each kill's pay and the week's profit next to today's numbers.
// Nothing here is saved.

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCan, useMe } from "@/components/CurrentUser";
import { useLive } from "@/components/data/useLive";
import { usePnlWeek } from "@/app/(app)/pnl/usePnlWeek";
import { carcassText, centsText, factorText, parseFactor, parseRate, rateText, repay, weekPay } from "@/lib/calc/lambCost";
import { longDate } from "@/lib/dates";
import { loadOwners } from "@/lib/db/pnl";

const signed = (c: bigint) => (c > BigInt(0) ? `+${centsText(c)}` : centsText(c));

export default function WhatIf({ week }: { week: string }) {
  const me = useMe();
  const canSeePnl = useCan("pnl").view;
  const load = useCallback((d: SupabaseClient) => loadOwners(d), []);
  const { data: owners } = useLive("pnl-owners", load, ["pnl_owners"]);
  const [open, setOpen] = useState(false);
  if (!canSeePnl || !owners) return null;
  if (me.role !== "admin" && !owners.some((o) => o.profile_id === me.id)) return null;
  return (
    <section className="panel mt-3" aria-labelledby="ws-whatif">
      <h3 id="ws-whatif">What if</h3>
      <p className="small muted mt-1">Try another live factor or rate. Nothing is saved.</p>
      {open ? (
        <Panel week={week} />
      ) : (
        <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
          Try different numbers
        </button>
      )}
    </section>
  );
}

function Panel({ week }: { week: string }) {
  const w = usePnlWeek(week);
  const [factorIn, setFactorIn] = useState("");
  const [rateIn, setRateIn] = useState("");
  if (w.error) return <p className="note bad">Couldn&apos;t load the P&amp;L: {w.error}</p>;
  if (!w.ready) return <p className="small muted">Loading...</p>;

  const factor = factorIn.trim() ? parseFactor(factorIn) : null;
  const rate = rateIn.trim() ? parseRate(rateIn) : null;
  const bad = (factorIn.trim() !== "" && factor == null) || (rateIn.trim() !== "" && rate == null);
  const change = { ...(factor ? { factor } : {}), ...(rate ? { rate } : {}) };
  const rows = w.pays.map((now) => ({ now, then: repay(now, change) }));
  const thenPay = weekPay(rows.map((r) => r.then));
  const thenProfit = w.profitWith(thenPay);
  const nowProfit = w.p.profit;

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="lbl m-0">Live weight factor</span>
          <input className="field num w-28!" inputMode="decimal" placeholder="as is" value={factorIn} onChange={(e) => setFactorIn(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Rate ($ per lb live)</span>
          <input className="field num w-28!" inputMode="decimal" placeholder="as is" value={rateIn} onChange={(e) => setRateIn(e.target.value)} />
        </label>
      </div>
      {bad && <p className="note small mt-2">Type numbers like 2.00 and 3.00.</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="simple">
          <thead>
            <tr>
              <th>Kill</th>
              <th className="text-right">Carcass lb</th>
              <th className="text-right">Now</th>
              <th className="text-right">What if</th>
              <th className="text-right">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ now, then }) => (
              <tr key={now.sheet.id}>
                <td>
                  <b>{w.producerName(now.sheet.producer_id)}</b>
                  <span className="small muted block">{longDate(now.sheet.kill_date)}</span>
                </td>
                <td className="num text-right">{carcassText(now.carcass)}</td>
                <td className="num text-right">
                  {centsText(now.cents)}
                  <span className="small muted block">
                    {factorText(now.sheet.live_factor)} × {rateText(now.sheet.base_rate)}
                  </span>
                </td>
                <td className="num text-right">
                  {centsText(then.cents)}
                  <span className="small muted block">
                    {factorText(then.sheet.live_factor)} × {rateText(then.sheet.base_rate)}
                  </span>
                </td>
                <td className="num text-right">{signed(then.cents - now.cents)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={2}>Producer pay, this week</td>
              <td className="num text-right">{centsText(w.pay.cents)}</td>
              <td className="num text-right">{centsText(thenPay.cents)}</td>
              <td className="num text-right">{signed(thenPay.cents - w.pay.cents)}</td>
            </tr>
            <tr className="font-bold">
              <td colSpan={2}>Week&apos;s profit{w.p.projected ? " (projected)" : ""}</td>
              <td className="num text-right">{nowProfit == null ? "Not yet" : centsText(nowProfit)}</td>
              <td className="num text-right">{thenProfit == null ? "Not yet" : centsText(thenProfit)}</td>
              <td className="num text-right">{nowProfit == null || thenProfit == null ? "" : signed(thenProfit - nowProfit)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
