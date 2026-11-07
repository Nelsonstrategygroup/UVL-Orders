import { describe, expect, it } from "vitest";
import {
  callQueue,
  compareCustomerIds,
  countable,
  displayName,
  groupForList,
  matchesSearch,
  orderingCustomers,
  sortByDisplayName,
  type CustomerLite,
} from "./customers";
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

describe("customers list", () => {
  const pcc = c("p", "PCC");
  const fremont = c("f", "Fremont", { parent_customer_id: "p" });
  const ballard = c("b", "Ballard", { parent_customer_id: "p", active: false });
  const deli = c("x", "Xavier's Deli");
  const abe = c("a", "Abe's", { active: false });
  const all = [deli, fremont, pcc, ballard, abe];
  const byId = new Map(all.map((x) => [x.id, x]));
  const names = (g: ReturnType<typeof groupForList<CustomerLite>>) =>
    g.map((x) => [x.top.name, ...x.locations.map((l) => "  " + l.name)]).flat();

  it("puts customers with locations first, locations under their parent by name", () => {
    expect(names(groupForList(all, () => true))).toEqual(["PCC", "  Ballard", "  Fremont", "Abe's", "Xavier's Deli"]);
  });

  it("shows a parent for its kept locations even when the parent isn't kept", () => {
    const active = groupForList(all, (x) => x.active && x.id !== "p");
    expect(names(active)).toEqual(["PCC", "  Fremont", "Xavier's Deli"]);
    const search = groupForList(all, (x) => matchesSearch("pcc: b", x, byId));
    expect(names(search)).toEqual(["PCC", "  Ballard"]);
  });

  it("counts customers without the parents", () => {
    expect(countable(all).map((x) => x.id)).toEqual(["x", "f", "b", "a"]);
    // A parent with no locations is an ordinary customer.
    expect(countable([pcc]).map((x) => x.id)).toEqual(["p"]);
  });
});

describe("shared customer order (Lucas, 11/6/26)", () => {
  const all = [
    c("a", "Abe's"),
    c("p", "PCC"),
    c("p10", "#10 Issaquah", { parent_customer_id: "p" }),
    c("p05", "#05 View Ridge", { parent_customer_id: "p" }),
    c("p24", "#24 Central District", { parent_customer_id: "p" }),
    c("z", "Zed Foods"),
    c("z1", "Zed North", { parent_customer_id: "z" }),
    c("e", "Emerson"),
    c("k", "Key City"),
  ];
  const byId = new Map(all.map((x) => [x.id, x]));

  it("puts customers with locations first, chains by name, each with its stores by name, then everyone else", () => {
    expect(sortByDisplayName(all, byId).map((x) => x.id)).toEqual(["p", "p05", "p10", "p24", "z", "z1", "a", "e", "k"]);
  });

  it("goes by having locations, not by the name", () => {
    const plain = [c("p", "PCC"), c("a", "Abe's")];
    expect(sortByDisplayName(plain, new Map(plain.map((x) => [x.id, x]))).map((x) => x.id)).toEqual(["a", "p"]);
  });

  it("keeps the order for part of the list, and by id", () => {
    const some = [all[7], all[2], all[0], all[3]];
    expect(sortByDisplayName(some, byId).map((x) => x.id)).toEqual(["p05", "p10", "a", "e"]);
    expect(["k", "p24", "missing", "z1"].sort(compareCustomerIds(byId))).toEqual(["p24", "z1", "k", "missing"]);
  });
});

describe("shared customer order: closed locations", () => {
  it("doesn't count a chain whose locations are all inactive", () => {
    const list = [
      c("k", "Key City"),
      c("cg", "Corfini Gourmet", { active: false }),
      c("cg1", "SEA", { parent_customer_id: "cg", active: false }),
      c("p", "PCC"),
      c("p1", "#05 View Ridge", { parent_customer_id: "p" }),
    ];
    const byId = new Map(list.map((x) => [x.id, x]));
    expect(sortByDisplayName(list, byId).map((x) => x.id)).toEqual(["p", "p1", "cg", "cg1", "k"]);
  });
});
