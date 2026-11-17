import { describe, expect, it } from "vitest";
import { ALL_ACCESS, can, canOpen, effectivePerms, homeFor, navFor, NO_ACCESS, onlyPacking, permsFrom, tabFor, type Perms } from "./roles";

const packing: Perms = { ...NO_ACCESS, packing: 2 };
// The role defaults as of 11/17/26 (migration 20261122000100).
const lead: Perms = {
  ...NO_ACCESS,
  week: 2,
  calls: 2,
  orders: 2,
  cutsheet: 2,
  packing: 2,
  freezer: 2,
  customers: 2,
  callnotes: 2,
  halfwhole: 2,
  setup: 2,
  downloads: 1,
  trucks: 2,
};
const accountant: Perms = { ...NO_ACCESS, orders: 1, downloads: 1, pnl: 1, carcass: 1, invoices: 2, trucks: 2 };
const viewer: Perms = { ...permsFrom(Object.fromEntries(Object.keys(NO_ACCESS).map((a) => [a, 1]))), setup: 0, invoices: 0, prices: 0, pnl: 0, carcass: 0 };
const tabs = (p: Perms, role: Parameters<typeof navFor>[1]) => navFor(p, role).map((n) => `${n.label}: ${n.sections.map((s) => s.label).join(", ")}`);

