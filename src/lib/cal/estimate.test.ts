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
    expect(result[0].components).toEqual([]);
  });

  it("re-sums macros from components when 2+ components are present (Oikos+chia regression)", () => {
    // Simulates the production bug: LLM lists both yogurt and chia in
    // components, but its top-level macros only reflect the yogurt.
    // Parser must overwrite top-level with the component sum.
    const result = parseEstimateResponse(
      JSON.stringify([
        {
          mealName: "Oikos Chia Combo",
          category: "healthy_snack",
          calories: 180,
          proteinG: 30,
          carbsG: 14,
          fatG: 0,
          fiberG: 0,
          sodiumMg: 120,
          addedSugarG: 0,
          saturatedFatG: 0,
          reasoning: "• Oikos yogurt 180 cal\n• Chia seeds 120 cal",
          confidence: "high",
          components: [
            {
              name: "Oikos Triple Zero yogurt (2)",
              calories: 180,
              proteinG: 30,
              carbsG: 14,
              fatG: 0,
              fiberG: 0,
              sodiumMg: 120,
              addedSugarG: 0,
              saturatedFatG: 0,
            },
            {
              name: "Chia seeds (2 tbsp)",
              calories: 120,
              proteinG: 6,
              carbsG: 2,
              fatG: 7,
              fiberG: 8,
              sodiumMg: 0,
              addedSugarG: 0,
              saturatedFatG: 1,
            },
          ],
        },
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      mealName: "Oikos Chia Combo",
      calories: 300,
      proteinG: 36,
      carbsG: 16,
      fatG: 7,
      fiberG: 8,
      sodiumMg: 120,
      addedSugarG: 0,
      saturatedFatG: 1,
    });
    expect(result[0].components).toHaveLength(2);
  });

  it("leaves top-level macros unchanged when components has exactly 1 entry", () => {
    const result = parseEstimateResponse(
      JSON.stringify([
        {
          ...BASE_ITEM,
          components: [
            {
              name: "Medium apple",
              calories: 95,
              proteinG: 1,
              carbsG: 25,
              fatG: 0,
              fiberG: 4,
              sodiumMg: 1,
              addedSugarG: 0,
              saturatedFatG: 0,
            },
          ],
        },
      ]),
    );

    expect(result[0]).toMatchObject({
      mealName: "Apple Snack",
      calories: 95,
      proteinG: 1,
      carbsG: 25,
    });
  });

  it("leaves top-level macros unchanged when components field is missing", () => {
    const result = parseEstimateResponse(JSON.stringify(BASE_ITEM));

    expect(result[0]).toMatchObject({
      calories: 95,
      proteinG: 1,
      carbsG: 25,
    });
    expect(result[0].components).toEqual([]);
  });

  it("returns null for a macro when every component reports null for it", () => {
    const result = parseEstimateResponse(
      JSON.stringify([
        {
          ...BASE_ITEM,
          mealName: "Vague Combo",
          calories: 200,
          sodiumMg: null,
          components: [
            {
              name: "Item A",
              calories: 100,
              proteinG: 5,
              carbsG: null,
              fatG: null,
              fiberG: null,
              sodiumMg: null,
              addedSugarG: null,
              saturatedFatG: null,
            },
            {
              name: "Item B",
              calories: 100,
              proteinG: 5,
              carbsG: null,
              fatG: null,
              fiberG: null,
              sodiumMg: null,
              addedSugarG: null,
              saturatedFatG: null,
            },
          ],
        },
      ]),
    );

    expect(result[0].calories).toBe(200);
    expect(result[0].proteinG).toBe(10);
    expect(result[0].carbsG).toBeNull();
    expect(result[0].sodiumMg).toBeNull();
  });

  it("treats null components as 0 in sum when at least one component has a value", () => {
    const result = parseEstimateResponse(
      JSON.stringify([
        {
          ...BASE_ITEM,
          mealName: "Mixed Confidence",
          calories: 200,
          components: [
            {
              name: "Item A",
              calories: 100,
              proteinG: 10,
              carbsG: 5,
              fatG: 2,
              fiberG: 1,
              sodiumMg: 100,
              addedSugarG: 0,
              saturatedFatG: 0,
            },
            {
              name: "Item B",
              calories: 100,
              proteinG: null,
              carbsG: null,
              fatG: null,
              fiberG: null,
              sodiumMg: null,
              addedSugarG: null,
              saturatedFatG: null,
            },
          ],
        },
      ]),
    );

    expect(result[0]).toMatchObject({
      calories: 200,
      proteinG: 10,
      carbsG: 5,
      sodiumMg: 100,
    });
  });
});
