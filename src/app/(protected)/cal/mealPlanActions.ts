"use server";

import { revalidatePath } from "next/cache";

import { createFoodEntryAction } from "@/app/(protected)/cal/actions";
import { requireUser } from "@/lib/auth";
import { getShiftlyCalData } from "@/lib/cal/data";
import { assembleMealPlan } from "@/lib/cal/mealPlan/assembler";
import {
  fetchCandidatePool,
  MealPlanResearcherError,
} from "@/lib/cal/mealPlan/researcher";
import type {
  AssembleOpts,
  CandidatePool,
  MealPlan,
  MealPlanAxioms,
  MealPlanCandidate,
  MealPlanMacros,
  RemainingTargets,
  SavedFoodForResearcher,
  ValidationResult,
} from "@/lib/cal/mealPlan/types";
import { validateMealPlan } from "@/lib/cal/mealPlan/validator";
import type {
  CalTargets,
  CalTotals,
  FoodCategory,
  SavedFood,
} from "@/lib/cal/types";
import { getTodayIso } from "@/lib/dashboard/dates";

export type GenerateMealPlanResult = {
  pool: CandidatePool;
  plan: MealPlan | null;
  validation: ValidationResult;
};

export type ReassembleMealPlanResult = {
  plan: MealPlan | null;
  validation: ValidationResult;
};

class MealPlanActionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "service_unavailable"
      | "researcher_invalid"
      | "no_plan"
      | "accept_failed",
  ) {
    super(message);
    this.name = "MealPlanActionError";
  }
}

export async function generateMealPlanAction(
  axioms: MealPlanAxioms,
): Promise<GenerateMealPlanResult> {
  await requireUser();
  const data = await getShiftlyCalData();
  const today =
    data.currentWeek.days.find((day) => day.date === data.todayIso) ??
    data.currentWeek.days[0];
  const remainingTargets = buildRemainingTargets(data.targets, today.totals);

  let pool: CandidatePool;
  try {
    pool = await fetchCandidatePool({
      remainingTargets,
      axioms,
      savedFoods: savedFoodsForResearcher(data.savedFoods),
      nowIso: new Date().toISOString(),
      healthFlags: data.targets.healthFlags,
    });
  } catch (error) {
    throw normalizeResearcherError(error);
  }

  if (pool.unfetchedReason) {
    return {
      pool,
      plan: null,
      validation: syntheticFailure(pool.unfetchedReason),
    };
  }

  const plan = assembleMealPlan(pool, remainingTargets, {});
  if (!plan) {
    return {
      pool,
      plan: null,
      validation: syntheticFailure(
        "No candidates matched your axioms — try broadening location or allowing non-DoorDash main.",
      ),
    };
  }

  return {
    pool,
    plan,
    validation: validateMealPlan(plan, remainingTargets, pool),
  };
}

export async function reassembleMealPlanAction(
  pool: CandidatePool,
  opts: AssembleOpts,
): Promise<ReassembleMealPlanResult> {
  await requireUser();
  const data = await getShiftlyCalData();
  const today =
    data.currentWeek.days.find((day) => day.date === data.todayIso) ??
    data.currentWeek.days[0];
  const remainingTargets = buildRemainingTargets(data.targets, today.totals);
  const plan = assembleMealPlan(pool, remainingTargets, opts);

  if (!plan) {
    return {
      plan: null,
      validation: syntheticFailure(
        "Pool exhausted — Generate plan to refresh.",
      ),
    };
  }

  return {
    plan,
    validation: validateMealPlan(plan, remainingTargets, pool),
  };
}

export async function acceptMealPlanAction(
  plan: MealPlan,
  date: string = getTodayIso(),
): Promise<{ ok: true; loggedEntryIds: string[] }> {
  const { supabase, user } = await requireUser();
  const loggedEntryIds: string[] = [];

  try {
    const main = await createFoodEntryAction({
      date,
      mealName: plan.main.name,
      category: "meal",
      ...macrosForEntry(plan.main.macros),
    });
    loggedEntryIds.push(main.id);

    for (const filler of plan.fillers) {
      const logged = await createFoodEntryAction({
        date,
        mealName: filler.name,
        category: categoryForFiller(filler),
        ...macrosForEntry(filler.macros),
      });
      loggedEntryIds.push(logged.id);
    }
  } catch (error) {
    if (loggedEntryIds.length > 0) {
      await supabase
        .from("food_entries")
        .delete()
        .eq("user_id", user.id)
        .in("id", loggedEntryIds);
    }
    throw new MealPlanActionError(
      error instanceof Error ? error.message : "Unable to log meal plan.",
      "accept_failed",
    );
  }

  revalidatePath("/cal");
  return { ok: true, loggedEntryIds };
}

