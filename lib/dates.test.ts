import { describe, expect, it } from "vitest";
import { addDays, ago, currentWeek, longDate, mondayOf, niceDate, packingMonday, todayISO, todayName, weekDays, weekName } from "./dates";

describe("the order week: Thursday through Wednesday, named by its packing Monday", () => {
  it("Thursday to Sunday look ahead to the coming Monday", () => {
    expect(packingMonday("2026-10-22")).toBe("2026-10-26"); // Thursday: orders day
    expect(packingMonday("2026-10-23")).toBe("2026-10-26"); // Friday
    expect(packingMonday("2026-10-24")).toBe("2026-10-26"); // Saturday
    expect(packingMonday("2026-10-25")).toBe("2026-10-26"); // Sunday
  });

  it("Monday to Wednesday belong to that Monday", () => {
    expect(packingMonday("2026-10-26")).toBe("2026-10-26"); // Monday: Mohawk processes, staff pack
    expect(packingMonday("2026-10-27")).toBe("2026-10-26"); // Tuesday: invoices, may ship
    expect(packingMonday("2026-10-28")).toBe("2026-10-26"); // Wednesday: last day of the week
    expect(packingMonday("2026-10-29")).toBe("2026-11-02"); // next Thursday starts the next week
  });

  it("works across months and years", () => {
    expect(packingMonday("2026-12-31")).toBe("2027-01-04"); // Thursday
    expect(packingMonday("2026-09-30")).toBe("2026-09-28"); // Wednesday
  });

  it("lists the week's days and names it", () => {
    expect(weekDays("2026-10-26")).toEqual(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]);
    expect(weekName("2026-10-26")).toBe("Mon Oct 26");
  });

  it("orders taken Thursday and packed Monday are the same week", () => {
    const thursday = new Date("2026-10-22T17:00:00Z"); // 10 AM Pacific
    const monday = new Date("2026-10-26T15:00:00Z"); // 8 AM Pacific
    expect(currentWeek(thursday)).toBe(currentWeek(monday));
  });
});

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
    // Sunday belongs to the order week that packs the next day.
    expect(currentWeek(lateSunday)).toBe("2026-10-05");
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
