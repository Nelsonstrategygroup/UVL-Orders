// The outbox (SPEC 11.7): everything a packer does on Packing is saved on the
// phone first, shown straight away, and uploaded in order when there's signal.
// Pure functions here; storage is lib/offline/idb.ts and the uploading loop is
// components/offline/OutboxProvider.tsx.
//
// Every action carries an id made on the phone, so sending it twice (a retry
// after the signal dropped mid-upload) saves it once.

import type { LineMark, PackingData, PackWeight } from "../db/packing";
import type { BoxUpload } from "../db/scanning";

export type Action =
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
    }
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
  /** Delete a pallet started by mistake. Only an empty one: a pallet with boxes is kept. */
  | { type: "pallet-delete"; id: string; tag: string }
  /** A pallet is full (or open again, or shipped). */
  | { type: "pallet-status"; id: string; status: "planned" | "open" | "full" | "shipped" };

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
          by: who,
          at: a.at,
        }),
      );
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
          product_id: b.product_id,
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