function buildRemainingTargets(
  targets: CalTargets,
  totals: CalTotals,
): RemainingTargets {
  return {
    calories: remainingValue(targets.tdeeCalories, totals.calories),
    proteinG: remainingValue(targets.proteinTargetG, totals.proteinG),
    carbsG: remainingValue(targets.carbsTargetG, totals.carbsG),
    fiberG: remainingValue(targets.fiberTargetG, totals.fiberG),
    fatG: remainingValue(targets.fatTargetG, totals.fatG),
    sodiumMg: remainingValue(targets.sodiumTargetMg, totals.sodiumMg),
    addedSugarG: remainingValue(
      targets.addedSugarTargetG,
      totals.addedSugarG,
    ),
    saturatedFatG: remainingValue(
      targets.saturatedFatTargetG,
      totals.saturatedFatG,
    ),
  };
}

function remainingValue(target: number | null, value: number): number {
  if (target === null) return 0;
  return Math.max(0, target - value);
}

function savedFoodsForResearcher(
  savedFoods: SavedFood[],
): SavedFoodForResearcher[] {
  return savedFoods
    .filter((food) => food.calories > 0)
    .map((food) => ({
      id: food.id,
      name: food.name,
      macros: {
        calories: food.calories,
        proteinG: food.proteinG ?? 0,
        carbsG: food.carbsG ?? 0,
        fiberG: food.fiberG ?? 0,
        fatG: food.fatG ?? 0,
        sodiumMg: food.sodiumMg,
        addedSugarG: food.addedSugarG,
        saturatedFatG: food.saturatedFatG,
      },
    }));
}

function macrosForEntry(macros: MealPlanMacros) {
  return {
    calories: macros.calories,
    proteinG: macros.proteinG,
    carbsG: macros.carbsG,
    fiberG: macros.fiberG,
    fatG: macros.fatG,
    sodiumMg: macros.sodiumMg,
    addedSugarG: macros.addedSugarG,
    saturatedFatG: macros.saturatedFatG,
  };
}

function categoryForFiller(candidate: MealPlanCandidate): FoodCategory {
  const name = candidate.name.toLowerCase();
  if (
    includesAny(name, [
      "yogurt",
      "cheese",
      "egg",
      "milk",
      "tofu",
      "nuts",
      "fruit",
      "apple",
      "banana",
      "berry",
      "carrot",
      "broccoli",
      "veg",
    ])
  ) {
    return "healthy_snack";
  }
  if (
    includesAny(name, [
      "chips",
      "candy",
      "cookie",
      "cake",
      "donut",
      "soda",
      "ice cream",
    ])
  ) {
    return "unhealthy_snack";
  }
  if (
    includesAny(name, [
      "water",
      "coffee",
      "tea",
      "juice",
      "smoothie",
      "soda",
      "beer",
      "wine",
    ])
  ) {
    return "drink";
  }
  return "other";
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function syntheticFailure(remediation: string): ValidationResult {
  return {
    ok: false,
    bestAttempt: null,
    gaps: [
      {
        metric: "calories",
        target: 0,
        actual: 0,
        deltaPct: 0,
        direction: "short",
        remediation,
      },
    ],
  };
}

function normalizeResearcherError(error: unknown): Error {
  if (error instanceof MealPlanResearcherError) {
    if (error.code === "missing_api_key") return error;
    return new MealPlanActionError(
      "Meal plan service returned unusable data. Try again in a minute.",
      "researcher_invalid",
    );
  }

  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;
  if (status === 400 || status === 429 || status === 500) {
    return new MealPlanActionError(
      "Meal plan service is unavailable. Try again in a minute.",
      "service_unavailable",
    );
  }

  return error instanceof Error
    ? error
    : new MealPlanActionError(
        "Meal plan service is unavailable. Try again in a minute.",
        "service_unavailable",
      );
}
