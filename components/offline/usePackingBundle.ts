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
// Only tables the database sends live changes for (supabase_realtime): naming
// one it doesn't made the whole subscription fail, so Packing stopped updating
// live (found 10/23/26).
const LIVE = ["orders", "order_lines", "packing_lines", "packing_weights", "packing_orders", "pallets", "pallet_shipments", "pallet_plan_lines", "pallet_customers"];

function timeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("The request timed out")), TIMEOUT_MS))]);
}

export function usePackingBundle(week: string) {
  const outbox = useOutbox();
  const { reportOnline } = outbox;
  // By week only: a copy loaded the day before still opens on packing day.
  const key = `packing:${week}`;

  const load = useCallback(
    async (d: SupabaseClient) => {
      try {
        const [packing, gtins, lots, pallets, boxes] = await timeout(
          Promise.all([loadPacking(d, week), loadGtins(d), loadLots(d), loadPallets(d, week), loadBoxSetup(d)]),
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
        const bundle = {
          ...snap.value,
          // A copy kept before pallet tags (10/26/26) has no usable pallets.
          pallets: (snap.value.pallets ?? []).filter((p) => typeof p.tag === "string").map((p) => ({ ...p, customers: p.customers ?? [] })),
          // A copy kept before box limits existed.
          boxes: snap.value.boxes ?? { types: [], limits: new Map(), capLb: 45 },
          // A copy kept before box weights (10/26/26).
          packing: {
            ...snap.value.packing,
            labelNumbers: snap.value.packing.labelNumbers ?? new Map(),
            blanks: snap.value.packing.blanks ?? { unknown: 6, spare: 2 },
            unassigned: snap.value.packing.unassigned ?? [],
            points: snap.value.packing.points ?? new Map(),
            company: snap.value.packing.company ?? "Umpqua Valley Lamb",
            shipFrom: snap.value.packing.shipFrom ?? "",
          },
        };
        return { bundle, savedAt: snap.savedAt, fromPhone: true };
      }
    },
    [week, key, reportOnline],
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
    // Pallets started or marked full on this phone show straight away.
    for (const q of waiting) {
      const a = q.action;
      if (a.type === "pallet-start" && !pallets.some((p) => p.id === a.id))
        pallets.push({
          id: a.id,
          week_id: a.week_id,
          tag: a.tag,
          status: a.status ?? "open",
          created_at: a.at,
          shipKeys: [a.ship_to_point_id ? `point:${a.ship_to_point_id}` : `customer:${a.ship_to_customer_id}`],
          plan: [],
          customers: [],
        });
      if (a.type === "pallet-customer")
        for (let i = 0; i < pallets.length; i++) {
          const others = pallets[i].customers.filter((c) => c !== a.customer_id);
          pallets[i] = { ...pallets[i], customers: a.on && pallets[i].id === a.pallet_id ? [...others, a.customer_id] : others };
        }
      if (a.type === "pallet-delete") {
        const i = pallets.findIndex((p) => p.id === a.id);
        if (i >= 0) pallets.splice(i, 1);
      }
      if (a.type === "pallet-status") {
        const i = pallets.findIndex((p) => p.id === a.id);
        if (i >= 0) pallets[i] = { ...pallets[i], status: a.status };
      }
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
      pallets: pallets.sort((x, y) => x.created_at.localeCompare(y.created_at)),
      boxes: b.boxes,
    } satisfies PackingBundle;
  }, [live.data, outbox.queue]);

  return {
    data,
    error: live.error,
    refresh: live.refresh,
    savedAt: live.data?.savedAt ?? null,
    fromPhone: live.data?.fromPhone ?? false,
  };
}
