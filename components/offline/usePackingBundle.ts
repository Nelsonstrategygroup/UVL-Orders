"use client";

// Everything Packing and Scan boxes need, loaded with signal and kept on the
// phone for when there's none (SPEC 11.7): the week's orders and boxes,
// products, the GTIN map, known lots, and today's pallets. Both screens use
// the same copy, so opening either one with signal gets the phone ready.
// Things still waiting in the outbox are shown on top.

import { useCallback, useEffect, useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useLive } from "@/components/data/useLive";
import { snapshotGet, snapshotSave } from "@/lib/offline/idb";
import { applyQueue } from "@/lib/offline/outbox";
import { loadPacking, type PackingData } from "@/lib/db/packing";
import type { BoxSetup } from "@/lib/calc/boxes";
import { loadBoxSetup } from "@/lib/db/boxes";
import { loadGtins, loadLots, loadPallets, type GtinRow, type LotRow, type PalletRow } from "@/lib/db/scanning";
import { useOutbox } from "./OutboxProvider";

export type PackingBundle = { packing: PackingData; gtins: GtinRow[]; lots: LotRow[]; pallets: PalletRow[]; boxes: BoxSetup };

const TIMEOUT_MS = 10000;
const LIVE = ["product_box_limits", "orders", "order_lines", "packing_lines", "packing_weights", "packing_orders", "pallets", "gtin_products", "lots"];

function timeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("The request timed out")), TIMEOUT_MS))]);
}

export function usePackingBundle(week: string, shipDate: string) {
  const outbox = useOutbox();
  const { reportOnline } = outbox;
  // By week only: a copy loaded the day before still opens on packing day.
  const key = `packing:${week}`;

  const load = useCallback(
    async (d: SupabaseClient) => {
      try {
        const [packing, gtins, lots, pallets, boxes] = await timeout(
          Promise.all([loadPacking(d, week), loadGtins(d), loadLots(d), loadPallets(d, shipDate), loadBoxSetup(d)]),
        );
        const bundle: PackingBundle = { packing, gtins, lots, pallets, boxes };
        await snapshotSave(key, bundle).catch(() => undefined);
        reportOnline(true);
        return { bundle, savedAt: new Date().toISOString(), fromPhone: false };
      } catch (e) {
        // No signal (or the server didn't answer): use the copy on the phone.
        const snap = await snapshotGet<PackingBundle>(key).catch(() => null);
        if (!snap) throw e;
        reportOnline(false);
        // Pallets kept for another day aren't today's shipment.
        const bundle = {
          ...snap.value,
          pallets: snap.value.pallets.filter((p) => p.ship_date === shipDate),
          // A copy kept before box limits existed.
          boxes: snap.value.boxes ?? { types: [], limits: new Map(), capLb: 45 },
        };
        return { bundle, savedAt: snap.savedAt, fromPhone: true };
      }
    },
    [week, shipDate, key, reportOnline],
  );
  const live = useLive(key, load, LIVE);
  const { refresh } = live;

  // Reload once waiting things have uploaded, so the screen shows the server's copy.
  useEffect(() => {
    if (outbox.uploaded) refresh();
  }, [outbox.uploaded, refresh]);

  // What the packer sees: the server's (or the phone's) copy plus everything waiting.
  const data = useMemo(() => {
    if (!live.data) return null;
    const b = live.data.bundle;
    const waiting = outbox.queue.filter((q) => !q.stuck);
    const pallets = [...b.pallets];
    for (const q of waiting)
      if (q.action.type === "pallet-add" && q.action.ship_date === shipDate && !pallets.some((p) => p.id === (q.action as { id: string }).id)) {
        const a = q.action;
        pallets.push({ id: a.id, week_id: a.week_id, ship_date: a.ship_date, number: a.number, pallet_group_id: null, label: a.label });
      }
    const gtins = [...b.gtins];
    for (const q of waiting)
      if (q.action.type === "gtin-map") {
        const a = q.action;
        const i = gtins.findIndex((g) => g.gtin === a.gtin);
        const row = { gtin: a.gtin, product_id: a.product_id, note: "", created_at: q.queuedAt };
        if (i >= 0) gtins[i] = row;
        else gtins.push(row);
      }
    // A lot typed on this phone fills in later boxes even before it uploads.
    const lots = [...b.lots];
    for (const q of waiting)
      if (q.action.type === "box" && q.action.box.gtin && q.action.box.pack_date) {
        const bx = q.action.box;
        if (!lots.some((l) => l.gtin === bx.gtin && l.pack_date === bx.pack_date)) lots.push({ gtin: bx.gtin!, pack_date: bx.pack_date!, lot: bx.lot });
      }
    return {
      packing: applyQueue(b.packing, waiting),
      gtins,
      lots,
      pallets: pallets.sort((x, y) => x.number - y.number),
      boxes: b.boxes,
    } satisfies PackingBundle;
  }, [live.data, outbox.queue, shipDate]);

  return {
    data,
    error: live.error,
    refresh: live.refresh,
    savedAt: live.data?.savedAt ?? null,
    fromPhone: live.data?.fromPhone ?? false,
  };
}
