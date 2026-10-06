import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { importPayload, planImport } from "./customers";

const HEADER = "name,type,call_day,parent,contact_name,contact_role,phone,email,notes";

describe("parseCsv", () => {
  it("handles quotes, commas, newlines in quotes, and Excel's BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"Smith, Jane","line 1\nline 2"\r\n"say ""hi""",\r\n\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["Smith, Jane", "line 1\nline 2"],
      ['say "hi"', ""],
    ]);
  });
});

describe("planImport", () => {
  it("builds customers, merges extra contact rows, and finds new parents", () => {
    const csv = [
      HEADER,
      "Fremont,retail,mon,PCC Community Markets,Sam Lee,Receiving,206-555-0101,,Deliver before 10",
      "Fremont,,,PCC Community Markets,Ana Diaz,Orders,206-555-0102,ana@example.com,",
      "Ballard,Retail,Tuesday,PCC Community Markets,,,,,",
      "Joe's Diner,Restaurant,Fri.,,Joe,,541-555-0199,,",
    ].join("\n");
    const plan = planImport(csv, []);
    expect(plan.errors).toEqual([]);
    expect(plan.newParents).toEqual(["PCC Community Markets"]);
    expect(plan.customers).toHaveLength(3);

    const fremont = plan.customers[0];
    expect(fremont).toMatchObject({ name: "Fremont", type: "Retail", call_day: "Monday", parent: "PCC Community Markets" });
    expect(fremont.contacts.map((k) => k.name)).toEqual(["Sam Lee", "Ana Diaz"]);
    expect(fremont.contacts.map((k) => k.roles)).toEqual([["receiving"], ["orders"]]);
    expect(fremont.notes).toBe("Deliver before 10");
    expect(plan.customers[2]).toMatchObject({ name: "Joe's Diner", call_day: "Friday", parent: "" });
  });

  it("skips customers already in the app", () => {
    const csv = [HEADER, "Fremont,Retail,,PCC,,,,,", "New Shop,Retail,,,,,,,"].join("\n");
    const plan = planImport(csv, [
      { name: "PCC", parentName: null },
      { name: "fremont", parentName: "pcc" },
    ]);
    expect(plan.customers.map((c) => c.status)).toEqual(["exists", "new"]);
    expect(plan.newParents).toEqual([]); // PCC already exists
    expect(importPayload(plan).map((c) => c.name)).toEqual(["New Shop"]);
  });

  it("warns about unknown types and days instead of failing", () => {
    const plan = planImport([HEADER, "Shop,Grocery,Someday,,,,,,"].join("\n"), []);
    expect(plan.customers[0]).toMatchObject({ type: "Other", call_day: null });
    expect(plan.customers[0].warnings).toHaveLength(2);
  });

  it("reads several contact roles separated by semicolons", () => {
    const plan = planImport([HEADER, "Shop,Retail,,,Pat,orders; Billing,,,", "Shop,,,,Lee,boss;receiving,,,"].join("\n"), []);
    expect(plan.customers[0].contacts.map((k) => k.roles)).toEqual([["orders", "billing"], ["receiving"]]);
    expect(plan.customers[0].warnings).toEqual([
      `Row 3: role "boss" isn't orders, receiving, or billing. It will be left off.`,
    ]);
    expect(importPayload(plan)[0].contacts[0]).toEqual({ name: "Pat", roles: ["orders", "billing"], phone: "", email: "" });
  });

  it("does not create a parent that is also in the file", () => {
    const plan = planImport([HEADER, "PCC,Retail,,,,,,,", "Fremont,Retail,,PCC,,,,,"].join("\n"), []);
    expect(plan.newParents).toEqual([]);
  });

  it("explains a missing name column", () => {
    const plan = planImport("Business,Phone\nShop,555", []);
    expect(plan.errors[0]).toMatch(/no "name" column/);
  });
});
