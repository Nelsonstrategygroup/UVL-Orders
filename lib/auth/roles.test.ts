import { describe, expect, it } from "vitest";
import { canOpen, homeFor, navFor } from "./roles";

describe("roles", () => {
  it("gives packing only the Packing screen, with no navigation", () => {
    expect(navFor("packing")).toEqual([]);
    expect(homeFor("packing")).toBe("/packing");
    expect(canOpen("packing", "/packing")).toBe(true);
    expect(canOpen("packing", "/calls")).toBe(false);
    expect(canOpen("packing", "/users")).toBe(false);
    expect(canOpen("packing", "/packingx")).toBe(false);
    // Everyone can change their own password and read the help.
    expect(canOpen("packing", "/password")).toBe(true);
    expect(canOpen("packing", "/passwordx")).toBe(false);
    expect(canOpen("packing", "/help")).toBe(true);
  });

  it("hides Users from office", () => {
    expect(navFor("office").some((n) => n.href === "/users")).toBe(false);
    expect(canOpen("office", "/users")).toBe(false);
    expect(canOpen("office", "/cut-sheet")).toBe(true);
  });

  it("shows Users to admin", () => {
    expect(navFor("admin").some((n) => n.href === "/users")).toBe(true);
    expect(canOpen("admin", "/users")).toBe(true);
  });
});
