import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { colName, sheetNames, xlsxFile } from "./xlsx";

describe("Excel files", () => {
  it("names columns like Excel", () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("keeps sheet names short, legal, and unique", () => {
    expect(sheetNames(["orders", "Orders", "a/b:c", "x".repeat(40), ""])).toEqual([
      "orders",
      "Orders 2",
      "a b c",
      "x".repeat(31),
      "Sheet",
    ]);
  });

  it("writes a workbook Excel can open: bold frozen header, numbers as numbers, text escaped", async () => {
    const bytes = await xlsxFile([
      { name: "Orders", header: ["Customer", "Qty"], rows: [["Abe's <Deli> & Co", 16.5], ["Key City", null]] },
      { name: "Second", header: ["A"], rows: [] },
    ]);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]),
    );
    const s1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(s1).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Customer</t></is></c>');
    expect(s1).toContain("Abe's &lt;Deli&gt; &amp; Co");
    expect(s1).toContain('<c r="B2"><v>16.5</v></c>');
    expect(s1).not.toContain('r="B3"'); // empty cells are left out
    expect(s1).toContain('state="frozen"');
    const wb = await zip.file("xl/workbook.xml")!.async("string");
    expect(wb).toContain('<sheet name="Orders" sheetId="1" r:id="rId1"/>');
  });
});
