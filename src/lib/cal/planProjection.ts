import type { CalTargets, CalTotals, FoodCategory } from "@/lib/cal/types";

type PlanMetricTargets = Pick<
  CalTargets,
  | "tdeeCalories"
  | "proteinTargetG"
  | "carbsTargetG"
  | "fatTargetG"
  | "fiberTargetG"
  | "sodiumTargetMg"
  | "addedSugarTargetG"
  | "saturatedFatTargetG"
>;

export type ProjectedPlanEntry = {
  mealName: string;
  loggedTime: string;
  category: FoodCategory;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  addedSugarG: number;
  saturatedFatG: number;
};

const DEFAULT_TARGETS = {
  calories: 1650,
  proteinG: 180,
  carbsG: 120,
  fiberG: 30,
  sodiumMg: 2300,
  addedSugarG: 36,
  saturatedFatG: 20,
};

const MEAL_SCAFFOLD = [
  { mealName: "Projected breakfast", loggedTime: "08:00", weight: 0.28 },
  { mealName: "Projected lunch", loggedTime: "13:00", weight: 0.36 },
  { mealName: "Projected dinner", loggedTime: "18:30", weight: 0.36 },
] as const;

export function buildProjectedPlanEntries(
  targets: PlanMetricTargets,
): ProjectedPlanEntry[] {
  const dailyTargets = normalizePlanTargets(targets);
  const calories = distributeWholeNumber(dailyTargets.calories, MEAL_SCAFFOLD.map((meal) => meal.weight));
  const proteinG = distributeWholeNumber(dailyTargets.proteinG, MEAL_SCAFFOLD.map((meal) => meal.weight));
  const carbsG = distributeWholeNumber(dailyTargets.carbsG, MEAL_SCAFFOLD.map((meal) => meal.weight));
  const fatG = distributeWholeNumber(dailyTargets.fatG, MEAL_SCAFFOLD.map((meal) => meal.weight));
  const fiberG = distributeWholeNumber(dailyTargets.fiberG, MEAL_SCAFFOLD.map((meal) => meal.weight));
  const sodiumMg = distributeWholeNumber(dailyTargets.sodiumMg, MEAL_SCAFFOLD.map((meal) => meal.weight));
  const addedSugarG = distributeWholeNumber(dailyTargets.addedSugarG, MEAL_SCAFFOLD.map((meal) => meal.weight));
  const saturatedFatG = distributeWholeNumber(dailyTargets.saturatedFatG, MEAL_SCAFFOLD.map((meal) => meal.weight));

  return MEAL_SCAFFOLD.map((meal, index) => ({
    mealName: meal.mealName,
    loggedTime: meal.loggedTime,
    category: "meal",
    calories: calories[index],
    proteinG: proteinG[index],
    carbsG: carbsG[index],
    fatG: fatG[index],
    fiberG: fiberG[index],
    sodiumMg: sodiumMg[index],
    addedSugarG: addedSugarG[index],
    saturatedFatG: saturatedFatG[index],
  }));
}

export function totalsFromProjectedPlan(entries: ProjectedPlanEntry[]): CalTotals {
  return entries.reduce(
    (totals, entry) => ({
      calories: totals.calories + entry.calories,
      proteinG: totals.proteinG + entry.proteinG,
      carbsG: totals.carbsG + entry.carbsG,
      fatG: totals.fatG + entry.fatG,
      fiberG: totals.fiberG + entry.fiberG,
      sodiumMg: totals.sodiumMg + entry.sodiumMg,
      addedSugarG: totals.addedSugarG + entry.addedSugarG,
      saturatedFatG: totals.saturatedFatG + entry.saturatedFatG,
    }),
    {
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      sodiumMg: 0,
      addedSugarG: 0,
      saturatedFatG: 0,
    },
  );
}

function normalizePlanTargets(targets: PlanMetricTargets) {
  const calories = positiveInteger(targets.tdeeCalories) ?? DEFAULT_TARGETS.calories;
  const proteinG = positiveInteger(targets.proteinTargetG) ?? DEFAULT_TARGETS.proteinG;
  const carbsG = positiveInteger(targets.carbsTargetG) ?? DEFAULT_TARGETS.carbsG;
  const fiberG = positiveInteger(targets.fiberTargetG) ?? DEFAULT_TARGETS.fiberG;
  const fatG =
    positiveInteger(targets.fatTargetG) ??
    Math.max(0, Math.round((calories - proteinG * 4 - carbsG * 4) / 9));

  return {
    calories,
    proteinG,
    carbsG,
    fatG,
    fiberG,
    sodiumMg: positiveInteger(targets.sodiumTargetMg) ?? DEFAULT_TARGETS.sodiumMg,
    addedSugarG:
      positiveInteger(targets.addedSugarTargetG) ?? DEFAULT_TARGETS.addedSugarG,
    saturatedFatG:
      positiveInteger(targets.saturatedFatTargetG) ?? DEFAULT_TARGETS.saturatedFatG,
  };
}

function distributeWholeNumber(total: number, weights: number[]): number[] {
  let used = 0;

  return weights.map((weight, index) => {
    if (index === weights.length - 1) return total - used;

    const value = Math.round(total * weight);
    used += value;
    return value;
  });
}

function positiveInteger(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}
