import { describe, expect, it } from "vitest";
import { mostRecentCutoff, needsDailyLogin, zonedTimeToUtc } from "./session";

describe("zonedTimeToUtc", () => {
  it("handles daylight time (PDT, UTC-7)", () => {
    expect(zonedTimeToUtc(2026, 10, 1, 3).toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });
  it("handles standard time (PST, UTC-8)", () => {
    expect(zonedTimeToUtc(2026, 12, 15, 3).toISOString()).toBe("2026-12-15T11:00:00.000Z");
  });
  it("handles the spring-forward morning", () => {
    // DST starts 2026-03-08 at 2:00 AM; 3:00 AM that day is PDT.
    expect(zonedTimeToUtc(2026, 3, 8, 3).toISOString()).toBe("2026-03-08T10:00:00.000Z");
  });
  it("handles the fall-back morning", () => {
    // DST ends 2026-11-01 at 2:00 AM; 3:00 AM that day is PST.
    expect(zonedTimeToUtc(2026, 11, 1, 3).toISOString()).toBe("2026-11-01T11:00:00.000Z");
  });
});

describe("mostRecentCutoff", () => {
  it("is this morning at 3 AM during the day", () => {
    // 2:30 PM Pacific on Oct 1
    expect(mostRecentCutoff(new Date("2026-10-01T21:30:00Z")).toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });
  it("is yesterday at 3 AM when it is late at night", () => {
    // 11:30 PM Pacific on Oct 1 (06:30 UTC Oct 2)
    expect(mostRecentCutoff(new Date("2026-10-02T06:30:00Z")).toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });
  it("is yesterday at 3 AM just before 3 AM", () => {
    // 2:59 AM Pacific on Oct 2
    expect(mostRecentCutoff(new Date("2026-10-02T09:59:00Z")).toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });
  it("moves to today at exactly 3 AM", () => {
    expect(mostRecentCutoff(new Date("2026-10-02T10:00:00Z")).toISOString()).toBe("2026-10-02T10:00:00.000Z");
  });
  it("crosses a month boundary", () => {
    // 1:00 AM Pacific on Nov 1 (still PDT)
    expect(mostRecentCutoff(new Date("2026-11-01T08:00:00Z")).toISOString()).toBe("2026-10-31T10:00:00.000Z");
  });
});

describe("needsDailyLogin", () => {
  const morning = new Date("2026-10-01T14:00:00Z"); // 7 AM Pacific

  it("keeps someone who logged in earlier today", () => {
    expect(needsDailyLogin("2026-10-01T13:00:00Z", morning)).toBe(false); // 6 AM
  });
  it("keeps someone logged in late last night until 3 AM", () => {
    const lateNight = new Date("2026-10-02T08:00:00Z"); // 1 AM Pacific Oct 2
    expect(needsDailyLogin("2026-10-02T04:00:00Z", lateNight)).toBe(false); // 9 PM Oct 1
  });
  it("signs out someone who logged in yesterday", () => {
    expect(needsDailyLogin("2026-09-30T22:00:00Z", morning)).toBe(true); // 3 PM Sep 30
  });
  it("signs out someone who logged in just before 3 AM today", () => {
    expect(needsDailyLogin("2026-10-01T09:59:00Z", morning)).toBe(true); // 2:59 AM
  });
  it("signs out when there is no recorded login", () => {
    expect(needsDailyLogin(null, morning)).toBe(true);
  });
});
