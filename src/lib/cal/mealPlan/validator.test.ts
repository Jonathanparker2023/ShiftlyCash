import { describe, expect, it } from "vitest";

import { validateMealPlan } from "@/lib/cal/mealPlan/validator";
import type {
  CandidatePool,
  MealPlan,
  MealPlanCandidate,
  MealPlanMacros,
  RemainingTargets,
} from "@/lib/cal/mealPlan/types";

const TARGETS: RemainingTargets = {
  calories: 1000,
  proteinG: 70,
  carbsG: 100,
  fiberG: 15,
  fatG: 35,
  sodiumMg: 1500,
  addedSugarG: 25,
  saturatedFatG: 12,
};

describe("meal-plan validator", () => {
  it("passes a published plan inside tier-banded tolerance", () => {
    const chicken = candidate("chicken", "main", "Chicken Bowl", {
      calories: 700,
      proteinG: 50,
      carbsG: 75,
      fiberG: 12,
      fatG: 25,
      sodiumMg: 850,
      addedSugarG: 2,
      saturatedFatG: 4,
    });
    const yogurt = candidate("yogurt", "filler", "Greek Yogurt", {
      calories: 120,
      proteinG: 20,
      carbsG: 8,
      fiberG: 0,
      fatG: 10,
      sodiumMg: 60,
      addedSugarG: 4,
      saturatedFatG: 0,
    });
    const banana = candidate("banana", "filler", "Banana", {
      calories: 105,
      proteinG: 1,
      carbsG: 27,
      fiberG: 3,
      fatG: 0,
      sodiumMg: 1,
      addedSugarG: 0,
      saturatedFatG: 0,
    });
    const plan = makePlan(chicken, [yogurt, banana]);
    const result = validateMealPlan(plan, TARGETS, makePool([chicken], [yogurt, banana]));

    expect(result).toEqual({ ok: true, plan });
  });

  it("returns a protein gap with a filler remediation", () => {
    const lowProtein = candidate("plate", "main", "Low Protein Plate", {
      calories: 1000,
      proteinG: 35,
      carbsG: 100,
      fiberG: 15,
      fatG: 35,
      sodiumMg: 500,
      addedSugarG: 5,
      saturatedFatG: 5,
    });
    const proteinShake = candidate("shake", "filler", "Protein Shake", {
      calories: 180,
      proteinG: 40,
      carbsG: 6,
      fiberG: 0,
      fatG: 3,
      sodiumMg: 160,
      addedSugarG: 1,
      saturatedFatG: 1,
    });
    const yogurt = candidate("yogurt", "filler", "Greek Yogurt", {
      calories: 120,
      proteinG: 20,
      carbsG: 8,
      fiberG: 0,
      fatG: 0,
      sodiumMg: 60,
      addedSugarG: 4,
      saturatedFatG: 0,
    });
    const plan = makePlan(lowProtein, []);

    const result = validateMealPlan(
      plan,
      TARGETS,
      makePool([lowProtein], [proteinShake, yogurt]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({
      metric: "proteinG",
      direction: "short",
    });
    expect(result.gaps[0].remediation).toContain("Protein Shake");
    expect(result.gaps[0].remediation).toContain("+40g protein");
  });

  it("returns a sodium gap with a lower-sodium main swap", () => {
    const saltyMain = candidate("salty", "main", "Salt-Forward Bowl", {
      calories: 1000,
      proteinG: 70,
      carbsG: 100,
      fiberG: 15,
      fatG: 35,
      sodiumMg: 2200,
      addedSugarG: 5,
      saturatedFatG: 5,
    });
    const lowerSodiumMain = candidate("lower", "main", "Lower Sodium Bowl", {
      calories: 1000,
      proteinG: 70,
      carbsG: 100,
      fiberG: 15,
      fatG: 35,
      sodiumMg: 600,
      addedSugarG: 5,
      saturatedFatG: 5,
    });
    const plan = makePlan(saltyMain, []);

    const result = validateMealPlan(
      plan,
      TARGETS,
      makePool([saltyMain, lowerSodiumMain], []),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({
      metric: "sodiumMg",
      direction: "over",
    });
    expect(result.gaps[0].remediation).toContain("Lower Sodium Bowl");
  });
});

function makePool(
  mains: MealPlanCandidate[],
  fillers: MealPlanCandidate[],
): CandidatePool {
  return {
    fetchedAt: "2026-05-19T00:00:00.000Z",
    axioms: {
      eatOut: true,
      requireDoorDash: false,
      allowNonDoorDashMain: true,
      carbMode: "indifferent",
      locationHint: "Naugatuck, CT",
    },
    unfetchedReason: null,
    mains,
    fillers,
  };
}

function makePlan(
  main: MealPlanCandidate,
  fillers: MealPlanCandidate[],
): MealPlan {
  const items = [main, ...fillers];
  return {
    main,
    fillers,
    totals: items.reduce<MealPlan["totals"]>(
      (totals, item) => ({
        calories: totals.calories + item.macros.calories,
        proteinG: totals.proteinG + item.macros.proteinG,
        carbsG: totals.carbsG + item.macros.carbsG,
        fiberG: totals.fiberG + item.macros.fiberG,
        fatG: totals.fatG + item.macros.fatG,
        sodiumMg: totals.sodiumMg + (item.macros.sodiumMg ?? 0),
        addedSugarG: totals.addedSugarG + (item.macros.addedSugarG ?? 0),
        saturatedFatG:
          totals.saturatedFatG + (item.macros.saturatedFatG ?? 0),
      }),
      {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fiberG: 0,
        fatG: 0,
        sodiumMg: 0,
        addedSugarG: 0,
        saturatedFatG: 0,
      },
    ),
  };
}

function candidate(
  id: string,
  kind: MealPlanCandidate["kind"],
  name: string,
  macros: MealPlanMacros,
): MealPlanCandidate {
  return {
    id,
    kind,
    name,
    sourceUrl: null,
    doordashUrl: null,
    tier: "published",
    macros,
    macroRange: null,
    confidence: "high",
    notes: null,
  };
}
