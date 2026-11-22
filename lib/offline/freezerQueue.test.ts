import { describe, expect, it } from "vitest";
import { applyFreezerQueue } from "./freezerQueue";
import type { FreezerBundle } from "../db/freezer";
import type { Action, Queued } from "./outbox";

const bundle = (over: Partial<FreezerBundle> = {}): FreezerBundle => ({
  products: [],
  gtins: [],
  lots: [],
  boxes: [],
  onHand: { shanks: 10 },
  held: [],
  count: null,
  items: [],
  devices: [],
  people: {},
  ...over,
});
let seq = 0;
const q = (action: Action, stuck = false): Queued => ({ seq: ++seq, action, queuedAt: "2026-11-20T18:00:00Z", tries: 0, stuck });
const add = (client_id: string, qty = 16) =>
  q({
    type: "freezer-add",
    box: {
      client_id,
      product_id: "shanks",
      qty,
      weight_lb: 32.6,
      gtin: "10698746488816",
      serial: client_id,
      serial_date: null,
      case_no: null,
      pack_date: null,
      lot: null,
      raw_scan: null,
      product_confirmed: true,
      source: "scan",
      reason: "added_manually",
      note: "",
      added_on: "2026-11-20",
      week_id: null,
      counts_as_income: false,
      at: "2026-11-20T18:00:00Z",
    },
  });

describe("the freezer copy with what's waiting on the phone", () => {
  it("shows boxes added with no signal, and counts them as waiting", () => {
    const r = applyFreezerQueue(bundle(), [add("a"), add("b", 4)]);
    expect(r.boxes.map((b) => b.id)).toEqual(["local:a", "local:b"]);
    expect(r.onHand.shanks).toBe(30);
    expect(r.waitingAdds).toBe(2);
  });
  it("takes back a box removed before it uploaded", () => {
    const r = applyFreezerQueue(bundle(), [add("a"), q({ type: "freezer-remove", client_id: "a" })]);
    expect(r.boxes).toEqual([]);
    expect(r.onHand.shanks).toBe(10);
  });
  it("leaves out what the server refused (shown separately)", () => {
    expect(applyFreezerQueue(bundle(), [{ ...add("a"), stuck: true }]).boxes).toEqual([]);
  });
  it("keeps a count started and scanned with no signal, with its changes", () => {
    const r = applyFreezerQueue(bundle(), [
      q({ type: "count-start", count: { id: "c1", kind: "stock_in", product_ids: null, count_date: "2026-11-20" } }),
      q({
        type: "count-item",
        item: {
          id: "i1",
          count_id: "c1",
          device_id: "p",
          kind: "scan",
          product_id: "shanks",
          qty: 16,
          weight_lb: 32.6,
          gtin: "1",
          serial: "s",
          serial_date: null,
          case_no: null,
          pack_date: null,
          lot: null,
          raw_scan: null,
          product_confirmed: true,
          decision: null,
          scanned_at: "2026-11-20T18:01:00Z",
        },
      }),
      q({ type: "count-item-set", id: "i1", count_id: "c1", patch: { voided: true } }),
    ]);
    expect(r.count?.id).toBe("c1");
    expect(r.items.map((i) => [i.id, i.voided])).toEqual([["i1", true]]);
    expect(r.waitingCount).toBe(3);
  });
});
