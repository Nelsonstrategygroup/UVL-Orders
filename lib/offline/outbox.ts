// The outbox (SPEC 11.7): everything a packer does on Packing is saved on the
// phone first, shown straight away, and uploaded in order when there's signal.
// Pure functions here; storage is lib/offline/idb.ts and the uploading loop is
// components/offline/OutboxProvider.tsx.
//
// Every action carries an id made on the phone, so sending it twice (a retry
// after the signal dropped mid-upload) saves it once.

import { boxLabelProduct, onOrderAs } from "../calc/packTogether";
import type { LineMark, PackingData, PackWeight } from "../db/packing";
import type { BoxUpload } from "../db/scanning";

export type Action = ActionBody & {
  /** Which screen or action it came from, for the audit log (11/10/26). Missing: worked out from the action (sourceOf). */
  via?: string;
};

type ActionBody =
  /** The weigh panel: one weight (a box or case, or the whole line). */
  | {
      type: "weight-add";
      client_id: string;
      order_id: string;
      product_id: string;
      weight: number;
      box_no: number | null;
      at: string;
      /** Which box of the product (its blank on the packing sheet) and its label number (10/26/26). Missing on older phones. */
      slot?: number | null;
      label_no?: number | null;
      /** The store's pallet, when it's on exactly one (11/9/26). Missing on older phones: no pallet. */
      pallet_id?: string | null;
    }
  /** A box typed in from the Weigh Sheet's blank rows for a store not ordering this week: no store yet (unassigned), for Kathy to put on a pallet (11/1/26). */
  | { type: "weight-unassigned"; client_id: string; week_id: string; product_id: string; weight: number; at: string }
  /** Change a weight, or the label number written above it (typed in from the paper sheet). */
  | { type: "weight-edit"; order_id: string; weight_id?: string; client_id?: string; weight: number; label_no: number | null }
  /** Take a weight off: one already uploaded (weight_id) or one still waiting (client_id). */
  | { type: "weight-remove"; order_id: string; weight_id?: string; client_id?: string }
  | { type: "mark"; order_id: string; product_id: string; mark: LineMark }
  | { type: "pallet-text"; order_id: string; pallet: string }
  /** A scanned or typed box label (record_box). The photo, if any, uploads first. */
  | { type: "box"; box: BoxUpload; photo?: { path: string; blob: Blob } }
  /** An admin said which product a GTIN is. */
  | { type: "gtin-map"; gtin: string; product_id: string }
  /** A new pallet for a ship date. */
  | { type: "pallet-add"; id: string; week_id: string; ship_date: string; number: number; label: string }
  /** Start a pallet for a shipment, with the tag Chris wrote on it (start_pallet). */
  | {
      type: "pallet-start";
      id: string;
      week_id: string;
      tag: string;
      ship_to_customer_id: string | null;
      ship_to_point_id: string | null;
      at: string;
      /** "planned" when set up ahead on the Pallets page; open otherwise. */
      status?: "planned" | "open";
    }
  /** Put a customer (store) on a pallet for the week, or take it off. On one pallet at a time. */
  | { type: "pallet-customer"; week_id: string; pallet_id: string; customer_id: string; on: boolean }
  /** Move a box to another pallet (it went on the wrong one). */
  | { type: "weight-pallet"; order_id: string | null; weight_id?: string; client_id?: string; pallet_id: string | null }
  /**
   * Move a box to another store (and its pallet, box and label), or unassign
   * it (no store, no pallet): fixing a box that went to the wrong store
   * (10/26/26). The audit log keeps the old and new store.
   */
  | {
      type: "weight-move";
      from_order_id: string | null;
      weight_id?: string;
      client_id?: string;
      order_id: string | null;
      week_id: string;
      pallet_id: string | null;
      slot: number | null;
      label_no: number | null;
      off_order: boolean;
      /** A box coming from an earlier week: not in this week's data, so it's shown from here until it uploads (11/18/26). */
      box?: PackWeight;
    }
  /** A box for a product not on the order: checked as correct for the shipment (ok), or the check undone. The order isn't changed. */
  | { type: "weight-extra-ok"; order_id: string; weight_id?: string; client_id?: string; ok: boolean; by: string; by_name: string; at: string }
  /** Delete a pallet started by mistake. Only an empty one: a pallet with boxes is kept. */
  | { type: "pallet-delete"; id: string; tag: string }
  /** A pallet is full (or open again, or shipped). */
  | { type: "pallet-status"; id: string; status: "planned" | "open" | "full" | "shipped" }
  /** A box put in the freezer: Add to freezer, or a leftover from Packing (add_to_freezer, 11/20/26). */
  | { type: "freezer-add"; box: FreezerAdd }
  /** Take back a box added by mistake (remove_freezer_box), by the phone's client_id. */
  | { type: "freezer-remove"; client_id: string }
  /** Start a freezer count (made on the phone, so it can start with no signal). */
  | { type: "count-start"; count: { id: string; kind: "stock_in" | "reconcile"; product_ids: string[] | null; count_date: string } }
  /** A box scanned, or an amount counted by hand, in a count. Nothing changes in inventory until the count is applied. */
  | { type: "count-item"; item: CountItemUpload }
  /** Change a counted item: take a scan back, add or skip it, or choose its product. */
  | {
      type: "count-item-set";
      id: string;
      count_id: string;
      patch: { voided?: boolean; decision?: "add" | "skip" | null; product_id?: string; product_confirmed?: boolean; qty?: number };
    };

