import { describe, expect, it } from "vitest";
import { deliveryDate, deliveryDayOf, lastOrders, type PastOrder } from "./lastOrder";

const o = (customer_id: string, week: string, status: string, lines: Record<string, number>): PastOrder => ({
  customer_id,
  week,
  status,
  lines,
  units: {},
});

describe("last order", () => {
  const orders = [
    o("key", "2026-10-12", "ordered", { chops: 20 }),
    o("key", "2026-10-19", "ordered", { chops: 16, legs: 6 }),
    o("key", "2026-10-26", "ordered", { chops: 99 }), // the week being viewed: not "last"
    o("pcc", "2026-10-05", "ordered", { trim: 40 }),
    o("pcc", "2026-10-12", "none", {}), // no order that week
    o("pcc", "2026-10-19", "ordered", {}), // marked ordered, nothing on it
    o("new", "2026-10-19", "callback", {}),
  ];
  const last = lastOrders(orders, "2026-10-26");

  it("is the most recent week with an order before the week being viewed", () => {
    expect(last.get("key")).toEqual({ week: "2026-10-19", lines: { chops: 16, legs: 6 }, units: {} });
  });

  it("skips weeks with no order, going back as far as needed", () => {
    expect(last.get("pcc")?.week).toBe("2026-10-05");
  });

  it("never ordered: nothing", () => {
    expect(last.has("new")).toBe(false);
  });
});

describe("scheduled delivery", () => {
  it("is the first matching weekday after the packing Monday", () => {
    expect(deliveryDate("2026-10-26", "Saturday")).toBe("2026-10-31");
    expect(deliveryDate("2026-10-26", "Tuesday")).toBe("2026-10-27");
    expect(deliveryDate("2026-10-26", "Monday")).toBe("2026-11-02");
    expect(deliveryDate("2026-10-26", null)).toBeNull();
  });

  it("a store uses its own delivery day, or its chain's", () => {
    const byId = new Map([["pcc", { delivery_day: "Saturday" }]]);
    expect(deliveryDayOf({ delivery_day: null, parent_customer_id: "pcc" }, byId)).toBe("Saturday");
    expect(deliveryDayOf({ delivery_day: "Friday", parent_customer_id: "pcc" }, byId)).toBe("Friday");
    expect(deliveryDayOf({ delivery_day: null, parent_customer_id: null }, byId)).toBeNull();
  });
});
