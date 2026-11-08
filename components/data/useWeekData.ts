"use client";

// One week's orders, packing, half and whole, freezer, and cut sheet totals
// for the office screens, kept current between devices.
//
// "Only if extra" lines (11/8/26): every screen showing the week works out
// what each will get (lib/calc/extras.ts) and saves any change on the line
// (order_lines.fill_qty), so packing, box labels, manifests, the cut sheet
// and invoices use the same amount. A week that's up to date writes nothing.

import { useCallback, useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { customerRank } from "@/lib/calc/customers";
import { EPS } from "@/lib/calc/num";
import { loadWeek } from "@/lib/db/load";
import { saveExtraFills } from "@/lib/db/save";
import type { Order, WeekData } from "@/lib/db/types";
import { weekCalc } from "@/lib/weekCalc";
import { useCan } from "../CurrentUser";
import { getDb } from "./db";
import { useStaffData } from "./StaffData";
import { useLive } from "./useLive";

const LIVE_TABLES = ["orders", "order_lines", "order_requests", "packing_lines", "packing_orders", "cut_sets", "cut_sheets", "le_trim_plans", "week_extra_lambs"];

export function useWeekData(week: string) {
  const load = useCallback((db: SupabaseClient) => loadWeek(db, week), [week]);
  const { data, error, refresh, refreshSoon, patch } = useLive(`week-${week}`, load, LIVE_TABLES);
  useKeepExtraFills(week, data);

  /** Show an order change right away, before the database confirms it. */
  const patchOrder = useCallback(
    (customerId: string, order: Order | null) =>
      patch((d) => {
        const orders = new Map(d.orders);
        if (order) orders.set(customerId, order);
        else orders.delete(customerId);
        return { ...d, orders };
      }),
    [patch],
  );

  return { data, error, refresh, refreshSoon, patchOrder };
}

/** Save what each "Only if extra" line will get, when it changed. */
function useKeepExtraFills(week: string, data: WeekData | null) {
  const { catalog, customers } = useStaffData();
  const orders = useCan("orders").view;
  const calls = useCan("calls").view;
  const weekView = useCan("week").view;
  const canSee = orders || calls || weekView;
  const sent = useRef("");
  useEffect(() => {
    if (!data || !catalog || !customers || !canSee || data.week !== week) return;
    if (![...data.orders.values()].some((o) => o.extra)) return;
    const { extras, extraLines } = weekCalc(data, catalog, { rank: customerRank(customers.byId) });
    const changed = extraLines
      .filter((l) => !l.locked)
      .map((l) => ({ l, fill: extras.fills.get(l.key)?.fill ?? 0 }))
      .filter(({ l, fill }) => l.stored == null || Math.abs(l.stored - fill) > EPS)
      .map(({ l, fill }) => ({ order_id: l.orderId, product_id: l.productId, qty: fill }));
    if (!changed.length) return;
    // The same change only once, while its save comes back through live updates.
    const key = JSON.stringify(changed);
    if (key === sent.current) return;
    sent.current = key;
    void saveExtraFills(getDb(), week, changed);
  }, [week, data, catalog, customers, canSee]);
}
