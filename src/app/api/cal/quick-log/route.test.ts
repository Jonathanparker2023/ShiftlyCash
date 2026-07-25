import { describe, expect, it } from "vitest";

import { matchSavedFood, parseServings } from "./route";

const food = (id: string, name: string) =>
  ({
    id,
    name,
    category: "meal",
    calories: 650,
    protein_g: 42,
    carbs_g: null,
    fat_g: null,
    fiber_g: 9,
    sodium_mg: null,
    added_sugar_g: null,
    saturated_fat_g: null,
  }) as Parameters<typeof matchSavedFood>[0][number];

const foods = [
  food("00000000-0000-4000-8000-000000000001", "Harissa Steak Bowl"),
  food("00000000-0000-4000-8000-000000000002", "Longhorn Steak Plate"),
  food("00000000-0000-4000-8000-000000000003", "Clear Protein Hit"),
];

describe("matchSavedFood", () => {
  it("matches an exact id", () => {
    const res = matchSavedFood(foods, "00000000-0000-4000-8000-000000000002");
    expect(res).toMatchObject({ kind: "one" });
    expect(res.kind === "one" && res.food.name).toBe("Longhorn Steak Plate");
  });

  it("matches an exact name regardless of case and padding", () => {
    const res = matchSavedFood(foods, "  harissa steak bowl ");
    expect(res.kind === "one" && res.food.name).toBe("Harissa Steak Bowl");
  });

  it("matches a unique substring", () => {
    const res = matchSavedFood(foods, "harissa");
    expect(res.kind === "one" && res.food.name).toBe("Harissa Steak Bowl");
  });

  it("refuses to guess when a substring hits more than one food", () => {
    // "steak" hits both bowls — logging the wrong meal silently is worse than
    // not logging it, so the caller has to disambiguate.
    const res = matchSavedFood(foods, "steak");
    expect(res.kind).toBe("ambiguous");
    expect(res.kind === "ambiguous" && res.candidates).toHaveLength(2);
  });

  it("reports no match rather than falling back to the first food", () => {
    expect(matchSavedFood(foods, "pancakes").kind).toBe("none");
    expect(matchSavedFood(foods, "   ").kind).toBe("none");
  });
});

describe("parseServings", () => {
  it("defaults to one when omitted", () => {
    expect(parseServings(undefined)).toBe(1);
    expect(parseServings(null)).toBe(1);
    expect(parseServings("")).toBe(1);
  });

  it("accepts numbers and numeric strings, including fractions", () => {
    expect(parseServings(2)).toBe(2);
    expect(parseServings("1.5")).toBe(1.5);
  });

  it("rejects zero, negatives, and nonsense", () => {
    expect(parseServings(0)).toBeNull();
    expect(parseServings(-1)).toBeNull();
    expect(parseServings("half")).toBeNull();
  });
});
