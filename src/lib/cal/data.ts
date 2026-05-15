import "server-only";

import { requireUser } from "@/lib/auth";
import {
  addDaysIso,
  getSundayOnOrBeforeTodayIso,
  getTodayIso,
} from "@/lib/dashboard/dates";
import {
  computeWeeklyDeficit,
  projectWeeklyWeightChangeLbs,
} from "@/lib/cal/projection";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CalDay,
  CalTargets,
  CalTotals,
  FoodCategory,
  FoodEntry,
  SavedFood,
  ShiftlyCalData,
  WeightLog,
} from "@/lib/cal/types";

type FoodEntryRow = {
  id: string;
  date: string;
  logged_time: string | null;
  meal_name: string;
  category: string | null;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  saved_food_id: string | null;
  created_at: string;
  updated_at: string;
};

type SavedFoodRow = {
  id: string;
  name: string;
  category: string | null;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
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
  fiber_target_g: number | null;
};

type TrendFoodEntryRow = {
  date: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
};

type TrendWeightLogRow = {
  date: string;
  weight_lbs: number | string;
};

export type CalTrendDay = {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  entryCount: number;
  weightLbs: number | null;
};

export type ShiftlyCalTrendsData = {
  todayIso: string;
  targets: CalTargets;
  savedFoods: SavedFood[];
  trendDays: CalTrendDay[];
  currentWeek: ShiftlyCalData["currentWeek"];
};

export type CalHistoryWeek = {
  weekStartIso: string;
  weekEndIso: string;
  totals: CalTotals;
  avgDailyLogged: CalTotals;
  daysLogged: number;
  entryCount: number;
  weightStartLbs: number | null;
  weightEndLbs: number | null;
  weightDeltaLbs: number | null;
};

export type ShiftlyCalHistoryData = {
  todayIso: string;
  targets: CalTargets;
  weeks: CalHistoryWeek[];
  summary: {
    weekCount: number;
    avgWeeklyCalories: number;
    avgWeeklyProteinG: number;
    avgWeeklyFiberG: number;
    avgWeeklyWeightDeltaLbs: number | null;
  };
};

export async function getShiftlyCalData(opts?: {
  weekStartIso?: string;
}): Promise<ShiftlyCalData> {
  const { supabase, user } = await requireUser();
  return loadShiftlyCalData(supabase, user.id, opts);
}

export async function getShiftlyCalDataForUser(
  userId: string,
  opts?: { weekStartIso?: string },
): Promise<ShiftlyCalData> {
  return loadShiftlyCalData(createAdminClient(), userId, opts);
}

