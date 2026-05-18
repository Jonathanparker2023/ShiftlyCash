import { describe, expect, it } from "vitest";

import {
  buildProjectedPlanEntries,
  totalsFromProjectedPlan,
} from "@/lib/cal/planProjection";

describe("ShiftlyCal projected plan entries", () => {
  it("fills a future day to the configured meal-plan targets", () => {
    const entries = buildProjectedPlanEntries({
      tdeeCalories: 1650,
      proteinTargetG: 180,
      carbsTargetG: 120,
      fatTargetG: 50,
      fiberTargetG: 30,
      sodiumTargetMg: 1500,
      addedSugarTargetG: 25,
      saturatedFatTargetG: 15,
    });

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.mealName)).toEqual([
      "Projected breakfast",
      "Projected lunch",
      "Projected dinner",
    ]);
    expect(totalsFromProjectedPlan(entries)).toEqual({
      calories: 1650,
      proteinG: 180,
      carbsG: 120,
      fatG: 50,
      fiberG: 30,
      sodiumMg: 1500,
      addedSugarG: 25,
      saturatedFatG: 15,
    });
  });

  it("falls back to Jon's seeded plan when optional targets are missing", () => {
    const entries = buildProjectedPlanEntries({
      tdeeCalories: null,
      proteinTargetG: null,
      carbsTargetG: null,
      fatTargetG: null,
      fiberTargetG: null,
      sodiumTargetMg: null,
      addedSugarTargetG: null,
      saturatedFatTargetG: null,
    });

    const totals = totalsFromProjectedPlan(entries);

    expect(totals.calories).toBe(1650);
    expect(totals.proteinG).toBe(180);
    expect(totals.carbsG).toBe(120);
    expect(totals.fiberG).toBe(30);
    expect(totals.fatG).toBeGreaterThan(0);
  });
});
