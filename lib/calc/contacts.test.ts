import { describe, expect, it } from "vitest";
import { billedThrough, deleteBlockers, parseRoles, rolesLabel } from "./contacts";

describe("contact roles", () => {
  it("reads one or more roles separated by semicolons", () => {
    expect(parseRoles("orders")).toEqual({ roles: ["orders"], unknown: [] });
    expect(parseRoles(" Billing ; ORDERS;")).toEqual({ roles: ["orders", "billing"], unknown: [] });
    expect(parseRoles("order;receiving;billing")).toEqual({ roles: ["orders", "receiving", "billing"], unknown: [] });
    expect(parseRoles("")).toEqual({ roles: [], unknown: [] });
    expect(parseRoles("owner; billing")).toEqual({ roles: ["billing"], unknown: ["owner"] });
  });

  it("labels roles in the usual order", () => {
    expect(rolesLabel(["billing", "orders"])).toBe("Orders, Billing");
    expect(rolesLabel([])).toBe("");
  });
});

type C = {
  id: string;
  name: string;
  parent_customer_id: string | null;
  bills_for_locations: boolean;
  contacts: { roles: string[] }[];
};

describe("billed through a parent", () => {
  const chain: C = {
    id: "p",
    name: "PCC",
    parent_customer_id: null,
    bills_for_locations: true,
    contacts: [{ roles: ["orders"] }, { roles: ["billing", "orders"] }],
  };
  const store: C = { id: "s", name: "Fremont", parent_customer_id: "p", bills_for_locations: false, contacts: [] };
  const byId = new Map([chain, store].map((c) => [c.id, c]));

  it("shows the parent and its billing contacts when the parent bills", () => {
    const b = billedThrough(store, byId);
    expect(b?.parent.name).toBe("PCC");
    expect(b?.contacts).toEqual([{ roles: ["billing", "orders"] }]);
  });

  it("is nothing when the parent doesn't bill, or there is no parent", () => {
    const off = new Map<string, C>([[chain.id, { ...chain, bills_for_locations: false }], [store.id, store]]);
    expect(billedThrough(store, off)).toBeNull();
    expect(billedThrough(chain, byId)).toBeNull();
  });
});

describe("deleting a customer", () => {
  it("is allowed only with nothing tied to it", () => {
    expect(deleteBlockers({ orders: 0, history: 0, cut_sheet_links: 0, locations: 0 })).toEqual([]);
    expect(deleteBlockers({ orders: 3, history: 1, cut_sheet_links: 0, locations: 2 })).toEqual([
      "2 locations",
      "3 orders",
      "1 history entry",
    ]);
    expect(deleteBlockers({ orders: 0, history: 0, cut_sheet_links: 1, locations: 0 })).toEqual(["1 cut sheet link"]);
  });
});