async function loadShiftlyCalData(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  opts?: { weekStartIso?: string },
): Promise<ShiftlyCalData> {
  const todayIso = getTodayIso();
  const weekStartIso = normalizeWeekStartIso(opts?.weekStartIso);
  const weekEndIso = addDaysIso(weekStartIso, 6);

  const [entriesRes, savedFoodsRes, settingsRes, weightRes] = await Promise.all([
    supabase
      .from("food_entries")
      .select(
        "id,date,logged_time,meal_name,category,calories,protein_g,carbs_g,fat_g,fiber_g,saved_food_id,created_at,updated_at",
      )
      .eq("user_id", userId)
      .gte("date", weekStartIso)
      .lte("date", weekEndIso)
      .order("date", { ascending: true })
      .order("logged_time", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("saved_foods")
      .select(
        "id,name,category,calories,protein_g,carbs_g,fat_g,fiber_g,sort_order,archived_at,created_at,updated_at",
      )
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("settings")
      .select("tdee_calories,protein_target_g,carbs_target_g,fat_target_g,fiber_target_g")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("weight_logs")
      .select("id,date,weight_lbs,created_at,updated_at")
      .eq("user_id", userId)
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

export async function getShiftlyCalTrendsData(opts?: {
  weekStartIso?: string;
}): Promise<ShiftlyCalTrendsData> {
  const weekData = await getShiftlyCalData(opts);
  const { supabase, user } = await requireUser();
  return loadShiftlyCalTrendsData(supabase, user.id, weekData);
}

export async function getShiftlyCalTrendsDataForUser(
  userId: string,
  opts?: { weekStartIso?: string },
): Promise<ShiftlyCalTrendsData> {
  const weekData = await getShiftlyCalDataForUser(userId, opts);
  return loadShiftlyCalTrendsData(createAdminClient(), userId, weekData);
}

export async function getShiftlyCalHistoryData(): Promise<ShiftlyCalHistoryData> {
  const { supabase, user } = await requireUser();
  const todayIso = getTodayIso();
  const currentWeekStartIso = getSundayOnOrBeforeTodayIso();
  const firstWeekStartIso = addDaysIso(currentWeekStartIso, -77);
  const currentWeekEndIso = addDaysIso(currentWeekStartIso, 6);

  const [entriesRes, settingsRes, weightRes] = await Promise.all([
    supabase
      .from("food_entries")
      .select(
        "id,date,logged_time,meal_name,category,calories,protein_g,carbs_g,fat_g,fiber_g,saved_food_id,created_at,updated_at",
      )
      .eq("user_id", user.id)
      .gte("date", firstWeekStartIso)
      .lte("date", currentWeekEndIso)
      .order("date", { ascending: true })
      .order("logged_time", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("settings")
      .select("tdee_calories,protein_target_g,carbs_target_g,fat_target_g,fiber_target_g")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("weight_logs")
      .select("id,date,weight_lbs,created_at,updated_at")
      .eq("user_id", user.id)
      .gte("date", firstWeekStartIso)
      .lte("date", currentWeekEndIso)
      .order("date", { ascending: true }),
  ]);

  if (entriesRes.error) throw new Error(`Food entries: ${entriesRes.error.message}`);
  if (settingsRes.error) throw new Error(`Cal targets: ${settingsRes.error.message}`);
  if (weightRes.error) throw new Error(`Weight log: ${weightRes.error.message}`);

  const entries = ((entriesRes.data ?? []) as FoodEntryRow[]).map(mapFoodEntry);
  const weights = ((weightRes.data ?? []) as WeightLogRow[]).map(mapWeightLog);
  const targets = mapTargets((settingsRes.data ?? null) as SettingsTargetsRow | null);
  const weeks = Array.from({ length: 12 }, (_, index) => {
    const weekStartIso = addDaysIso(currentWeekStartIso, index * -7);
    return buildHistoryWeek(weekStartIso, entries, weights);
  });
  const loggedWeeks = weeks.filter((week) => week.daysLogged > 0);
  const weightDeltas = weeks
    .map((week) => week.weightDeltaLbs)
    .filter((value): value is number => value !== null);

  return {
    todayIso,
    targets,
    weeks,
    summary: {
      weekCount: loggedWeeks.length,
      avgWeeklyCalories: Math.round(
        average(loggedWeeks.map((week) => week.totals.calories)),
      ),
      avgWeeklyProteinG: Math.round(
        average(loggedWeeks.map((week) => week.totals.proteinG)),
      ),
      avgWeeklyFiberG: Math.round(
        average(loggedWeeks.map((week) => week.totals.fiberG)),
      ),
      avgWeeklyWeightDeltaLbs:
        weightDeltas.length === 0 ? null : round1(average(weightDeltas)),
    },
  };
}

async function loadShiftlyCalTrendsData(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  weekData: ShiftlyCalData,
): Promise<ShiftlyCalTrendsData> {
  const trendStartIso = addDaysIso(weekData.todayIso, -27);

  const [entriesRes, weightRes] = await Promise.all([
    supabase
      .from("food_entries")
      .select("date,calories,protein_g,carbs_g,fat_g,fiber_g")
      .eq("user_id", userId)
      .gte("date", trendStartIso)
      .lte("date", weekData.todayIso)
      .order("date", { ascending: true }),
    supabase
      .from("weight_logs")
      .select("date,weight_lbs")
      .eq("user_id", userId)
      .gte("date", trendStartIso)
      .lte("date", weekData.todayIso)
      .order("date", { ascending: true }),
  ]);

  if (entriesRes.error) {
    throw new Error(`Food entries: ${entriesRes.error.message}`);
  }
  if (weightRes.error) {
    throw new Error(`Weight: ${weightRes.error.message}`);
  }

  const caloriesByDate = new Map<
    string,
    {
      calories: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      fiberG: number;
      entryCount: number;
    }
  >();
  for (const row of (entriesRes.data ?? []) as TrendFoodEntryRow[]) {
    const existing = caloriesByDate.get(row.date) ?? {
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      entryCount: 0,
    };
    caloriesByDate.set(row.date, {
      calories: existing.calories + Number(row.calories),
      proteinG: existing.proteinG + Number(row.protein_g ?? 0),
      carbsG: existing.carbsG + Number(row.carbs_g ?? 0),
      fatG: existing.fatG + Number(row.fat_g ?? 0),
      fiberG: existing.fiberG + Number(row.fiber_g ?? 0),
      entryCount: existing.entryCount + 1,
    });
  }

  const weightByDate = new Map<string, number>(
    ((weightRes.data ?? []) as TrendWeightLogRow[]).map((row) => [
      row.date,
      Number(row.weight_lbs),
    ]),
  );

  return {
    todayIso: weekData.todayIso,
    targets: weekData.targets,
    savedFoods: weekData.savedFoods,
    currentWeek: weekData.currentWeek,
    trendDays: Array.from({ length: 28 }, (_, index) => {
      const date = addDaysIso(trendStartIso, index);
      const sums = caloriesByDate.get(date);

      return {
        date,
        calories: sums?.calories ?? 0,
        proteinG: sums?.proteinG ?? 0,
        carbsG: sums?.carbsG ?? 0,
        fatG: sums?.fatG ?? 0,
        fiberG: sums?.fiberG ?? 0,
        entryCount: sums?.entryCount ?? 0,
        weightLbs: weightByDate.get(date) ?? null,
      };
    }),
  };
}

function normalizeWeekStartIso(value: string | undefined): string {
  if (!value) return getSundayOnOrBeforeTodayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return getSundayOnOrBeforeTodayIso();

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return getSundayOnOrBeforeTodayIso();

  return value;
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
      fiberG: totals.fiberG + (entry.fiberG ?? 0),
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
    fiberG: left.fiberG + right.fiberG,
  };
}

function emptyTotals(): CalTotals {
  return { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
}

function mapTargets(row: SettingsTargetsRow | null): CalTargets {
  return {
    tdeeCalories: row?.tdee_calories ?? null,
    proteinTargetG: row?.protein_target_g ?? null,
    carbsTargetG: row?.carbs_target_g ?? null,
    fatTargetG: row?.fat_target_g ?? null,
    fiberTargetG: row?.fiber_target_g ?? null,
  };
}

function mapFoodEntry(row: FoodEntryRow): FoodEntry {
  return {
    id: row.id,
    date: row.date,
    loggedTime: row.logged_time,
    mealName: row.meal_name,
    category: mapCategory(row.category),
    calories: Number(row.calories),
    proteinG: nullableNumber(row.protein_g),
    carbsG: nullableNumber(row.carbs_g),
    fatG: nullableNumber(row.fat_g),
    fiberG: nullableNumber(row.fiber_g),
    savedFoodId: row.saved_food_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSavedFood(row: SavedFoodRow): SavedFood {
  return {
    id: row.id,
    name: row.name,
    category: mapCategory(row.category),
    calories: Number(row.calories),
    proteinG: nullableNumber(row.protein_g),
    carbsG: nullableNumber(row.carbs_g),
    fatG: nullableNumber(row.fat_g),
    fiberG: nullableNumber(row.fiber_g),
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

function mapCategory(value: string | null): FoodCategory {
  switch (value) {
    case "healthy_snack":
    case "unhealthy_snack":
    case "drink":
    case "other":
      return value;
    case "meal":
    default:
      return "meal";
  }
}

function buildHistoryWeek(
  weekStartIso: string,
  entries: FoodEntry[],
  weights: WeightLog[],
): CalHistoryWeek {
  const weekEndIso = addDaysIso(weekStartIso, 6);
  const weekEntries = entries.filter(
    (entry) => entry.date >= weekStartIso && entry.date <= weekEndIso,
  );
  const weekWeights = weights.filter(
    (weight) => weight.date >= weekStartIso && weight.date <= weekEndIso,
  );
  const totals = sumTotals(weekEntries);
  const daysLogged = new Set(weekEntries.map((entry) => entry.date)).size;
  const weightStartLbs = weekWeights[0]?.weightLbs ?? null;
  const weightEndLbs = weekWeights.at(-1)?.weightLbs ?? null;

  return {
    weekStartIso,
    weekEndIso,
    totals,
    avgDailyLogged: averageTotals(totals, daysLogged),
    daysLogged,
    entryCount: weekEntries.length,
    weightStartLbs,
    weightEndLbs,
    weightDeltaLbs:
      weightStartLbs === null || weightEndLbs === null
        ? null
        : round1(weightEndLbs - weightStartLbs),
  };
}

function averageTotals(totals: CalTotals, daysLogged: number): CalTotals {
  const divisor = daysLogged || 1;

  return {
    calories: Math.round(totals.calories / divisor),
    proteinG: Math.round(totals.proteinG / divisor),
    carbsG: Math.round(totals.carbsG / divisor),
    fatG: Math.round(totals.fatG / divisor),
    fiberG: Math.round(totals.fiberG / divisor),
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
