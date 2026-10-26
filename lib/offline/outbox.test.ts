// SPEC 11.7: the outbox. Saved on the phone first, shown straight away,
// uploaded oldest first, nothing lost.

import { describe, expect, it } from "vitest";
import type { PackingData, PackOrder } from "../db/packing";
import { applyQueue, isAuthError, isLocal, isNetworkError, statusLine, syncQueue, type Action, type Outcome, type Queued } from "./outbox";

const order = (over: Partial<PackOrder> = {}): PackOrder => ({
  id: "o1",
  customerId: "c1",
  customerName: "Kirkland",
  labelCustomer: "Kirkland",
  labelName: "Kirkland",
  labelLocation: "",
  sortKey: "1|Kirkland",
  standingNotes: "",
  orderNotes: "",
  group: null,
  spot: "",
  shipKey: "customer:c1",
  shipsToPointId: null,
  lines: { rack: 10 },
  units: {},
  marks: {},
  weights: [],
  pallet: "",
  lastBy: null,
  lastAt: null,
  ...over,
});
const data = (orders: PackOrder[] = [order()]): PackingData => ({
  week: "2026-10-19",
  processDate: null,
  labelsHash: null,
  labelsPrintedAt: null,
  invNumber: null,
  labelNumbers: new Map(),
  blanks: { unknown: 6, spare: 2 },
  unassigned: [],
  points: new Map(),
  products: new Map(),
  orders,
});
let n = 0;
const q = (action: Action, over: Partial<Queued> = {}): Queued => ({ seq: ++n, action, queuedAt: "2026-10-26T15:00:00Z", tries: 0, ...over });

describe("what the packer sees while things wait on the phone", () => {
  it("a weight shows straight away, marked as only on this phone", () => {
    const d = applyQueue(data(), [q({ type: "weight-add", client_id: "a", order_id: "o1", product_id: "rack", weight: 22.15, box_no: 1, at: "t" })]);
    const w = d.orders[0].weights[0];
    expect(w).toMatchObject({ weight: 22.15, box_no: 1, client_id: "a", by: "This phone" });
    expect(isLocal(w)).toBe(true);
  });

  it("once uploaded (the server has its client_id), it isn't shown twice", () => {
    const server = order({
      weights: [{ id: "w9", product_id: "rack", weight: 22.15, box_no: 1, by: "Chris", at: "t", source: "weigh", gtin: null, serial: null, lot: null, case_no: null, pallet_id: null, client_id: "a", slot: null, label_no: null }],
    });
    const d = applyQueue(data([server]), [q({ type: "weight-add", client_id: "a", order_id: "o1", product_id: "rack", weight: 22.15, box_no: 1, at: "t" })]);
    expect(d.orders[0].weights).toHaveLength(1);
  });

  it("taking off a weight works for one uploaded and one still waiting", () => {
    const server = order({
      weights: [{ id: "w1", product_id: "rack", weight: 20, box_no: 1, by: "Chris", at: "t", source: "weigh", gtin: null, serial: null, lot: null, case_no: null, pallet_id: null, client_id: null, slot: null, label_no: null }],
    });
    const d = applyQueue(data([server]), [
      q({ type: "weight-add", client_id: "b", order_id: "o1", product_id: "rack", weight: 21, box_no: 2, at: "t" }),
      q({ type: "weight-remove", order_id: "o1", weight_id: "w1" }),
      q({ type: "weight-remove", order_id: "o1", client_id: "b" }),
    ]);
    expect(d.orders[0].weights).toEqual([]);
  });

  it("marks and the pallet note show the latest", () => {
    const d = applyQueue(data(), [
      q({ type: "mark", order_id: "o1", product_id: "rack", mark: { count: null, shorted: true, flagged: false, flagNote: "" } }),
      q({ type: "pallet-text", order_id: "o1", pallet: "PCC 1" }),
      q({ type: "pallet-text", order_id: "o1", pallet: "PCC 2" }),
    ]);
    expect(d.orders[0].marks.rack.shorted).toBe(true);
    expect(d.orders[0].pallet).toBe("PCC 2");
  });

  it("a scanned box shows with its label details and the next box number", () => {
    const d = applyQueue(data(), [
      q({
        type: "box",
        box: { client_id: "s1", order_id: "o1", product_id: "rack", source: "scan", weight: 22.15, lot: "528801", gtin: "10698746488816", serial: "2628710066", case_no: "10066", scanned_at: "t" },
      }),
      q({ type: "box", box: { client_id: "s2", order_id: "o1", product_id: "rack", source: "manual", weight: 20, lot: "528801", scanned_at: "t" } }),
    ]);
    expect(d.orders[0].weights.map((w) => [w.box_no, w.source, w.serial, w.lot])).toEqual([
      [1, "scan", "2628710066", "528801"],
      [2, "manual", null, "528801"],
    ]);
  });

  it("nothing waiting: the data is unchanged", () => {
    const d = data();
    expect(applyQueue(d, [])).toBe(d);
  });
});

