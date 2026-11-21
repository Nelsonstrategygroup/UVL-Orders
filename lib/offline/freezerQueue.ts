// The freezer copy on the phone, with everything still waiting to upload put
// on top (Add to freezer and counts work with no signal, 11/20/26). Pure.

import type { CountItem } from "../calc/freezer";
import type { FreezerBoxRow, FreezerBundle } from "../db/freezer";
import type { Queued } from "./outbox";

export const isLocalBox = (b: Pick<FreezerBoxRow, "id">) => b.id.startsWith("local:");

export function applyFreezerQueue(b: FreezerBundle, queue: Queued[]): FreezerBundle & { waitingCount: number; waitingAdds: number } {
  const waiting = queue.filter((q) => !q.stuck);
  const boxes = [...b.boxes];
  const onHand = { ...b.onHand };
  const gtins = [...b.gtins];
  let count = b.count;
  const items: CountItem[] = [...b.items];
  let waitingCount = 0;
  let waitingAdds = 0;
  for (const q of waiting) {
    const a = q.action;
    if (a.type === "freezer-add") {
      waitingAdds++;
      if (boxes.some((x) => x.client_id === a.box.client_id)) continue;
      const x = a.box;
      boxes.push({
        id: `local:${x.client_id}`,
        client_id: x.client_id,
        product_id: x.product_id,
        qty: x.qty,
        qty_left: x.qty,
        weight_lb: x.weight_lb,
        gtin: x.gtin,
        serial: x.serial,
        serial_date: x.serial_date,
        case_no: x.case_no,
        pack_date: x.pack_date,
        lot: x.lot,
        product_confirmed: x.product_confirmed,
        source: x.source,
        reason: x.reason,
        note: x.note,
        added_on: x.added_on,
        week_id: x.week_id ?? "",
        counts_as_income: x.counts_as_income,
        created_by: null,
        created_at: x.at,
      });
      onHand[x.product_id] = (onHand[x.product_id] ?? 0) + x.qty;
    } else if (a.type === "freezer-remove") {
      const i = boxes.findIndex((x) => x.client_id === a.client_id);
      if (i >= 0) {
        onHand[boxes[i].product_id] = (onHand[boxes[i].product_id] ?? 0) - boxes[i].qty_left;
        boxes.splice(i, 1);
      }
    } else if (a.type === "gtin-map") {
      const i = gtins.findIndex((g) => g.gtin === a.gtin);
      if (i >= 0) gtins[i] = { gtin: a.gtin, product_id: a.product_id };
      else gtins.push({ gtin: a.gtin, product_id: a.product_id });
    } else if (a.type === "count-start") {
      waitingCount++;
      if (!count || count.id !== a.count.id)
        count = {
          ...a.count,
          status: "open",
          note: "",
          started_by: null,
          started_at: q.queuedAt,
          applied_by: null,
          applied_at: null,
          applied_anyway: false,
          results: null,
        };
    } else if (a.type === "count-item") {
      waitingCount++;
      if (!items.some((i) => i.id === a.item.id))
        items.push({
          id: a.item.id,
          kind: a.item.kind,
          product_id: a.item.product_id,
          qty: a.item.qty,
          weight_lb: a.item.weight_lb,
          gtin: a.item.gtin,
          serial: a.item.serial,
          lot: a.item.lot,
          pack_date: a.item.pack_date,
          product_confirmed: a.item.product_confirmed,
          decision: a.item.decision,
          voided: false,
          scanned_at: a.item.scanned_at,
          device_id: a.item.device_id,
        });
    } else if (a.type === "count-item-set") {
      waitingCount++;
      const i = items.findIndex((x) => x.id === a.id);
      if (i >= 0) items[i] = { ...items[i], ...a.patch } as CountItem;
    }
  }
  // Items of a count that's no longer the open one (another phone applied it) aren't shown.
  const shownItems = count ? items : [];
  return { ...b, boxes, onHand, gtins, count, items: shownItems, waitingCount, waitingAdds };
}
