import { describe, expect, it } from "vitest";
import { ALL_ACCESS, can, canOpen, effectivePerms, homeFor, navFor, NO_ACCESS, onlyPacking, permsFrom, type Perms } from "./roles";

const packing: Perms = { ...NO_ACCESS, packing: 2 };
const office: Perms = { ...ALL_ACCESS, downloads: 1, setup: 1 };
const viewer: Perms = { ...permsFrom(Object.fromEntries(Object.keys(NO_ACCESS).map((a) => [a, 1]))), setup: 0 };

describe("screens by permission", () => {
  it("gives a plain packer only the Packing screen, with no navigation", () => {
    expect(navFor(packing, "packing").map((n) => n.href)).toEqual(["/packing"]);
    expect(onlyPacking(packing, "packing")).toBe(true);
    expect(homeFor(packing, "packing")).toBe("/packing");
    expect(canOpen(packing, "packing", "/packing")).toBe(true);
    expect(canOpen(packing, "packing", "/calls")).toBe(false);
    expect(canOpen(packing, "packing", "/users")).toBe(false);
    expect(canOpen(packing, "packing", "/packingx")).toBe(true); // not a screen; the page itself 404s
    // Everyone can change their own password and read the help.
    expect(canOpen(packing, "packing", "/password")).toBe(true);
    expect(canOpen(packing, "packing", "/help")).toBe(true);
  });

  it("lets a packer with overrides see orders and the cut sheet too", () => {
    const lead: Perms = { ...packing, orders: 1, cutsheet: 1 };
    expect(navFor(lead, "packing").map((n) => n.href)).toEqual(["/orders", "/cut-sheet", "/packing"]);
    expect(onlyPacking(lead, "packing")).toBe(false);
    expect(canOpen(lead, "packing", "/cut-sheet")).toBe(true);
    expect(can(lead, "cutsheet", "view")).toBe(true);
    expect(can(lead, "cutsheet", "change")).toBe(false);
  });

  it("hides Users and the import from everyone but admins", () => {
    expect(navFor(office, "office").some((n) => n.href === "/users")).toBe(false);
    expect(canOpen(office, "office", "/users")).toBe(false);
    expect(canOpen(office, "office", "/customers/import")).toBe(false);
    expect(canOpen(office, "office", "/cut-sheet")).toBe(true);
    expect(navFor(ALL_ACCESS, "admin").some((n) => n.href === "/users")).toBe(true);
    expect(canOpen(ALL_ACCESS, "admin", "/users")).toBe(true);
    expect(homeFor(ALL_ACCESS, "admin")).toBe("/calls");
  });

  it("shows a viewer everything but Setup and Users", () => {
    const hrefs = navFor(viewer, "viewer").map((n) => n.href);
    expect(hrefs).not.toContain("/setup");
    expect(hrefs).not.toContain("/users");
    expect(hrefs).toContain("/cut-sheet");
    expect(canOpen(viewer, "viewer", "/setup")).toBe(false);
  });

  it("reads permissions from the database safely", () => {
    expect(permsFrom({ orders: 2, calls: "1", setup: 7 })).toMatchObject({ orders: 2, calls: 1, setup: 0, packing: 0 });
    expect(permsFrom(null)).toEqual(NO_ACCESS);
  });
});

describe("effective access", () => {
  const defaults = {
    office: { ...ALL_ACCESS, downloads: 1, setup: 1 } as Perms,
    packing: { ...NO_ACCESS, packing: 2 } as Perms,
    viewer: { ...NO_ACCESS, orders: 1 } as Perms,
  };
  it("uses the role default unless the person has their own setting", () => {
    expect(effectivePerms("packing", defaults, {}).orders).toBe(0);
    expect(effectivePerms("packing", defaults, { orders: 1, cutsheet: 1 })).toMatchObject({ orders: 1, cutsheet: 1, packing: 2 });
    expect(effectivePerms("office", defaults, { calls: 0 }).calls).toBe(0);
  });
  it("never gives a non-admin Setup or Downloads change, and admins everything", () => {
    expect(effectivePerms("office", defaults, { setup: 2, downloads: 2 })).toMatchObject({ setup: 1, downloads: 1 });
    expect(effectivePerms("admin", defaults, { orders: 0 }).orders).toBe(2);
  });
});
