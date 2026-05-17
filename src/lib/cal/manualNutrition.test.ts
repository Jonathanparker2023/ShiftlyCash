import { describe, expect, it } from "vitest";

import {
  applyExplicitNutritionOverrides,
  extractExplicitNutritionOverrides,
} from "@/lib/cal/manualNutrition";

describe("manual nutrition overrides", () => {
  it("extracts a pasted For logging macro summary", () => {
    expect(
      extractExplicitNutritionOverrides(
        "For logging: Chicken bowl: 640 cal, 73g protein, 8g carbs, 28g fat, 2g fiber, 640mg sodium, 0g added sugar, 3.5g sat fat",
      ),
    ).toEqual({
      calories: 640,
      proteinG: 73,
      carbsG: 8,
      fatG: 28,
      fiberG: 2,
      sodiumMg: 640,
      addedSugarG: 0,
      saturatedFatG: 4,
    });
  });

  it("uses the final total instead of the first itemized component", () => {
    expect(
      extractExplicitNutritionOverrides(
        [
          "Chicken: 240 cal, 46g protein",
          "Rice: 210 cal, 45g carbs",
          "Sauce: 90 cal, 8g fat",
          "Total: 540 cal, 46g protein, 45g carbs, 8g fat, 2g fiber, 700mg sodium",
        ].join("\n"),
      ),
    ).toMatchObject({
      calories: 540,
      proteinG: 46,
      carbsG: 45,
      fatG: 8,
      fiberG: 2,
      sodiumMg: 700,
    });
  });

  it("does not lock a single component from an itemized list without totals", () => {
    expect(
      extractExplicitNutritionOverrides(
        ["Chicken: 240 cal, 46g protein", "Rice: 210 cal, 45g carbs"].join(
          "\n",
        ),
      ),
    ).toEqual({});
  });

  it("overrides only the fields the user explicitly provided", () => {
    expect(
      applyExplicitNutritionOverrides(
        {
          calories: 999,
          proteinG: 1,
          carbsG: 22,
          fatG: 33,
          fiberG: null,
        },
        "Calculated: 640 cal, 73g protein",
      ),
    ).toEqual({
      calories: 640,
      proteinG: 73,
      carbsG: 22,
      fatG: 33,
      fiberG: null,
    });
  });
});