/** What add_to_freezer takes (lib/db/freezer.ts). */
export type FreezerAdd = {
  client_id: string;
  product_id: string;
  qty: number;
  weight_lb: number | null;
  gtin: string | null;
  serial: string | null;
  serial_date: string | null;
  case_no: string | null;
  pack_date: string | null;
  lot: string | null;
  raw_scan: string | null;
  product_confirmed: boolean;
  source: "manual" | "scan" | "packing";
  reason: string;
  note: string;
  added_on: string;
  /** A packing leftover: the packing week it counts toward. */
  week_id: string | null;
  counts_as_income: boolean;
  /** When it was saved on the phone. */
  at: string;
};

/** One count item, as saved on the phone and uploaded. */
export type CountItemUpload = {
  id: string;
  count_id: string;
  device_id: string;
  kind: "scan" | "manual";
  product_id: string | null;
  qty: number;
  weight_lb: number | null;
  gtin: string | null;
  serial: string | null;
  serial_date: string | null;
  case_no: string | null;
  pack_date: string | null;
  lot: string | null;
  raw_scan: string | null;
  product_confirmed: boolean;
  decision: "add" | "skip" | null;
  scanned_at: string;
};

/**
 * Where an action came from, in plain words, for the audit log's source
 * (11/10/26): what the screen said (via), else what the action is.
 */
export function sourceOf(a: Action): string {
  if (a.via) return a.via;
  switch (a.type) {
    case "weight-add":
      return "weigh panel (Packing)";
    case "weight-unassigned":
      return "type in from paper, blank row (no store)";
    case "weight-edit":
      return "weight changed";
    case "weight-remove":
      return "box removed";
    case "weight-extra-ok":
      return a.ok ? "correct, ship it (Packing)" : "undo correct, ship it (Packing)";
    case "weight-move":
      return a.order_id ? "moved to another store" : "taken off its store (unassigned)";
    case "weight-pallet":
      return "moved to another pallet";
    case "mark":
      return "line marked (Packing)";
    case "pallet-text":
      return "pallet note (Packing)";
    case "gtin-map":
      return "barcode taught (Scan boxes)";
    case "box": {
      const b = a.box;
      if (b.source === "manual") return "typed on Scan boxes (label wouldn't scan)";
      if (b.route === "locked") return "scan (store picked first)";
      if (b.route === "unassigned" || !b.order_id) return "scan, saved as unassigned";
      return "scan";
    }
    case "pallet-add":
    case "pallet-start":
      return "pallet started";
    case "pallet-customer":
      return a.on ? "store put on pallet (Pallets)" : "store taken off pallet (Pallets)";
    case "pallet-delete":
      return "pallet deleted";
    case "pallet-status":
      return `pallet marked ${a.status}`;
    case "freezer-add":
      return a.box.source === "packing" ? "leftover put in the freezer (Packing)" : a.box.source === "scan" ? "scanned in (Add to freezer)" : "typed in (Add to freezer)";
    case "freezer-remove":
      return "taken back, added by mistake (Add to freezer)";
    case "count-start":
      return a.count.kind === "stock_in" ? "freezer stock-in count started" : "freezer count started";
    case "count-item":
      return a.item.kind === "scan" ? "scanned (freezer count)" : "counted by hand (freezer count)";
    case "count-item-set":
      return "changed in a freezer count";
  }
}

export type Queued = {
  /** Order on this phone; uploads go oldest first. */
  seq: number;
  action: Action;
  queuedAt: string;
  tries: number;
  lastError?: string;
  /** The server refused it (not a signal problem). Kept and shown, never dropped quietly. */
  stuck?: boolean;
};

/** What happened when one action was sent. */
export type Outcome =
  | { kind: "done"; note?: string }
  /** No signal, or it timed out: stop and try again later. */
  | { kind: "network" }
  /** The login ran out (3 a.m.): stop until they log in again. */
  | { kind: "auth" }
  /** The server refused it. */
  | { kind: "refused"; message: string };

/** Errors that mean "no signal", in the words Chrome, Firefox and Safari use. */
export function isNetworkError(message: string | undefined | null): boolean {
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|timed out|timeout|aborted|offline/i.test(message ?? "");
}

