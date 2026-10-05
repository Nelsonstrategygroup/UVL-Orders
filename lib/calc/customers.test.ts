import { describe, expect, it } from "vitest";
import { callQueue, displayName, matchesSearch, orderingCustomers, type CustomerLite } from "./customers";
import type { OrderStatus } from "./types";

const c = (id: string, name: string, extra: Partial<CustomerLite> = {}): CustomerLite => ({
  id,
  name,
  active: true,
  call_day: null,
  parent_customer_id: null,
  ...extra,
});

describe("customers", () => {
  const pcc = c("p", "PCC");
  const fremont = c("f", "Fremont", { parent_customer_id: "p" });
  const ballard = c("b", "Ballard", { parent_customer_id: "p", active: false });
  const all = [pcc, fremont, ballard, c("x", "Xavier's Deli")];
  const byId = new Map(all.map((x) => [x.id, x]));

  it("shows locations as Parent: Location", () => {
    expect(displayName(fremont, byId)).toBe("PCC: Fremont");
    expect(displayName(pcc, byId)).toBe("PCC");
  });

  it("leaves out parents that have active locations, and inactive customers", () => {
    expect(orderingCustomers(all).map((x) => x.id)).toEqual(["f", "x"]);
    // A parent whose locations are all inactive orders for itself.
    expect(orderingCustomers([pcc, ballard]).map((x) => x.id)).toEqual(["p"]);
  });

  it("orders the calls queue: today, then call-backs, then the rest, then done", () => {
    const list = [
      c("1", "Alder Market"),
      c("2", "Birch Cafe", { call_day: "Monday" }),
      c("3", "Cedar Grocery"),
      c("4", "Dogwood Deli", { call_day: "Monday" }),
      c("5", "Elm Butcher"),
      c("6", "Fir Foods", { call_day: "Monday" }),
    ];
    const status: Record<string, OrderStatus> = { "3": "callback", "5": "ordered", "6": "none" };
    const q = callQueue(list, (id) => status[id], "Monday", new Map(list.map((x) => [x.id, x])));
    expect(q.map((x) => x.name)).toEqual([
      "Birch Cafe", // call day today
      "Dogwood Deli", // call day today
      "Cedar Grocery", // call back
      "Alder Market", // not done
      "Elm Butcher", // done
      "Fir Foods", // done (today, but already said no)
    ]);
  });
});

describe("find a customer as you type", () => {
  const pcc = c("p", "PCC");
  const fremont = c("f", "Fremont", { parent_customer_id: "p" });
  const list = [c("1", "Adams Market"), c("2", "Adobe Grill"), c("3", "Fred's Adobe"), pcc, fremont];
  const byId = new Map(list.map((x) => [x.id, x]));
  const find = (q: string) => list.filter((x) => matchesSearch(q, x, byId)).map((x) => displayName(x, byId));

  it("narrows to names that start with the letters typed", () => {
    expect(find("AD")).toEqual(["Adams Market", "Adobe Grill"]);
    expect(find("ado")).toEqual(["Adobe Grill"]);
    expect(find("x")).toEqual([]);
  });

  it("finds a store by its own name or by its chain", () => {
    expect(find("fre")).toEqual(["Fred's Adobe", "PCC: Fremont"]);
    expect(find("pcc")).toEqual(["PCC", "PCC: Fremont"]);
    expect(find("pcc: f")).toEqual(["PCC: Fremont"]);
  });

  it("shows everyone when the box is empty", () => {
    expect(find("  ")).toHaveLength(5);
  });
});
