import { describe, expect, it } from "vitest";
import { blockedReason, byName, type UserLite } from "./userRules";

const u = (id: string, role: UserLite["role"], extra: Partial<UserLite> = {}): UserLite => ({
  id,
  role,
  active: true,
  lastLoginAt: "2026-10-01T16:00:00Z",
  ...extra,
});

describe("user rules", () => {
  const me = u("me", "admin");
  const eric = u("eric", "admin");
  const kathy = u("kathy", "office");
  const newbie = u("new", "packing", { lastLoginAt: null });

  it("never lets you turn off, delete, or change your own login", () => {
    const all = [me, eric];
    expect(blockedReason("turnOff", me, all, "me")).toMatch(/own login/);
    expect(blockedReason("delete", { ...me, lastLoginAt: null }, all, "me")).toMatch(/own login/);
    expect(blockedReason("changeRole", me, all, "me", "office")).toMatch(/own role/);
  });

  it("protects the last active admin", () => {
    // Eric is the only active admin; "me" is (somehow) not counted.
    const all = [{ ...me, active: false }, eric, kathy];
    expect(blockedReason("turnOff", eric, all, "me")).toMatch(/only admin/);
    expect(blockedReason("changeRole", eric, all, "me", "office")).toMatch(/only admin/);
    expect(blockedReason("changeRole", eric, all, "me", "admin")).toBeNull();
    expect(blockedReason("delete", { ...eric, lastLoginAt: null }, all, "me")).toMatch(/only admin/);
  });

  it("allows changes to another admin while two are active", () => {
    const all = [me, eric, kathy];
    expect(blockedReason("turnOff", eric, all, "me")).toBeNull();
    expect(blockedReason("changeRole", eric, all, "me", "office")).toBeNull();
  });

  it("deletes and fixes the email only for people who never logged in", () => {
    const all = [me, kathy, newbie];
    expect(blockedReason("delete", kathy, all, "me")).toMatch(/turned off/);
    expect(blockedReason("delete", newbie, all, "me")).toBeNull();
    expect(blockedReason("changeEmail", kathy, all, "me")).toMatch(/can't be changed/);
    expect(blockedReason("changeEmail", newbie, all, "me")).toBeNull();
  });

  it("sorts by name", () => {
    expect(
      byName([
        { name: "kathy", email: "" },
        { name: "", email: "b@x.com" },
        { name: "Chris", email: "" },
      ]).map((x) => x.name || x.email),
    ).toEqual(["b@x.com", "Chris", "kathy"]);
  });
});
