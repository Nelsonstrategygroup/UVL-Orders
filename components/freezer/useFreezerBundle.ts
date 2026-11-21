"use client";

// What Add to freezer and freezer counts need, loaded with signal and kept on
// the phone for inside the freezer (no signal there): products, the GTIN map,
// known lots, the boxes in the freezer, boxes packed for customers, and the
// open count. Things still waiting to upload are put on top.

import { useCallback, useEffect, useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useLive } from "@/components/data/useLive";
import { useOutbox } from "@/components/offline/OutboxProvider";
import { snapshotGet, snapshotSave } from "@/lib/offline/idb";
import { loadFreezerBundle, type FreezerBundle } from "@/lib/db/freezer";
import { applyFreezerQueue } from "@/lib/offline/freezerQueue";

const KEY = "freezer";
const TIMEOUT_MS = 10000;
const LIVE = ["freezer_boxes", "freezer_takes", "freezer_counts", "freezer_count_items", "freezer_count_devices", "freezer_log"];

function timeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("The request timed out")), TIMEOUT_MS))]);
}

export function useFreezerBundle() {
  const outbox = useOutbox();
  const { reportOnline } = outbox;
  const load = useCallback(
    async (d: SupabaseClient) => {
      try {
        const bundle = await timeout(loadFreezerBundle(d));
        await snapshotSave(KEY, bundle).catch(() => undefined);
        reportOnline(true);
        return { bundle, savedAt: new Date().toISOString(), fromPhone: false };
      } catch (e) {
        const snap = await snapshotGet<FreezerBundle>(KEY).catch(() => null);
        if (!snap) throw e;
        reportOnline(false);
        return { bundle: snap.value, savedAt: snap.savedAt, fromPhone: true };
      }
    },
    [reportOnline],
  );
  const live = useLive(KEY, load, LIVE);
  const { refresh } = live;
  useEffect(() => {
    if (outbox.uploaded) refresh();
  }, [outbox.uploaded, refresh]);

  const data = useMemo(() => (live.data ? applyFreezerQueue(live.data.bundle, outbox.queue) : null), [live.data, outbox.queue]);
  return {
    data,
    error: live.error,
    refresh,
    savedAt: live.data?.savedAt ?? null,
    fromPhone: live.data?.fromPhone ?? false,
  };
}