describe("the six tabs (Lucas, 11/17/26)", () => {
  it("gives an admin all six, in order, each with its sections", () => {
    expect(tabs(ALL_ACCESS, "admin")).toEqual([
      "This week: This week, Cut sheet",
      "Sales: Calls, Customers, Half and whole",
      "Orders: Orders",
      "Packing: Packing, Freezer",
      "Office: Invoices, Weekly P&L, Carcass weights, Truck runs",
      "Setup: Setup, Users",
    ]);
    expect(homeFor(ALL_ACCESS, "admin")).toBe("/week");
    expect(navFor(ALL_ACCESS, "admin").find((n) => n.key === "sales")!.href).toBe("/calls");
  });

  it("phone bar: This week, Orders, Packing (and Print); the rest under More", () => {
    const nav = navFor(ALL_ACCESS, "admin");
    expect(nav.filter((n) => n.bottom).map((n) => n.short)).toEqual(["Week", "Orders", "Packing"]);
    expect(nav.filter((n) => !n.bottom).map((n) => n.label)).toEqual(["Sales", "Office", "Setup"]);
  });

  it("gives an operations lead the week, sales, orders, packing, trucks and operations setup; no money screens", () => {
    expect(tabs(lead, "office")).toEqual([
      "This week: This week, Cut sheet",
      "Sales: Calls, Customers, Half and whole",
      "Orders: Orders",
      "Packing: Packing, Freezer",
      "Office: Truck runs",
      "Setup: Setup",
    ]);
    for (const p of ["/pnl", "/pnl/entries", "/carcass-weights", "/weigh-sheets/abc", "/users", "/setup/lamb-cost", "/setup/records", "/invoices", "/setup/prices"])
      expect(canOpen(lead, "office", p), p).toBe(false);
    for (const p of ["/setup/products", "/setup/parts", "/setup/boxes", "/cut-sheet", "/freezer", "/print"]) expect(canOpen(lead, "office", p), p).toBe(true);
    expect(can(lead, "setup", "change")).toBe(true);
  });

  it("gives an accountant orders, print, invoices, the P&L, carcass weights and truck runs; nothing operational", () => {
    expect(tabs(accountant, "billing")).toEqual(["Orders: Orders", "Office: Invoices, Weekly P&L, Carcass weights, Truck runs", "Setup: Setup"]);
    for (const p of ["/pnl", "/pnl/detail", "/carcass-weights/abc", "/print", "/invoices/x", "/setup/invoicing"]) expect(canOpen(accountant, "billing", p), p).toBe(true);
    for (const p of ["/half-whole", "/customers", "/customers/abc", "/calls", "/week", "/packing", "/freezer", "/setup/products", "/setup/prices", "/pnl/activity", "/users"])
      expect(canOpen(accountant, "billing", p), p).toBe(false);
    expect(can(accountant, "orders", "change")).toBe(false);
    expect(homeFor(accountant, "billing")).toBe("/orders");
  });

  it("gives a plain packer only the Packing screen, with no navigation", () => {
    expect(navFor(packing, "packing").map((n) => n.href)).toEqual(["/packing"]);
    expect(onlyPacking(packing, "packing")).toBe(true);
    expect(homeFor(packing, "packing")).toBe("/packing");
    for (const p of ["/calls", "/users", "/pnl", "/invoices", "/half-whole", "/print"]) expect(canOpen(packing, "packing", p), p).toBe(false);
    expect(canOpen(packing, "packing", "/packingx")).toBe(true); // not a screen; the page itself 404s
    // Everyone can change their own password, read the help, and see the no-access page.
    for (const p of ["/password", "/help", "/no-access"]) expect(canOpen(packing, "packing", p)).toBe(true);
  });

  it("lets a packer with overrides see orders and the cut sheet too", () => {
    const withMore: Perms = { ...packing, orders: 1, cutsheet: 1 };
    expect(navFor(withMore, "packing").map((n) => n.href)).toEqual(["/cut-sheet", "/orders", "/packing"]);
    expect(onlyPacking(withMore, "packing")).toBe(false);
    expect(canOpen(withMore, "packing", "/cut-sheet")).toBe(true);
    expect(canOpen(withMore, "packing", "/week")).toBe(false);
  });

  it("shows a viewer everything but Setup, Users and the money screens", () => {
    const keys = navFor(viewer, "viewer").map((n) => n.key);
    expect(keys).toEqual(["week", "sales", "orders", "packing", "office"]);
    expect(navFor(viewer, "viewer").find((n) => n.key === "office")!.sections.map((s) => s.label)).toEqual(["Truck runs"]);
    expect(canOpen(viewer, "viewer", "/setup")).toBe(false);
  });

  it("keeps every old address working, under its new tab", () => {
    expect(tabFor("/cut-sheet")).toBe("week");
    expect(tabFor("/calls")).toBe("sales");
    expect(tabFor("/freezer")).toBe("packing");
    expect(tabFor("/pnl/entries")).toBe("office");
    expect(tabFor("/weigh-sheets/abc")).toBe("office");
    expect(tabFor("/users")).toBe("setup");
    expect(canOpen(ALL_ACCESS, "admin", "/downloads")).toBe(true);
    expect(canOpen(accountant, "billing", "/downloads")).toBe(true);
  });

  it("reads permissions from the database safely", () => {
    expect(permsFrom({ orders: 2, calls: "1", setup: 7, pnl: 1 })).toMatchObject({ orders: 2, calls: 1, setup: 0, packing: 0, pnl: 1 });
    expect(permsFrom(null)).toEqual(NO_ACCESS);
  });
});

describe("effective access", () => {
  const defaults = { office: lead, packing, viewer, billing: accountant };
  it("uses the role default unless the person has their own setting", () => {
    expect(effectivePerms("packing", defaults, {}).orders).toBe(0);
    expect(effectivePerms("packing", defaults, { orders: 1, cutsheet: 1 })).toMatchObject({ orders: 1, cutsheet: 1, packing: 2 });
    expect(effectivePerms("office", defaults, { calls: 0 }).calls).toBe(0);
    expect(effectivePerms("billing", defaults, { prices: 2 })).toMatchObject({ prices: 2, invoices: 2, pnl: 1 });
  });
  it("lets Operations setup be changed, keeps Print at View, and gives admins everything", () => {
    expect(effectivePerms("office", defaults, { setup: 2, downloads: 2 })).toMatchObject({ setup: 2, downloads: 1 });
    expect(effectivePerms("admin", defaults, { orders: 0 }).orders).toBe(2);
  });
});
