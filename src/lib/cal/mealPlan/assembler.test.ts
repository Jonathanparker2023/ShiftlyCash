import { describe, expect, it } from "vitest";

import { assembleMealPlan } from "@/lib/cal/mealPlan/assembler";
import { validateMealPlan } from "@/lib/cal/mealPlan/validator";
import type {
  CandidatePool,
  CarbMode,
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

describe("meal-plan assembler", () => {
  it("chooses the simple main plus fillers that closes the sample targets", () => {
    const pool = makePool({
      mains: [
        candidate("chicken", "main", "Chicken Bowl", {
          calories: 700,
          proteinG: 50,
          carbsG: 75,
          fiberG: 12,
          fatG: 25,
          sodiumMg: 850,
          addedSugarG: 2,
          saturatedFatG: 4,
        }),
        candidate("burger", "main", "Burger Plate", {
          calories: 900,
          proteinG: 35,
          carbsG: 50,
          fiberG: 3,
          fatG: 45,
          sodiumMg: 1450,
          addedSugarG: 8,
          saturatedFatG: 15,
        }),
      ],
      fillers: [
        candidate("yogurt", "filler", "Greek Yogurt", {
          calories: 120,
          proteinG: 20,
          carbsG: 8,
          fiberG: 0,
          fatG: 0,
          sodiumMg: 60,
          addedSugarG: 4,
          saturatedFatG: 0,
        }),
        candidate("banana", "filler", "Banana", {
          calories: 105,
          proteinG: 1,
          carbsG: 27,
          fiberG: 3,
          fatG: 0,
          sodiumMg: 1,
          addedSugarG: 0,
          saturatedFatG: 0,
        }),
        candidate("almonds", "filler", "Almonds", {
          calories: 320,
          proteinG: 12,
          carbsG: 12,
          fiberG: 7,
          fatG: 28,
          sodiumMg: 0,
          addedSugarG: 1,
          saturatedFatG: 2,
        }),
      ],
    });

    const plan = assembleMealPlan(pool, TARGETS);

    expect(plan).not.toBeNull();
    expect(plan?.main.id).toBe("chicken");
    expect(plan?.fillers.map((filler) => filler.id).sort()).toEqual([
      "banana",
      "yogurt",
    ]);
    expect(plan ? scoreForTest(plan, TARGETS, "indifferent") : Infinity).toBeLessThan(
      0.5,
    );
  });

  it("keeps only DoorDash mains when the axiom requires DoorDash", () => {
    const pool = makePool({
      axioms: {
        eatOut: true,
        requireDoorDash: true,
        allowNonDoorDashMain: false,
        carbMode: "indifferent",
        locationHint: "Naugatuck, CT",
      },
      mains: [
        candidate("local", "main", "Local Bowl", {
          calories: 650,
          proteinG: 55,
          carbsG: 70,
          fiberG: 8,
          fatG: 18,
          sodiumMg: 800,
          addedSugarG: 3,
          saturatedFatG: 4,
        }),
        candidate(
          "doordash",
          "main",
          "DoorDash Bowl",
          {
            calories: 720,
            proteinG: 48,
            carbsG: 82,
            fiberG: 9,
            fatG: 20,
            sodiumMg: 900,
            addedSugarG: 4,
            saturatedFatG: 5,
          },
          "https://www.doordash.com/store/example-item",
        ),
        candidate("also-local", "main", "Other Local Bowl", {
          calories: 710,
          proteinG: 60,
          carbsG: 60,
          fiberG: 7,
          fatG: 25,
          sodiumMg: 700,
          addedSugarG: 2,
          saturatedFatG: 6,
        }),
      ],
      fillers: [],
    });

    const plan = assembleMealPlan(pool, TARGETS);

    expect(plan?.main.id).toBe("doordash");
  });

  it("returns null when low-carb filtering removes every main", () => {
    const pool = makePool({
      axioms: {
        eatOut: true,
        requireDoorDash: false,
        allowNonDoorDashMain: true,
        carbMode: "low",
        locationHint: "Naugatuck, CT",
      },
      mains: [
        candidate("pasta", "main", "Pasta Bowl", {
          calories: 800,
          proteinG: 35,
          carbsG: 110,
          fiberG: 5,
          fatG: 22,
          sodiumMg: 700,
          addedSugarG: 6,
          saturatedFatG: 7,
        }),
        candidate("rice", "main", "Rice Bowl", {
          calories: 760,
          proteinG: 42,
          carbsG: 95,
          fiberG: 6,
          fatG: 18,
          sodiumMg: 650,
          addedSugarG: 3,
          saturatedFatG: 4,
        }),
      ],
      fillers: [],
    });

    expect(assembleMealPlan(pool, TARGETS)).toBeNull();
  });

  it("supports preset re-fit by holding the saved main and closing with fillers", () => {
    const pool = makePool({
      mains: [
        candidate("saved-main", "main", "Saved Steak Bowl", {
          calories: 700,
          proteinG: 50,
          carbsG: 75,
          fiberG: 12,
          fatG: 25,
          sodiumMg: 800,
          addedSugarG: 2,
          saturatedFatG: 4,
        }),
        candidate("other-main", "main", "Other Bowl", {
          calories: 1000,
          proteinG: 70,
          carbsG: 100,
          fiberG: 15,
          fatG: 35,
          sodiumMg: 1000,
          addedSugarG: 2,
          saturatedFatG: 7,
        }),
      ],
      fillers: [
        candidate("filler", "filler", "Greek Yogurt and Fruit", {
          calories: 300,
          proteinG: 20,
          carbsG: 25,
          fiberG: 3,
          fatG: 10,
          sodiumMg: 200,
          addedSugarG: 2,
          saturatedFatG: 3,
        }),
      ],
    });

    const plan = assembleMealPlan(pool, TARGETS, { holdMainId: "saved-main" });

    expect(plan).not.toBeNull();
    expect(plan?.main.id).toBe("saved-main");
    expect(plan?.fillers.map((filler) => filler.id)).toEqual(["filler"]);
    if (!plan) return;

    expect(validateMealPlan(plan, TARGETS, pool)).toEqual({ ok: true, plan });
  });

  it("does not under-fill when multiple low-risk fillers improve a large calorie gap", () => {
    const pool = makePool({
      axioms: {
        eatOut: true,
        requireDoorDash: true,
        allowNonDoorDashMain: false,
        carbMode: "indifferent",
        locationHint: "Naugatuck, CT",
      },
      mains: [
        candidate(
          "chipotle",
          "main",
          "Chipotle Chicken Burrito Bowl",
          {
            calories: 580,
            proteinG: 45,
            carbsG: 55,
            fiberG: 12,
            fatG: 19,
            sodiumMg: 1380,
            addedSugarG: 4,
            saturatedFatG: 6,
          },
          "https://www.doordash.com/store/chipotle-example",
        ),
      ],
      fillers: [
        candidate("cottage", "filler", "Cottage cheese", {
          calories: 81,
          proteinG: 14,
          carbsG: 3,
          fiberG: 0,
          fatG: 2,
          sodiumMg: 320,
          addedSugarG: 2,
          saturatedFatG: 1,
        }),
        candidate("almonds", "filler", "Almonds", {
          calories: 164,
          proteinG: 6,
          carbsG: 6,
          fiberG: 4,
          fatG: 14,
          sodiumMg: 0,
          addedSugarG: 1,
          saturatedFatG: 1,
        }),
        candidate("yogurt", "filler", "Greek yogurt", {
          calories: 130,
          proteinG: 22,
          carbsG: 9,
          fiberG: 0,
          fatG: 0,
          sodiumMg: 65,
          addedSugarG: 0,
          saturatedFatG: 0,
        }),
        candidate("banana", "filler", "Banana", {
          calories: 105,
          proteinG: 1,
          carbsG: 27,
          fiberG: 3,
          fatG: 0,
          sodiumMg: 1,
          addedSugarG: 0,
          saturatedFatG: 0,
        }),
      ],
    });
    const targets: RemainingTargets = {
      calories: 1650,
      proteinG: 70,
      carbsG: 60,
      fiberG: 15,
      fatG: 20,
      sodiumMg: 1500,
      addedSugarG: 25,
      saturatedFatG: 12,
    };

    const plan = assembleMealPlan(pool, targets);

    expect(plan).not.toBeNull();
    expect(plan?.fillers.map((filler) => filler.id).sort()).toEqual([
      "banana",
      "cottage",
      "yogurt",
    ]);
    expect(plan?.totals.calories).toBe(896);
  });
});

function makePool(input: {
  axioms?: CandidatePool["axioms"];
  mains: MealPlanCandidate[];
  fillers: MealPlanCandidate[];
}): CandidatePool {
  return {
    fetchedAt: "2026-05-19T00:00:00.000Z",
    axioms:
      input.axioms ?? {
        eatOut: true,
        requireDoorDash: false,
        allowNonDoorDashMain: true,
        carbMode: "indifferent",
        locationHint: "Naugatuck, CT",
      },
    unfetchedReason: null,
    mains: input.mains,
    fillers: input.fillers,
  };
}

function candidate(
  id: string,
  kind: MealPlanCandidate["kind"],
  name: string,
  macros: MealPlanMacros,
  doordashUrl: string | null = null,
): MealPlanCandidate {
  return {
    id,
    kind,
    name,
    sourceUrl: null,
    doordashUrl,
    tier: "published",
    macros,
    macroRange: null,
    confidence: "high",
    notes: null,
  };
}

function scoreForTest(
  plan: MealPlan,
  targets: RemainingTargets,
  carbMode: CarbMode,
): number {
  return (
    calorie(plan.totals.calories, targets.calories) +
    floor(plan.totals.proteinG, targets.proteinG, 1.5) +
    carb(plan.totals.carbsG, targets.carbsG, carbMode) +
    floor(plan.totals.fiberG, targets.fiberG, 0.8) +
    asymmetricCentered(plan.totals.fatG, targets.fatG, 0, 0.5) +
    ceiling(plan.totals.sodiumMg, targets.sodiumMg, 0.8) +
    ceiling(plan.totals.addedSugarG, targets.addedSugarG, 1.0) +
    ceiling(plan.totals.saturatedFatG, targets.saturatedFatG, 0.7)
  );
}

function calorie(actual: number, target: number): number {
  const weight = target > 0 && actual < target * 0.8 ? 1.5 : 1;
  return centered(actual, target, weight);
}

function carb(actual: number, target: number, carbMode: CarbMode): number {
  const weight = carbMode === "indifferent" ? 1.0 : 1.5;
  if (carbMode === "low") return ceiling(actual, target, weight);
  if (carbMode === "high") return floor(actual, target, weight);
  return asymmetricCentered(actual, target, 1, 0.35);
}

function centered(actual: number, target: number, weight: number): number {
  if (target <= 0) return 0;
  const deviation = (actual - target) / target;
  return weight * deviation * deviation;
}

function floor(actual: number, target: number, weight: number): number {
  if (target <= 0) return 0;
  const deviation = Math.max(0, (target - actual) / target);
  return weight * deviation * deviation;
}

function ceiling(actual: number, target: number, weight: number): number {
  if (target <= 0) return 0;
  const deviation = Math.max(0, (actual - target) / target);
  return weight * deviation * deviation;
}

function asymmetricCentered(
  actual: number,
  target: number,
  underWeight: number,
  overWeight: number,
): number {
  if (target <= 0) return 0;
  const deviation = (actual - target) / target;
  const excessDeviation = Math.max(0, Math.abs(deviation) - 0.1);
  return (deviation < 0 ? underWeight : overWeight) *
    excessDeviation *
    excessDeviation;
}
