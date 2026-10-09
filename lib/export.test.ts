import { describe, expect, it } from "vitest";
import { EXPORT_TABLES, exportReadme, toCsv, toSheet } from "./export";

describe("export all data", () => {
  it("writes CSV with quoting, blanks for nulls, and JSON for objects", () => {
    const csv = toCsv([
      { id: 1, name: 'Joe "the" Butcher', notes: null, data: { a: 1 } },
      { id: 2, name: "Plain", extra: "late column" },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "id,name,notes,data,extra",
      '1,"Joe ""the"" Butcher",,"{""a"":1}",',
      "2,Plain,,,late column",
      "",
    ]);
  });

  it("covers every table, with parents before the rows that point at them", () => {
    const names = EXPORT_TABLES.map((t) => t.table);
    expect(names).toHaveLength(25);
    expect(names.indexOf("customers")).toBeLessThan(names.indexOf("orders"));
    expect(names.indexOf("orders")).toBeLessThan(names.indexOf("order_lines"));
    expect(names.indexOf("cut_sheets")).toBeLessThan(names.indexOf("cut_sets"));
    expect(names.indexOf("half_whole_orders")).toBeLessThan(names.indexOf("freezer_log"));
  });

  it("explains itself", () => {
    expect(exportReadme("2026-10-05", [{ table: "parts", rows: 8 }])).toContain(" 1. parts.csv  (8 rows)");
  });
});

describe("Excel export", () => {
  it("turns rows into a sheet: numbers stay numbers, objects become JSON, booleans TRUE/FALSE", () => {
    const s = toSheet("parts", [
      { id: "leg", per_lamb: 2, confirmed: true, roles: ["orders"], note: null },
      { id: "neck", extra: "x" },
    ]);
    expect(s.header).toEqual(["id", "per_lamb", "confirmed", "roles", "note", "extra"]);
    expect(s.rows).toEqual([
      ["leg", 2, "TRUE", '["orders"]', null, null],
      ["neck", null, null, null, null, "x"],
    ]);
  });
});
