import { describe, expect, it } from "vitest";
import { groupLead, isTogether, onOrderAs, packedWith } from "./packTogether";

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
