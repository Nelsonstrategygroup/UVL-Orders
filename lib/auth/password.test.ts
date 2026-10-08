import { describe, expect, it } from "vitest";
import { isFreshResetSession, newPasswordProblem } from "./password";

describe("new password", () => {
  it("needs 8 characters, typed the same twice", () => {
    expect(newPasswordProblem("short", "short")).toMatch(/at least 8/);
    expect(newPasswordProblem("long enough", "long enougH")).toMatch(/don't match/);
    expect(newPasswordProblem("long enough", "long enough")).toBeNull();
  });
});

describe("reset link sessions", () => {
  const now = Date.UTC(2026, 9, 7, 18, 0, 0);
  const at = (minutesAgo: number) => (now - minutesAgo * 60_000) / 1000;

  it("a session from a reset link in the last hour may skip the old password", () => {
    expect(isFreshResetSession([{ method: "otp", timestamp: at(5) }], now)).toBe(true);
    expect(isFreshResetSession([{ method: "recovery", timestamp: at(59) }], now)).toBe(true);
  });

  it("an older reset session, or any password login, must give the old password", () => {
    expect(isFreshResetSession([{ method: "otp", timestamp: at(61) }], now)).toBe(false);
    expect(isFreshResetSession([{ method: "password", timestamp: at(1) }], now)).toBe(false);
    expect(
      isFreshResetSession(
        [
          { method: "otp", timestamp: at(1) },
          { method: "password", timestamp: at(30) },
        ],
        now,
      ),
    ).toBe(false);
    expect(isFreshResetSession(undefined, now)).toBe(false);
    expect(isFreshResetSession([], now)).toBe(false);
  });
});
