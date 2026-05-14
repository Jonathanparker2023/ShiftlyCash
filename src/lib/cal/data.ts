import "server-only";

import { requireUser } from "@/lib/auth";
import { addDaysIso, getSundayOnOrBeforeTodayIso, getTodayIso } from "@/lib/dashboard/dates";
import {
  computeWeeklyDeficit,
  projectWeeklyWeightChangeLbs,
} from "@/lib/cal/projection";
import type {
  CalDay,
  CalTargets,
  CalTotals,
  FoodEntry,
  SavedFood,
  ShiftlyCalData,
  WeightLog,
} from "@/lib/cal/types";

type FoodEntryRow = {
  id: string;
  date: string;
  meal_name: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  saved_food_id: string | null;
  created_at: string;
  updated_at: string;
};

type SavedFoodRow = {
  id: string;
  name: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  sort_order: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type WeightLogRow = {
  id: string;
  date: string;
  weight_lbs: number | string;
  created_at: string;
  updated_at: string;
};

type SettingsTargetsRow = {
  tdee_calories: number | null;
  protein_target_g: number | null;
  carbs_target_g: number | null;
  fat_target_g: number | null;
};

export async function getShiftlyCalData(): Promise<ShiftlyCalData> {
  const { supabase, user } = await requireUser();
  const todayIso = getTodayIso();
  const weekStartIso = getSundayOnOrBeforeTodayIso();
  const weekEndIso = addDaysIso(weekStartIso, 6);

  const [entriesRes, savedFoodsRes, settingsRes, weightRes] = await Promise.all([
    supabase
      .from("food_entries")
      .select(
        "id,date,meal_name,calories,protein_g,carbs_g,fat_g,saved_food_id,created_at,updated_at",
      )
      .eq("user_id", user.id)
      .gte("date", weekStartIso)
      .lte("date", weekEndIso)
      .order("created_at", { ascending: false }),
    supabase
      .from("saved_foods")
      .select(
        "id,name,calories,protein_g,carbs_g,fat_g,sort_order,archived_at,created_at,updated_at",
      )
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("settings")
      .select("tdee_calories,protein_target_g,carbs_target_g,fat_target_g")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("weight_logs")
      .select("id,date,weight_lbs,created_at,updated_at")
      .eq("user_id", user.id)
      .gte("date", weekStartIso)
      .lte("date", weekEndIso),
  ]);

  if (entriesRes.error) throw new Error(`Food entries: ${entriesRes.error.message}`);
  if (savedFoodsRes.error) throw new Error(`Saved foods: ${savedFoodsRes.error.message}`);
  if (settingsRes.error) throw new Error(`Cal targets: ${settingsRes.error.message}`);
  if (weightRes.error) throw new Error(`Weight log: ${weightRes.error.message}`);

  const targets = mapTargets((settingsRes.data ?? null) as SettingsTargetsRow | null);
  const entries = ((entriesRes.data ?? []) as FoodEntryRow[]).map(mapFoodEntry);
  const weights = ((weightRes.data ?? []) as WeightLogRow[]).map(mapWeightLog);
  const currentWeek = buildCalWeek(weekStartIso, weekEndIso, entries, weights);
  const weeklyDeficitCalories = computeWeeklyDeficit(
    currentWeek,
    targets.tdeeCalories,
  );

  return {
    todayIso,
    targets,
    currentWeek,
    projection: {
      weeklyDeficitCalories,
      projectedWeightDeltaLbs: projectWeeklyWeightChangeLbs(weeklyDeficitCalories),
    },
    savedFoods: ((savedFoodsRes.data ?? []) as SavedFoodRow[]).map(mapSavedFood),
  };
}

function buildCalWeek(
  weekStartIso: string,
  weekEndIso: string,
  entries: FoodEntry[],
  weights: WeightLog[],
) {
  const entriesByDate = groupByDate(entries);
  const weightsByDate = new Map(weights.map((weight) => [weight.date, weight]));
  const days: CalDay[] = Array.from({ length: 7 }, (_, dayIndex) => {
    const date = addDaysIso(weekStartIso, dayIndex);
    const dayEntries = entriesByDate.get(date) ?? [];

    return {
      date,
      dayIndex,
      entries: dayEntries,
      totals: sumTotals(dayEntries),
      weight: weightsByDate.get(date) ?? null,
    };
  });

  return {
    weekStartIso,
    weekEndIso,
    days,
    totals: days.reduce(
      (totals, day) => addTotals(totals, day.totals),
      emptyTotals(),
    ),
  };
}

function groupByDate(entries: FoodEntry[]): Map<string, FoodEntry[]> {
  const byDate = new Map<string, FoodEntry[]>();

  for (const entry of entries) {
    const bucket = byDate.get(entry.date) ?? [];
    bucket.push(entry);
    byDate.set(entry.date, bucket);
  }

  return byDate;
}

function sumTotals(entries: FoodEntry[]): CalTotals {
  return entries.reduce(
    (totals, entry) => ({
      calories: totals.calories + entry.calories,
      proteinG: totals.proteinG + (entry.proteinG ?? 0),
      carbsG: totals.carbsG + (entry.carbsG ?? 0),
      fatG: totals.fatG + (entry.fatG ?? 0),
    }),
    emptyTotals(),
  );
}

function addTotals(left: CalTotals, right: CalTotals): CalTotals {
  return {
    calories: left.calories + right.calories,
    proteinG: left.proteinG + right.proteinG,
    carbsG: left.carbsG + right.carbsG,
    fatG: left.fatG + right.fatG,
  };
}

function emptyTotals(): CalTotals {
  return { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
}

function mapTargets(row: SettingsTargetsRow | null): CalTargets {
  return {
    tdeeCalories: row?.tdee_calories ?? null,
    proteinTargetG: row?.protein_target_g ?? null,
    carbsTargetG: row?.carbs_target_g ?? null,
    fatTargetG: row?.fat_target_g ?? null,
  };
}

function mapFoodEntry(row: FoodEntryRow): FoodEntry {
  return {
    id: row.id,
    date: row.date,
    mealName: row.meal_name,
    calories: Number(row.calories),
    proteinG: nullableNumber(row.protein_g),
    carbsG: nullableNumber(row.carbs_g),
    fatG: nullableNumber(row.fat_g),
    savedFoodId: row.saved_food_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSavedFood(row: SavedFoodRow): SavedFood {
  return {
    id: row.id,
    name: row.name,
    calories: Number(row.calories),
    proteinG: nullableNumber(row.protein_g),
    carbsG: nullableNumber(row.carbs_g),
    fatG: nullableNumber(row.fat_g),
    sortOrder: Number(row.sort_order ?? 0),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWeightLog(row: WeightLogRow): WeightLog {
  return {
    id: row.id,
    date: row.date,
    weightLbs: Number(row.weight_lbs),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}