/** Errors that mean the login has run out. */
export function isAuthError(message: string | undefined | null, status?: number): boolean {
  return status === 401 || /jwt|not authenticated|refresh token|session/i.test(message ?? "");
}

/**
 * Send waiting actions in order. Stops at the first signal or login problem
 * (later actions may depend on earlier ones). A refused action is marked
 * stuck and the rest carry on. Returns the queue as it should be now, and
 * notes worth showing (for example "already scanned elsewhere").
 */
export async function syncQueue(
  queue: Queued[],
  send: (a: Action) => Promise<Outcome>,
): Promise<{ queue: Queued[]; sent: number; stoppedFor: "network" | "auth" | null; notes: string[] }> {
  const left: Queued[] = [];
  const notes: string[] = [];
  let sent = 0;
  let stoppedFor: "network" | "auth" | null = null;
  const ordered = [...queue].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < ordered.length; i++) {
    const q = ordered[i];
    if (stoppedFor || q.stuck) {
      left.push(q);
      continue;
    }
    let out: Outcome;
    try {
      out = await send(q.action);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      out = isNetworkError(m) ? { kind: "network" } : { kind: "refused", message: m };
    }
    if (out.kind === "done") {
      sent++;
      if (out.note) notes.push(out.note);
    } else if (out.kind === "network" || out.kind === "auth") {
      stoppedFor = out.kind;
      left.push({ ...q, tries: q.tries + 1 });
    } else {
      left.push({ ...q, tries: q.tries + 1, stuck: true, lastError: out.message });
    }
  }
  return { queue: left, sent, stoppedFor, notes };
}

const localId = (clientId: string) => `local:${clientId}`;

/**
 * The packing data as the packer should see it: what the server last said,
 * plus everything still waiting on this phone. Uploaded actions are already
 * in `data`, so only waiting ones are applied.
 */