describe("uploading", () => {
  const add = (id: string) => q({ type: "weight-add", client_id: id, order_id: "o1", product_id: "rack", weight: 1, box_no: null, at: "t" });

  it("sends oldest first and empties the queue", async () => {
    const sent: string[] = [];
    const r = await syncQueue([add("b"), add("a")].reverse(), async (a) => {
      sent.push(a.type === "weight-add" ? a.client_id : "?");
      return { kind: "done" };
    });
    expect(sent).toEqual(["b", "a"]);
    expect(r).toMatchObject({ sent: 2, stoppedFor: null, queue: [] });
  });

  it("stops at the first signal problem and keeps the rest, in order", async () => {
    const items = [add("1"), add("2"), add("3")];
    let calls = 0;
    const r = await syncQueue(items, async (): Promise<Outcome> => (++calls === 2 ? { kind: "network" } : { kind: "done" }));
    expect(r.sent).toBe(1);
    expect(r.stoppedFor).toBe("network");
    expect(r.queue.map((x) => (x.action as { client_id: string }).client_id)).toEqual(["2", "3"]);
    expect(r.queue[0].tries).toBe(1);
  });

  it("a thrown 'Failed to fetch' counts as no signal, not a refusal", async () => {
    const r = await syncQueue([add("1")], async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(r).toMatchObject({ stoppedFor: "network" });
    expect(r.queue[0].stuck).toBeUndefined();
  });

  it("a refused action is kept as stuck and the rest still go", async () => {
    const r = await syncQueue([add("1"), add("2")], async (a) =>
      a.type === "weight-add" && a.client_id === "1" ? { kind: "refused", message: "new row violates row-level security" } : { kind: "done" },
    );
    expect(r.sent).toBe(1);
    expect(r.queue).toHaveLength(1);
    expect(r.queue[0]).toMatchObject({ stuck: true, lastError: "new row violates row-level security" });
  });

  it("a login that ran out stops uploads until they log in", async () => {
    const r = await syncQueue([add("1"), add("2")], async () => ({ kind: "auth" }));
    expect(r).toMatchObject({ stoppedFor: "auth", sent: 0 });
    expect(r.queue).toHaveLength(2);
  });

  it("stuck ones aren't sent again by themselves", async () => {
    let calls = 0;
    await syncQueue([add("1")].map((x) => ({ ...x, stuck: true })), async () => {
      calls++;
      return { kind: "done" };
    });
    expect(calls).toBe(0);
  });
});

describe("errors and the status line", () => {
  it("tells signal problems from refusals", () => {
    for (const m of ["TypeError: Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "The request timed out"])
      expect(isNetworkError(m)).toBe(true);
    expect(isNetworkError("duplicate key value violates unique constraint")).toBe(false);
    expect(isAuthError("JWT expired")).toBe(true);
    expect(isAuthError("x", 401)).toBe(true);
  });

  it("says plainly where things stand", () => {
    expect(statusLine({ online: true, waiting: 0, stuck: 0, needLogin: false, syncing: false })).toBe("Online, all saved");
    expect(statusLine({ online: false, waiting: 12, stuck: 0, needLogin: false, syncing: false })).toBe("Offline, 12 things waiting");
    expect(statusLine({ online: true, waiting: 1, stuck: 0, needLogin: false, syncing: true })).toBe("Online, uploading, 1 thing waiting");
    expect(statusLine({ online: true, waiting: 3, stuck: 0, needLogin: true, syncing: false })).toBe("Log in again to upload, 3 things waiting");
    expect(statusLine({ online: true, waiting: 0, stuck: 2, needLogin: false, syncing: false })).toBe("Online, 2 couldn't upload");
  });
});
