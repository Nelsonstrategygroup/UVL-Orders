"use client";

// Moving a box to a store and pallet (10/26/26): the choice used on Scan boxes
// and, for boxes not assigned, at the top of Packing (11/17/26).

import { useState } from "react";
import { useCan, useMe } from "@/components/CurrentUser";
import { getDb } from "@/components/data/db";
import type { PackingBundle } from "@/components/offline/usePackingBundle";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { fmt } from "@/lib/calc/num";
import { notAssignedLine, notAssignedTitle, type NotAssigned } from "@/lib/calc/notAssigned";
import { notSavedLine, notSavedScans, notSavedTitle, notSavedWhy } from "@/lib/calc/notSaved";
import { clearEarlierBoxes, resolveRefusedScans, type EarlierBox } from "@/lib/db/scanning";
import { weekName } from "@/lib/dates";
import { orderedWords } from "@/lib/calc/packing";
import { blankWords, type SheetLabel } from "@/lib/calc/packSheet";
import { boxLabelProduct, boxName, onOrderAs } from "@/lib/calc/packTogether";
import {
  byStoreNumber,
  needFor,
  overOrder,
  palletFor,
  shipmentPallets,
  stillNeeds,
  type Need,
  type RouteOrder,
  type RoutePallet,
} from "@/lib/calc/routing";
import {
  orderSheet,
  packLines,
  sheetRowId,
  type PackingData,
  type PackOrder,
  type PackProduct,
  type PackWeight,
} from "@/lib/db/packing";
import { isLocal, type Action } from "@/lib/offline/outbox";
import { todayISO } from "@/lib/dates";
import { qtyText } from "@/lib/orders";

/** "6 each", "45 lb", "1 case": what the store ordered of this product. */
export function orderedText(
  o: PackOrder,
  productId: string,
  data: PackingBundle,
): string {
  const q = o.lines[productId];
  if (!q) return "none of this";
  // A piece product taken in pounds: its whole pieces, then the pounds (Lucas, 11/7/26).
  const line = packLines(o, data.packing.products).find(([pid]) => pid === productId)?.[1];
  if (line) return orderedWords(line);
  return qtyText(
    q,
    o.units[productId] ?? data.packing.products.get(productId)?.unit ?? "each",
  );
}

/** "1 of 1 box packed", "40 of 45 lb packed". */
export function filledText(n: Need): string {
  if (n.kind === "boxes")
    return `${n.done} of ${n.total} box${n.total === 1 ? "" : "es"} packed`;
  if (n.kind === "lb")
    return `${fmt(Math.round(n.done * 100) / 100)} of ${fmt(Math.round(n.total))} lb packed`;
  return `${n.done} box${n.done === 1 ? "" : "es"} packed, and the line marked done`;
}

/** A box already recorded, and the order it's on (null: unassigned). */
export type FoundBox = {
  w: PackWeight;
  orderId: string | null;
  /** Set for a box recorded in an earlier week: where it is now. */
  earlier?: { customer: string | null; week: string };
};

/** A box from an earlier week, ready to move into this one (11/18/26). */
export function earlierFound(b: EarlierBox): FoundBox {
  return {
    w: {
      id: b.id,
      product_id: b.productId,
      weight: b.weight,
      box_no: null,
      by: null,
      at: b.at,
      source: "scan",
      gtin: b.gtin,
      serial: b.serial,
      lot: b.lot,
      case_no: b.caseNo,
      pallet_id: null,
      client_id: null,
      slot: null,
      label_no: null,
    },
    orderId: null,
    earlier: { customer: b.customer, week: b.week },
  };
}
/** Where a box moves to: a store's order and a pallet, or Unassigned (both null). */
export type MoveTarget = { orderId: string | null; palletId: string | null };

/** Find a recorded box by its barcode (GTIN and serial), or by id. */
export function findBox(
  data: PackingBundle,
  gtin: string | null,
  serial: string | null,
  id?: string,
): FoundBox | null {
  const hit = (w: PackWeight) =>
    (id && w.id === id) ||
    (!!gtin && !!serial && w.gtin === gtin && w.serial === serial);
  for (const o of data.packing.orders) {
    const w = o.weights.find(hit);
    if (w) return { w, orderId: o.id };
  }
  const w = data.packing.unassigned.find(hit);
  return w ? { w, orderId: null } : null;
}

