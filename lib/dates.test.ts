import { describe, expect, it } from "vitest";
import { addDays, ago, currentWeek, longDate, mondayOf, niceDate, todayISO, todayName } from "./dates";

describe("dates", () => {
  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-10-05")).toBe("2026-10-05"); // Monday
    expect(mondayOf("2026-10-07")).toBe("2026-10-05"); // Wednesday
    expect(mondayOf("2026-10-11")).toBe("2026-10-05"); // Sunday belongs to the week before
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
  });

  it("uses Pacific time for today", () => {
    // 11 PM Pacific on Sunday Oct 4 is already Monday in UTC.
    const lateSunday = new Date("2026-10-05T06:00:00Z");
    expect(todayISO(lateSunday)).toBe("2026-10-04");
    expect(todayName(lateSunday)).toBe("Sunday");
    expect(currentWeek(lateSunday)).toBe("2026-09-28");
  });

  it("adds days across months", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDays("2026-10-05", -7)).toBe("2026-09-28");
  });

  it("formats dates the way the prototype does", () => {
    expect(niceDate("2026-10-19")).toBe("Oct 19");
    expect(longDate("2026-10-21")).toBe("Wednesday, Oct 21");
  });

  it("says how long ago", () => {
    const now = new Date("2026-10-05T18:00:00Z");
    expect(ago("2026-10-05T16:00:00Z", now)).toBe("today");
    expect(ago("2026-10-04T18:00:00Z", now)).toBe("yesterday");
    expect(ago("2026-09-30T18:00:00Z", now)).toBe("5 days ago");
    expect(ago("2026-09-01T18:00:00Z", now)).toBe("Sep 1");
  });
});