export function applyQueue(data: PackingData, queue: Queued[], who = "This phone"): PackingData {
  if (!queue.length) return data;
  const orders = data.orders.map((o) => ({ ...o, weights: [...o.weights], marks: { ...o.marks } }));
  const byId = new Map(orders.map((o) => [o.id, o]));
  // Weights already on the server (by client_id) aren't added twice.
  const onServer = new Set([...orders.flatMap((o) => o.weights), ...data.unassigned].map((w) => w.client_id).filter(Boolean));

  const unassigned = [...data.unassigned];
  for (const { action: a, queuedAt } of [...queue].sort((x, y) => x.seq - y.seq)) {
    if (a.type === "weight-add") {
      const o = byId.get(a.order_id);
      if (!o || onServer.has(a.client_id)) continue;
      o.weights.push(
        blankWeight({
          id: localId(a.client_id),
          client_id: a.client_id,
          product_id: a.product_id,
          weight: a.weight,
          box_no: a.box_no,
          slot: a.slot ?? null,
          label_no: a.label_no ?? null,
          pallet_id: a.pallet_id ?? null,
          by: who,
          at: a.at,
        }),
      );
    } else if (a.type === "weight-unassigned") {
      if (!onServer.has(a.client_id) && !unassigned.some((w) => w.client_id === a.client_id))
        unassigned.push(blankWeight({ id: localId(a.client_id), client_id: a.client_id, product_id: a.product_id, weight: a.weight, box_no: null, by: who, at: a.at }));
    } else if (a.type === "weight-edit") {
      const o = byId.get(a.order_id);
      if (!o) continue;
      o.weights = o.weights.map((w) =>
        (a.weight_id && w.id === a.weight_id) || (a.client_id && w.client_id === a.client_id) ? { ...w, weight: a.weight, label_no: a.label_no } : w,
      );
    } else if (a.type === "weight-pallet") {
      const hit = (w: PackWeight) => (a.weight_id && w.id === a.weight_id) || (a.client_id && w.client_id === a.client_id);
      const o = a.order_id ? byId.get(a.order_id) : undefined;
      if (o) o.weights = o.weights.map((w) => (hit(w) ? { ...w, pallet_id: a.pallet_id } : w));
      for (let i = 0; i < unassigned.length; i++) if (hit(unassigned[i])) unassigned[i] = { ...unassigned[i], pallet_id: a.pallet_id };
    } else if (a.type === "weight-extra-ok") {
      const o = byId.get(a.order_id);
      if (!o) continue;
      const hit = (w: PackWeight) => (a.weight_id && w.id === a.weight_id) || (a.client_id && w.client_id === a.client_id);
      o.weights = o.weights.map((w) => (hit(w) ? { ...w, extra_ok_at: a.ok ? a.at : null, extra_ok_by_name: a.ok ? a.by_name : null } : w));
    } else if (a.type === "weight-move") {
      const hit = (w: PackWeight) => (a.weight_id && w.id === a.weight_id) || (a.client_id && w.client_id === a.client_id);
      const from = a.from_order_id ? byId.get(a.from_order_id) : undefined;
      let moved: PackWeight | undefined = from ? from.weights.find(hit) : unassigned.find(hit);
      if (moved) {
        if (from) from.weights = from.weights.filter((w) => !hit(w));
        else unassigned.splice(unassigned.indexOf(moved), 1);
      } else moved = a.box;
      if (!moved) continue;
      moved = { ...moved, pallet_id: a.pallet_id, slot: a.slot, label_no: a.label_no };
      const to = a.order_id ? byId.get(a.order_id) : undefined;
      // What it counts as at its new store, as the database will decide (11/18/26).
      if (!moved.correction_reason) moved = { ...moved, ...countedAs(boxLabelProduct(moved), to?.lines, data) };
      if (to) to.weights.push(moved);
      else unassigned.push(moved);
    } else if (a.type === "weight-remove") {
      const o = byId.get(a.order_id);
      if (!o) continue;
      o.weights = o.weights.filter((w) => !((a.weight_id && w.id === a.weight_id) || (a.client_id && w.client_id === a.client_id)));
    } else if (a.type === "mark") {
      const o = byId.get(a.order_id);
      if (o) o.marks[a.product_id] = a.mark;
    } else if (a.type === "pallet-text") {
      const o = byId.get(a.order_id);
      if (o) o.pallet = a.pallet;
    } else if (a.type === "box") {
      const b = a.box;
      // An unassigned box: no customer yet.
      if (!b.order_id) {
        if (!onServer.has(b.client_id) && !unassigned.some((w) => w.client_id === b.client_id))
          unassigned.push(
            blankWeight({
              id: localId(b.client_id),
              client_id: b.client_id,
              product_id: b.product_id,
              weight: b.weight,
              box_no: null,
              by: who,
              at: b.scanned_at ?? queuedAt,
              source: b.source,
              gtin: b.gtin ?? null,
              serial: b.serial ?? null,
              lot: b.lot,
              case_no: b.case_no ?? null,
              pallet_id: b.pallet_id ?? null,
              box_type_id: b.box_type_id ?? null,
            }),
          );
        continue;
      }
      const o = byId.get(b.order_id);
      if (!o || onServer.has(b.client_id)) continue;
      const nextBox = Math.max(0, ...o.weights.map((w) => w.box_no ?? 0)) + 1;
      o.weights.push(
        blankWeight({
          id: localId(b.client_id),
          client_id: b.client_id,
          ...countedAs(b.product_id, o.lines, data),
          weight: b.weight,
          box_no: nextBox,
          slot: b.slot ?? null,
          label_no: b.label_no ?? null,
          box_type_id: b.box_type_id ?? null,
          by: who,
          at: b.scanned_at ?? queuedAt,
          source: b.source,
          gtin: b.gtin ?? null,
          serial: b.serial ?? null,
          lot: b.lot,
          case_no: b.case_no ?? null,
          pallet_id: b.pallet_id ?? null,
        }),
      );
    }
  }
  return { ...data, orders, unassigned };
}

/** A box's product at a store: a Front Shanks box counts as Mixed Shanks there, keeping its label. */
function countedAs(label: string, lines: Record<string, number> | undefined, data: PackingData) {
  const product_id = lines ? (onOrderAs(label, lines, data.products) ?? label) : label;
  return { product_id, label_product_id: product_id === label ? null : label };
}

function blankWeight(w: Partial<PackWeight> & Pick<PackWeight, "id" | "product_id" | "weight" | "box_no">): PackWeight {
  // (slot and label_no default to none: a weight from before 10/26/26 or an older phone.)
  return {
    by: null,
    at: new Date().toISOString(),
    source: "weigh",
    gtin: null,
    serial: null,
    lot: null,
    case_no: null,
    pallet_id: null,
    client_id: null,
    slot: null,
    label_no: null,
    ...w,
  };
}

/** True for a weight that exists only on this phone so far. */
export const isLocal = (w: Pick<PackWeight, "id">) => w.id.startsWith("local:");

/** One line for the status bar. */
export function statusLine(s: { online: boolean; waiting: number; stuck: number; needLogin: boolean; syncing: boolean }): string {
  const parts: string[] = [];
  if (s.needLogin) parts.push("Log in again to upload");
  else if (!s.online) parts.push("Offline");
  else if (s.syncing && s.waiting) parts.push("Online, uploading");
  else parts.push("Online");
  if (s.waiting) parts.push(`${s.waiting} ${s.waiting === 1 ? "thing" : "things"} waiting`);
  else if (!s.stuck && s.online && !s.needLogin) parts.push("all saved");
  if (s.stuck) parts.push(`${s.stuck} couldn't upload`);
  return parts.join(", ");
}
