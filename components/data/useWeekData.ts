"use client";

// One week's orders, packing, half and whole, freezer, and cut sheet totals
// for the office screens, kept current between devices.

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWeek } from "@/lib/db/load";
import type { Order } from "@/lib/db/types";
import { useLive } from "./useLive";

const LIVE_TABLES = ["orders", "order_lines", "packing_lines", "packing_orders", "cut_sets", "cut_sheets"];

export function useWeekData(week: string) {
  const load = useCallback((db: SupabaseClient) => loadWeek(db, week), [week]);
  const { data, error, refresh, refreshSoon, patch } = useLive(`week-${week}`, load, LIVE_TABLES);

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
