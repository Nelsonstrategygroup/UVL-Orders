"use client";

// One week's orders, packing, half and whole, freezer, and cut sheet totals,
// kept current with Supabase Realtime (SPEC 4.9): when an order changes on
// any device, every open screen reloads within a second or two.

import { useCallback, useEffect, useRef, useState } from "react";
import { loadWeek } from "@/lib/db/load";
import type { Order, WeekData } from "@/lib/db/types";
import { getDb } from "./StaffData";

const LIVE_TABLES = ["orders", "order_lines", "packing_lines", "packing_orders", "cut_sets", "cut_sheets"];

export function useWeekData(week: string) {
  const db = getDb();
  const [data, setData] = useState<WeekData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await loadWeek(db, week);
      // Ignore answers to older requests (for example after switching weeks).
      if (mine === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [db, week]);

  /** Reload shortly, collapsing bursts of changes into one reload. */
  const refreshSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), 250);
  }, [refresh]);

  useEffect(() => {
    const mine = ++seq.current;
    loadWeek(db, week).then(
      (d) => {
        if (mine === seq.current) {
          setData(d);
          setError(null);
        }
      },
      (e) => mine === seq.current && setError(e instanceof Error ? e.message : String(e)),
    );

    const channel = db.channel(`week-${week}-${Math.random().toString(36).slice(2)}`);
    for (const table of LIVE_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refreshSoon);
    }
    channel.subscribe();

    // Tablets sleep and can miss live updates; catch up when they wake.
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshSoon();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refreshSoon);

    return () => {
      void db.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refreshSoon);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [db, week, refresh, refreshSoon]);

  /** Show a change right away, before the database confirms it. */
  const patchOrder = useCallback((customerId: string, order: Order | null) => {
    setData((d) => {
      if (!d) return d;
      const orders = new Map(d.orders);
      if (order) orders.set(customerId, order);
      else orders.delete(customerId);
      return { ...d, orders };
    });
  }, []);

  return { data: data && data.week === week ? data : null, error, refresh, refreshSoon, patchOrder };
}
