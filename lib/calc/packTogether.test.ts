import { describe, expect, it } from "vitest";
import { boxName, groupLead, groupShort, isTogether, onOrderAs, packedWith } from "./packTogether";

const products = [
  { id: "kidney", sort: 3, packed_with: "Organs" },
  { id: "heart", sort: 1, packed_with: "Organs " },
  { id: "liver", sort: 2, packed_with: "Organs" },
  { id: "chops", sort: 0, packed_with: "" },
  { id: "old", sort: 5 },
];

describe("products packed together", () => {
  it("finds the whole group, in sort order", () => {
    expect(packedWith("kidney", products)).toEqual(["heart", "liver", "kidney"]);
    expect(packedWith("chops", products)).toEqual(["chops"]);
    expect(packedWith("old", products)).toEqual(["old"]);
    expect(isTogether("liver", products)).toBe(true);
    expect(isTogether("chops", products)).toBe(false);
  });
  it("bills a group under its first product", () => {
    expect(groupLead("kidney", products)).toBe("heart");
    expect(groupLead("chops", products)).toBe("chops");
  });
  it("counts a box of one as on the order when another of the group was ordered", () => {
    expect(onOrderAs("kidney", { heart: 2, liver: 5 }, products)).toBe("heart");
    expect(onOrderAs("kidney", { kidney: 1, heart: 2 }, products)).toBe("kidney");
    expect(onOrderAs("kidney", { chops: 10 }, products)).toBeNull();
    expect(onOrderAs("chops", { heart: 2 }, products)).toBeNull();
  });
});

describe("what a box is called (11/10/26)", () => {
  const named = [
    { id: "kidney", name: "Kidney", sort: 3, packed_with: "HLK" },
    { id: "heart", name: "Heart", sort: 1, packed_with: "HLK" },
    { id: "liver", name: "Liver", sort: 2, packed_with: "HLK" },
    { id: "chops", name: "Chops 4 pk", sort: 0, packed_with: "" },
  ];
  it("packed in one box: the ones this store ordered, whichever product the barcode is", () => {
    expect(boxName("kidney", named, { heart: 3, liver: 3, kidney: 3 })).toBe("Heart / Liver / Kidney");
    // Bellevue: 12 livers, 8 kidneys, no hearts.
    expect(boxName("kidney", named, { liver: 12, kidney: 8 })).toBe("Liver / Kidney");
    expect(boxName("kidney", named, { liver: 4 })).toBe("Liver");
  });
  it("all of them when the order isn't known, or has none of them", () => {
    expect(boxName("kidney", named)).toBe("Heart / Liver / Kidney");
    expect(boxName("kidney", named, { chops: 2 })).toBe("Heart / Liver / Kidney");
  });
  it("a product packed on its own keeps its name", () => {
    expect(boxName("chops", named, { chops: 2 })).toBe("Chops 4 pk");
    expect(groupShort("chops", named)).toBe("");
    expect(groupShort("liver", named)).toBe("HLK");
  });
});
