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
  MealPlanPreset,
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

export type UseMealPlanPresetResult = {
  preset: MealPlanPreset;
  pool: CandidatePool;
  plan: MealPlan;
  validation: ValidationResult;
};

type MealPlanPresetRow = {
  id: string;
  name: string;
  axioms: MealPlanAxioms;
  pool: CandidatePool;
  plan: MealPlan;
  validation: ValidationResult;
  validation_ok: boolean;
  main_name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fiber_g: number;
  fat_g: number;
  sodium_mg: number;
  added_sugar_g: number;
  saturated_fat_g: number;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
};

class MealPlanActionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "service_unavailable"
      | "researcher_invalid"
      | "no_plan"
      | "accept_failed"
      | "preset_failed",
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

  const assembled = assembleAndValidateMealPlan(pool, remainingTargets, {});
  if (!assembled.plan) {
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
    plan: assembled.plan,
    validation: assembled.validation,
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
  const assembled = assembleAndValidateMealPlan(pool, remainingTargets, opts);

  if (!assembled.plan) {
    return {
      plan: null,
      validation: syntheticFailure(
        "Pool exhausted — Generate plan to refresh.",
      ),
    };
  }

  return {
    plan: assembled.plan,
    validation: assembled.validation,
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

export async function listMealPlanPresetsAction(): Promise<MealPlanPreset[]> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("meal_plan_presets")
    .select(PRESET_SELECT)
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    throw new MealPlanActionError(error.message, "preset_failed");
  }

  return ((data ?? []) as MealPlanPresetRow[]).map(mapPresetRow);
}

export async function saveMealPlanPresetAction(input: {
  name?: string | null;
  axioms: MealPlanAxioms;
  pool: CandidatePool;
  plan: MealPlan;
  validation: ValidationResult;
}): Promise<MealPlanPreset> {
  const { supabase, user } = await requireUser();
  if (!input.validation.ok) {
    throw new MealPlanActionError(
      "Only plans that clear every benchmark can be saved as presets.",
      "preset_failed",
    );
  }

  const name = normalizePresetName(input.name, input.plan);
  const { data, error } = await supabase
    .from("meal_plan_presets")
    .insert({
      user_id: user.id,
      name,
      axioms: input.axioms,
      pool: input.pool,
      plan: input.plan,
      validation: input.validation,
      validation_ok: true,
      main_name: input.plan.main.name,
      calories: input.plan.totals.calories,
      protein_g: input.plan.totals.proteinG,
      carbs_g: input.plan.totals.carbsG,
      fiber_g: input.plan.totals.fiberG,
      fat_g: input.plan.totals.fatG,
      sodium_mg: input.plan.totals.sodiumMg,
      added_sugar_g: input.plan.totals.addedSugarG,
      saturated_fat_g: input.plan.totals.saturatedFatG,
    })
    .select(PRESET_SELECT)
    .single();

  if (error) {
    throw new MealPlanActionError(error.message, "preset_failed");
  }

  revalidatePath("/cal");
  return mapPresetRow(data as MealPlanPresetRow);
}

export async function useMealPlanPresetAction(
  presetId: string,
): Promise<UseMealPlanPresetResult> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("meal_plan_presets")
    .select(PRESET_SELECT)
    .eq("user_id", user.id)
    .eq("id", presetId)
    .is("archived_at", null)
    .single();

  if (error) {
    throw new MealPlanActionError(error.message, "preset_failed");
  }

  const row = data as MealPlanPresetRow;
  const preset = mapPresetRow(row);
  const shiftlyCalData = await getShiftlyCalData();
  const today =
    shiftlyCalData.currentWeek.days.find(
      (day) => day.date === shiftlyCalData.todayIso,
    ) ?? shiftlyCalData.currentWeek.days[0];
  const remainingTargets = buildRemainingTargets(
    shiftlyCalData.targets,
    today.totals,
  );
  const validation = validateMealPlan(preset.plan, remainingTargets, preset.pool);
  const usedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("meal_plan_presets")
    .update({
      use_count: preset.useCount + 1,
      last_used_at: usedAt,
      updated_at: usedAt,
    })
    .eq("user_id", user.id)
    .eq("id", preset.id);

  if (updateError) {
    throw new MealPlanActionError(updateError.message, "preset_failed");
  }

  return {
    preset: { ...preset, useCount: preset.useCount + 1, lastUsedAt: usedAt },
    pool: preset.pool,
    plan: preset.plan,
    validation,
  };
}

const PRESET_SELECT =
  "id,name,axioms,pool,plan,validation,validation_ok,main_name,calories,protein_g,carbs_g,fiber_g,fat_g,sodium_mg,added_sugar_g,saturated_fat_g,use_count,last_used_at,created_at";

function normalizePresetName(
  name: string | null | undefined,
  plan: MealPlan,
): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed.slice(0, 80);
  return plan.main.name.slice(0, 80);
}

function mapPresetRow(row: MealPlanPresetRow): MealPlanPreset {
  return {
    id: row.id,
    name: row.name,
    axioms: row.axioms,
    pool: row.pool,
    plan: row.plan,
    validation: row.validation,
    validationOk: row.validation_ok,
    mainName: row.main_name,
    totals: {
      calories: row.calories,
      proteinG: row.protein_g,
      carbsG: row.carbs_g,
      fiberG: row.fiber_g,
      fatG: row.fat_g,
      sodiumMg: row.sodium_mg,
      addedSugarG: row.added_sugar_g,
      saturatedFatG: row.saturated_fat_g,
    },
    useCount: row.use_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

function assembleAndValidateMealPlan(
  pool: CandidatePool,
  remainingTargets: RemainingTargets,
  opts: AssembleOpts,
): ReassembleMealPlanResult {
  const attempts =
    opts.maxFillers === undefined
      ? [opts, { ...opts, maxFillers: 6 }]
      : [opts];
  let bestFailure: ReassembleMealPlanResult | null = null;

  for (const attempt of attempts) {
    const plan = assembleMealPlan(pool, remainingTargets, attempt);
    if (!plan) continue;

    const validation = validateMealPlan(plan, remainingTargets, pool);
    if (validation.ok) return { plan, validation };

    const failure = { plan, validation };
    if (!bestFailure || isBetterFailure(validation, bestFailure.validation)) {
      bestFailure = failure;
    }
  }

  return bestFailure ?? {
    plan: null,
    validation: syntheticFailure(
      "No candidates matched your axioms â€” try broadening location or allowing non-DoorDash main.",
    ),
  };
}

function isBetterFailure(
  candidate: ValidationResult,
  incumbent: ValidationResult,
): boolean {
  if (candidate.ok) return true;
  if (incumbent.ok) return false;

  if (candidate.gaps.length !== incumbent.gaps.length) {
    return candidate.gaps.length < incumbent.gaps.length;
  }

  return gapScore(candidate) < gapScore(incumbent);
}

function gapScore(validation: ValidationResult): number {
  if (validation.ok) return 0;
  return validation.gaps.reduce(
    (score, gap) => score + Math.abs(gap.deltaPct),
    0,
  );
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