/**
 * Move a box: the store first (stores that still need this product, by PCC
 * number, or every store), then a pallet for that store's shipment (chosen
 * when there's only one). Going over the new store's order is warned about,
 * not blocked. Saved with the box's new box and label number; the audit log
 * keeps the old and new store (10/26/26).
 */
export function MoveSheet({
  b,
  focus,
  data,
  labels,
  onClose,
  onSave,
  onFreezer,
}: {
  b: FoundBox;
  focus: "store" | "pallet";
  data: PackingBundle;
  labels: SheetLabel[];
  onClose: () => void;
  onSave: (to: MoveTarget) => void;
  /** A box with no store: put it in the freezer as a leftover, with its count (11/20/26). */
  onFreezer?: (qty: number) => void;
}) {
  const w = b.w;
  const [freezing, setFreezing] = useState(false);
  const [orderId, setOrderId] = useState<string>(b.orderId ?? "");
  // A box from another week is going to a store someone chose, so every store is listed.
  const [all, setAll] = useState(!!b.earlier);
  const [palletId, setPalletId] = useState<string | null>(null);
  const pallets = routePallets(data);
  const orders = data.packing.orders;
  // Routing without this box, so a store isn't counted as having it already.
  const without: PackingBundle = {
    ...data,
    packing: {
      ...data.packing,
      orders: orders.map((o) => ({
        ...o,
        weights: o.weights.filter((x) => x.id !== w.id),
      })),
    },
  };
  const needing = orders
    .map((o) => routeOrder(o, w.product_id, without, labels))
    .filter((r) => r.need && stillNeeds(r.need))
    .map((r) => r.orderId);
  const shown = [...orders]
    // No store needs it: every store, so there's always someone to choose.
    .filter((o) => all || !needing.length || o.id === b.orderId || needing.includes(o.id))
    .sort((x, y) =>
      byStoreNumber({ name: x.labelCustomer }, { name: y.labelCustomer }),
    );
  const target = orders.find((o) => o.id === orderId);
  const ro = target ? routeOrder(target, w.product_id, without, labels) : null;
  const choices = ro ? shipmentPallets(ro, pallets) : [];
  // The pallet: what Chris chose; else the box's own (same store), or the store's pallet.
  const auto = target
    ? orderId === b.orderId && w.pallet_id
      ? w.pallet_id
      : (palletFor(ro!, w.product_id, pallets)?.id ??
        (choices.length === 1 ? choices[0].id : null))
    : null;
  const pallet =
    palletId && choices.some((x) => x.id === palletId) ? palletId : auto;
  const over =
    !!target && orderId !== b.orderId && overOrder(ro!.need, w.weight);
  const changed =
    (orderId || null) !== b.orderId || pallet !== (w.pallet_id ?? null);
  const name = boxName(w.product_id, data.packing.products, data.packing.orders.find((o) => o.id === b.orderId)?.lines);

  return (
    <Sheet title={`Move ${name}, ${fmt(w.weight)} lb`} onClose={onClose}>
      <label className="lbl big mt-0!" htmlFor="mv-store">
        Store
      </label>
      <select
        id="mv-store"
        className="field big"
        value={orderId}
        autoFocus={focus === "store"}
        onChange={(e) => {
          setOrderId(e.target.value);
          setPalletId(null);
        }}
      >
        {!b.orderId && <option value="">{b.earlier ? "Choose a store" : "Unassigned"}</option>}
        {shown.map((o) => (
          <option key={o.id} value={o.id}>
            {o.labelCustomer}
            {o.id === b.orderId
              ? " (now)"
              : needing.includes(o.id)
                ? ""
                : " (doesn't need it)"}
          </option>
        ))}
      </select>
      <label className="mt-2 flex min-h-[44px] items-center gap-2">
        <input
          type="checkbox"
          className="h-6 w-6 accent-forest"
          checked={all}
          onChange={(e) => setAll(e.target.checked)}
        />
        Show all stores
      </label>
      {over && target && (
        <p className="route-over">
          <b>Over the order.</b> {target.labelCustomer} ordered{" "}
          {orderedText(target, w.product_id, data)}
          {ro!.need ? ` and has ${filledText(ro!.need)}` : ""}. You can still
          move it.
        </p>
      )}

      {target && (
        <>
          <label className="lbl big" htmlFor="mv-pallet">
            Pallet
          </label>
          {choices.length ? (
            <select
              id="mv-pallet"
              className="field big"
              value={pallet ?? ""}
              autoFocus={focus === "pallet"}
              onChange={(e) => setPalletId(e.target.value || null)}
            >
              {!pallet && <option value="">Choose a pallet</option>}
              {choices.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.tag}
                  {x.status === "planned" ? " (planned)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <p className="small m-0">
              {ro!.shipName} has no open pallet. Start one on the Pallets page,
              then move the box.
            </p>
          )}
        </>
      )}

      <div className="mt-4 grid gap-2">
        <button
          type="button"
          className="bigbtn mt-0!"
          disabled={!changed || (!!target && choices.length > 0 && !pallet)}
          onClick={() =>
            onSave({
              orderId: orderId || null,
              palletId: target ? pallet : null,
            })
          }
        >
          Save
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>

      {onFreezer && !b.orderId && !b.earlier && (
        <div className="mt-4 border-t pt-3">
          {!freezing ? (
            <button type="button" className="btn ghost w-full" onClick={() => setFreezing(true)}>
              Leftover? Put in freezer
            </button>
          ) : (
            <FreezerCount product={data.packing.products.get(boxLabelProduct(w))} weight={w.weight} onPut={onFreezer} onCancel={() => setFreezing(false)} />
          )}
        </div>
      )}
    </Sheet>
  );
}

/** How many are in the leftover box (pounds: its weight), then put it in the freezer. */
function FreezerCount({
  product,
  weight,
  onPut,
  onCancel,
}: {
  product: PackProduct | undefined;
  weight: number;
  onPut: (qty: number) => void;
  onCancel: () => void;
}) {
  const byWeight = product?.unit === "lb";
  const guess = !byWeight && product?.lb_per_unit && product.lb_per_unit > 0 ? Math.max(1, Math.round(weight / product.lb_per_unit)) : 1;
  const [count, setCount] = useState(String(guess));
  const n = byWeight ? weight : Number(count);
  const word = product?.unit === "each" ? "pieces" : product?.unit === "pack" ? "packs" : product?.unit ?? "pieces";
  return (
    <div>
      <p className="m-0 mb-2">
        <b>Put in freezer.</b> It comes off Packing and counts as this week&apos;s freezer income.
      </p>
      {!byWeight && (
        <>
          <label className="lbl big mt-0!" htmlFor="fz-count">
            How many {word} in this box?
          </label>
          <input
            id="fz-count"
            className="field big"
            inputMode="decimal"
            value={count}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setCount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </>
      )}
      <div className="mt-3 grid gap-2">
        <button type="button" className="bigbtn mt-0!" disabled={!(n > 0)} onClick={() => onPut(n)}>
          Put in freezer
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Don&apos;t put it in the freezer
        </button>
      </div>
    </div>
  );
}

/** Put a box with no store in the freezer: off Packing and into freezer inventory in one step (11/20/26). */
export function sendToFreezer(enqueue: (a: Action) => Promise<unknown>, week: string, b: FoundBox, qty: number) {
  const w = b.w;
  return enqueue({
    type: "box-to-freezer",
    ...(isLocal(w) ? { weight_client_id: w.client_id ?? "" } : { weight_id: w.id }),
    box: {
      client_id: crypto.randomUUID(),
      product_id: boxLabelProduct(w),
      qty,
      weight_lb: w.weight,
      gtin: w.gtin,
      serial: w.serial,
      serial_date: null,
      case_no: w.case_no,
      pack_date: null,
      lot: w.lot,
      raw_scan: null,
      product_confirmed: true,
      source: "packing",
      reason: "leftover",
      note: "",
      added_on: todayISO(),
      week_id: week,
      counts_as_income: true,
      at: new Date().toISOString(),
    },
  });
}

/** One order as routing sees it, for this product. */
export function routeOrder(
  o: PackOrder,
  productId: string,
  data: PackingBundle,
  labels: SheetLabel[],
): RouteOrder {
  const rows = orderSheet(o, data.packing, labels);
  const lines = new Map(packLines(o, data.packing.products));
  // A box packed together with others (Organs) fills whichever of them is on the order.
  const asId =
    onOrderAs(productId, o.lines, data.packing.products) ?? productId;
  // Packed together (Organs): their row is under the group's first product.
  const row = rows.find((r) => r.productId === sheetRowId(asId, data.packing));
  const line = lines.get(asId);
  const need =
    row && line
      ? needFor(
          row,
          line,
          data.packing.products.get(asId)?.lb_per_unit ?? null,
        )
      : null;
  // How far along the whole order is: boxes packed over boxes planned (pounds where boxes aren't known).
  let done = 0;
  let total = 0;
  for (const r of rows) {
    const l = lines.get(r.productId);
    if (!l) continue;
    if (r.known) {
      done += Math.min(r.blanks.filter((b) => b.weight).length, r.boxCount);
      total += r.boxCount;
    }
  }
  const progress = total > 0 ? done / total : 0;
  return {
    orderId: o.id,
    customerId: o.customerId,
    name: o.labelCustomer,
    shipKey: o.shipKey,
    shipName: o.group ?? o.labelCustomer,
    via: o.group,
    shipDate: null,
    need,
    progress,
  };
}

/** The week's pallets with the boxes on them, as routing sees them. */
export function routePallets(data: PackingBundle): RoutePallet[] {
  const boxes = new Map<
    string,
    { customerId: string | null; productId: string }[]
  >();
  const add = (w: PackWeight, customerId: string | null) => {
    if (!w.pallet_id) return;
    const l = boxes.get(w.pallet_id) ?? [];
    l.push({ customerId, productId: w.product_id });
    boxes.set(w.pallet_id, l);
  };
  for (const o of data.packing.orders)
    for (const w of o.weights) add(w, o.customerId);
  for (const w of data.packing.unassigned) add(w, null);
  return data.pallets.map((p) => ({
    id: p.id,
    tag: p.tag,
    status: p.status,
    shipKeys: p.shipKeys,
    createdAt: p.created_at,
    plan: p.plan,
    boxes: boxes.get(p.id) ?? [],
    customers: p.customers,
  }));
}

/** The next empty box of a customer's product on the packing sheet, skipping ones filled moments ago. */
export function boxFor(
  order: PackOrder,
  productId: string,
  data: PackingData,
  labels: SheetLabel[],
  filled: Set<string>,
) {
  const row = orderSheet(order, data, labels).find(
    (r) => r.productId === sheetRowId(productId, data),
  );
  if (!row) return { slot: 1, label_no: null, boxTypeId: null, words: "Box 1" };
  const b = row.blanks.find(
    (x) => !x.weight && !filled.has(`${order.id}|${productId}|${x.slot}`),
  );
  const slot =
    b?.slot ??
    Math.max(
      row.blanks.length,
      ...[...filled]
        .filter((k) => k.startsWith(`${order.id}|${productId}|`))
        .map((k) => Number(k.split("|")[2])),
    ) + 1;
  return {
    slot,
    label_no: b?.planned ? b.labelNo : null,
    boxTypeId:
      b?.boxTypeId ?? row.blanks[row.blanks.length - 1]?.boxTypeId ?? null,
    words: b ? blankWords(row, slot) : `Box ${slot}`,
  };
}

/** Where the move was made from, for the audit log. */
export type MoveFrom = "Scan boxes" | "Packing";

/**
 * Save a move: the box's store, pallet, box and label number. Taking a box off
 * its store records the moment it was tapped: the audit log's own time is when
 * the phone uploaded, which can be later with no signal (11/17/26).
 */
export async function sendBoxMove(
  enqueue: (a: Action) => Promise<unknown>,
  data: PackingBundle,
  labels: SheetLabel[],
  week: string,
  b: FoundBox,
  to: MoveTarget,
  from: MoveFrom,
) {
  const w = b.w;
  const order = to.orderId ? data.packing.orders.find((o) => o.id === to.orderId) : undefined;
  // Its box and label number at the new store; the same ones when only the pallet changes.
  const sameStore = (to.orderId ?? null) === (b.orderId ?? null);
  // A shank box counts as Mixed Shanks at a store that ordered those (11/18/26).
  const label = boxLabelProduct(w);
  const countsAs = order ? (w.correction_reason ? w.product_id : (onOrderAs(label, order.lines, data.packing.products) ?? label)) : label;
  const slot = order
    ? sameStore
      ? { slot: w.slot, label_no: w.label_no }
      : boxFor(order, countsAs, data.packing, labels, new Set())
    : { slot: null, label_no: null };
  if (to.palletId && data.pallets.find((x) => x.id === to.palletId)?.status === "planned")
    await enqueue({ type: "pallet-status", id: to.palletId, status: "open" });
  await enqueue({
    type: "weight-move",
    from_order_id: b.orderId,
    ...(isLocal(w) ? { client_id: w.client_id ?? "" } : { weight_id: w.id }),
    order_id: order?.id ?? null,
    week_id: week,
    pallet_id: order ? to.palletId : null,
    slot: slot.slot ?? null,
    label_no: slot.label_no ?? null,
    off_order: !!order && !onOrderAs(countsAs, order.lines, data.packing.products),
    ...(b.earlier ? { box: w } : {}),
    via: !order
      ? `unassigned (${from}), tapped ${new Date().toISOString()}`
      : b.earlier
        ? `moved from ${b.earlier.customer ?? "unassigned boxes"}, packing ${weekName(b.earlier.week)} (${from})`
        : !b.orderId
          ? `assigned from Not assigned (${from})`
          : sameStore
            ? `moved to another pallet (${from})`
            : `moved to another store (${from})`,
  });
  if (b.earlier) clearEarlierBoxes();
  return { order, labelNo: slot.label_no ?? null, tag: data.pallets.find((x) => x.id === to.palletId)?.tag };
}

/** Scans refused because their label was already used: not saved anywhere, so they stay here until dealt with (11/17/26). */
export function NotSavedBanner({ data, onChanged }: { data: PackingBundle; onChanged: () => void }) {
  const me = useMe();
  const toast = useToast();
  const canResolve = useCan("orders").change || me.role === "admin";
  const [busy, setBusy] = useState<string | null>(null);
  const p = data.packing;
  const scans = notSavedScans(data.refusedScans, p.week, p.orders, p.unassigned);
  if (!scans.length) return null;
  return (
    <section className="notassigned screen-only" role="alert" aria-label="Scans not saved">
      <h2>{notSavedTitle(scans.length)}</h2>
      <p className="m-0 mt-1">
        {scans.length === 1 ? "This box is" : "These boxes are"} not on any store or pallet. Check the label. To add a box, use Label won&apos;t scan on Scan boxes.
      </p>
      <ul>
        {scans.map((s) => (
          <li key={s.key}>
            <span className="flex-1">
              {notSavedLine(s, s.productId ? boxName(s.productId, p.products) : "Box")}
              <span className="small block">{notSavedWhy(s)}</span>
            </span>
            {canResolve && (
              <button
                type="button"
                className="btn ghost"
                disabled={busy === s.key}
                onClick={() => {
                  if (!window.confirm("Mark this scan as dealt with? It will leave this list.")) return;
                  setBusy(s.key);
                  void resolveRefusedScans(getDb(), s.ids, me.id).then((e) => {
                    setBusy(null);
                    if (e) return toast(`Couldn't save: ${e}`);
                    toast("Marked as dealt with");
                    onChanged();
                  });
                }}
              >
                Dealt with
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The banner at the top of Packing and Scan boxes: every box not on a store and a pallet (11/17/26). */
export function NotAssignedBanner({
  boxes,
  products,
  canPack,
  onAssign,
}: {
  boxes: NotAssigned<PackWeight>[];
  products: Map<string, PackProduct>;
  canPack: boolean;
  onAssign: (b: FoundBox) => void;
}) {
  if (!boxes.length) return null;
  return (
    <section className="notassigned screen-only" role="alert" aria-label="Boxes not assigned">
      <h2>{notAssignedTitle(boxes.length)}</h2>
      <ul>
        {boxes.map((b) => (
          <li key={b.w.id}>
            <span className="flex-1">
              {notAssignedLine({
                product: boxName(b.w.product_id, products, b.lines ?? undefined),
                weight: b.w.weight,
                lot: b.w.lot,
                caseNo: b.w.case_no,
                customer: b.customer,
              })}
            </span>
            {canPack && (
              <button type="button" className="btn" onClick={() => onAssign({ w: b.w, orderId: b.orderId })}>
                Assign
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
