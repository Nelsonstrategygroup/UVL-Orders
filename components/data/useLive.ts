"use client";

// Load data and keep it current with Supabase Realtime (SPEC 4.9): when one
// of the watched tables changes on any device, the data reloads within a
// second or two. Also reloads when a sleeping tablet wakes or comes back online.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "./db";

export function useLive<T>(key: string, load: (db: SupabaseClient) => Promise<T>, tables: string[]) {
  const db = getDb();
  // The key travels with the data, so a screen never shows last week's data
  // under this week's heading while the new week loads.
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  const tablesKey = tables.join(",");

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const value = await loadRef.current(db);
      // Ignore answers to older requests (for example after switching weeks).
      if (mine === seq.current) {
        setState({ key, value });
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [db, key]);

  /** Reload shortly, collapsing bursts of changes into one reload. */
  const refreshSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), 250);
  }, [refresh]);

  useEffect(() => {
    const mine = ++seq.current;
    loadRef.current(db).then(
      (value) => {
        if (mine === seq.current) {
          setState({ key, value });
          setError(null);
        }
      },
      (e) => mine === seq.current && setError(e instanceof Error ? e.message : String(e)),
    );

    const channel = db.channel(`live-${key}-${Math.random().toString(36).slice(2)}`);
    for (const table of tablesKey.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refreshSoon);
    }
    channel.subscribe();

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
  }, [db, key, tablesKey, refreshSoon]);

  /** Change the data on screen right away, before the database confirms it. */
  const patch = useCallback(
    (fn: (value: T) => T) => setState((s) => (s && s.key === key ? { key, value: fn(s.value) } : s)),
    [key],
  );

  return { data: state && state.key === key ? state.value : null, error, refresh, refreshSoon, patch };
}
