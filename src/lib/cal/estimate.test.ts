import { describe, expect, it } from "vitest";

import { parseEstimateResponse } from "@/lib/cal/estimateParser";

const BASE_ITEM = {
  mealName: "Apple Snack",
  category: "healthy_snack",
  calories: 95,
  proteinG: 1,
  carbsG: 25,
  fatG: 0,
  fiberG: 4,
  sodiumMg: 1,
  addedSugarG: 0,
  saturatedFatG: 0,
  reasoning: "Apple 95 cal",
  confidence: "high",
};

describe("food estimate response parsing", () => {
  it("wraps a single legacy object response in an array", () => {
    const result = parseEstimateResponse(JSON.stringify(BASE_ITEM));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      mealName: "Apple Snack",
      calories: 95,
    });
  });

  it("parses single-item array responses", () => {
    const result = parseEstimateResponse(JSON.stringify([BASE_ITEM]));

    expect(result).toHaveLength(1);
    expect(result[0].mealName).toBe("Apple Snack");
  });

  it("parses multi-meal array responses", () => {
    const result = parseEstimateResponse(
      JSON.stringify([
        { ...BASE_ITEM, mealName: "Egg Toast", calories: 310 },
        {
          ...BASE_ITEM,
          mealName: "Greek Salad",
          category: "meal",
          calories: 520,
          proteinG: 22,
        },
      ]),
    );

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.mealName)).toEqual([
      "Egg Toast",
      "Greek Salad",
    ]);
  });

  it("keeps composite dishes as one parsed item when returned that way", () => {
    const result = parseEstimateResponse(
      JSON.stringify([
        {
          ...BASE_ITEM,
          mealName: "Chipotle Bowl",
          category: "meal",
          calories: 760,
          reasoning: "Chicken bowl with rice, beans, salsa, and guac 760 cal",
        },
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      mealName: "Chipotle Bowl",
      calories: 760,
    });
  });
});
