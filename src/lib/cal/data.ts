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
  CalPhase,
  CalSex,
  CalTargets,
  CalTotals,
  FoodCategory,
  FoodEntry,
  FoodVerdict,
  FoodVerdictContext,
  FoodVerdictSource,
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
  verdict: string | null;
  verdict_reason: string | null;
  verdict_source: string | null;
  verdict_context: FoodVerdictContext | null;
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
  age: number | null;
  sex: string | null;
  height_cm: number | string | null;
  activity_level: string | null;
  current_phase: string | null;
  goals_text: string | null;
  health_flags: string[] | null;
};

type TrendFoodEntryRow = {
  date: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  verdict: string | null;
  verdict_source: string | null;
  verdict_context: FoodVerdictContext | null;
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
  verdictCounts: CalVerdictCounts;
  estimatedFacets: CalTrendEstimatedFacets;
  weightLbs: number | null;
};

export type CalVerdictCounts = {
  good: number;
  fine: number;
  bad: number;
  unscored: number;
  manualOverride: number;
};

export type CalTrendEstimatedFacets = {
  sodiumMgEstimated: number | null;
  addedSugarGEstimated: number | null;
  alcoholServingsEstimated: number | null;
  highSodium: boolean;
  highAddedSugar: boolean;
};

export type VerdictSummary = CalVerdictCounts & {
  estimatedFacetsWeek: {
    sodiumMgEstimated: number | null;
    addedSugarGEstimated: number | null;
    alcoholServingsEstimated: number | null;
    highSodiumDays: number;
    highAddedSugarDays: number;
  };
};

export type ShiftlyCalTrendsData = {
  todayIso: string;
  targets: CalTargets;
  savedFoods: SavedFood[];
  trendDays: CalTrendDay[];
  currentWeek: ShiftlyCalData["currentWeek"];
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
        "id,date,logged_time,meal_name,category,calories,protein_g,carbs_g,fat_g,fiber_g,saved_food_id,verdict,verdict_reason,verdict_source,verdict_context,created_at,updated_at",
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
      .select("tdee_calories,protein_target_g,carbs_target_g,fat_target_g,fiber_target_g,age,sex,height_cm,activity_level,current_phase,goals_text,health_flags")
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
    dailyTargetBand: buildDailyTargetBand(targets.tdeeCalories),
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

async function loadShiftlyCalTrendsData(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  weekData: ShiftlyCalData,
): Promise<ShiftlyCalTrendsData> {
  const trendStartIso = addDaysIso(weekData.todayIso, -27);

  const [entriesRes, weightRes] = await Promise.all([
    supabase
      .from("food_entries")
      .select("date,calories,protein_g,carbs_g,fat_g,fiber_g,verdict,verdict_source,verdict_context")
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
      verdictCounts: CalVerdictCounts;
      estimatedFacets: CalTrendEstimatedFacets;
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
      verdictCounts: emptyVerdictCounts(),
      estimatedFacets: emptyTrendEstimatedFacets(),
    };
    const verdictCounts = { ...existing.verdictCounts };
    addVerdictToCounts(verdictCounts, mapVerdict(row.verdict), mapVerdictSource(row.verdict_source));
    const estimatedFacets = addTrendEstimatedFacets(
      existing.estimatedFacets,
      row.verdict_context ?? null,
    );
    caloriesByDate.set(row.date, {
      calories: existing.calories + Number(row.calories),
      proteinG: existing.proteinG + Number(row.protein_g ?? 0),
      carbsG: existing.carbsG + Number(row.carbs_g ?? 0),
      fatG: existing.fatG + Number(row.fat_g ?? 0),
      fiberG: existing.fiberG + Number(row.fiber_g ?? 0),
      entryCount: existing.entryCount + 1,
      verdictCounts,
      estimatedFacets,
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
        verdictCounts: sums?.verdictCounts ?? emptyVerdictCounts(),
        estimatedFacets: sums?.estimatedFacets ?? emptyTrendEstimatedFacets(),
        weightLbs: weightByDate.get(date) ?? null,
      };
    }),
  };
}

export function summarizeVerdicts(entries: FoodEntry[]): VerdictSummary {
  const counts = emptyVerdictCounts();
  const facetSums = {
    sodiumMgEstimated: null as number | null,
    addedSugarGEstimated: null as number | null,
    alcoholServingsEstimated: null as number | null,
  };
  const highSodiumDays = new Set<string>();
  const highAddedSugarDays = new Set<string>();

  for (const entry of entries) {
    addVerdictToCounts(counts, entry.verdict, entry.verdictSource);
    const facets = entry.verdictContext?.estimated_facets;
    if (!facets) continue;

    facetSums.sodiumMgEstimated = addNullableNumber(
      facetSums.sodiumMgEstimated,
      facets.sodium_mg,
    );
    facetSums.addedSugarGEstimated = addNullableNumber(
      facetSums.addedSugarGEstimated,
      facets.added_sugar_g,
    );
    facetSums.alcoholServingsEstimated = addNullableNumber(
      facetSums.alcoholServingsEstimated,
      facets.alcohol_servings,
    );
    if (facets.high_sodium === true) highSodiumDays.add(entry.date);
    if (facets.high_added_sugar === true) highAddedSugarDays.add(entry.date);
  }

  return {
    ...counts,
    estimatedFacetsWeek: {
      ...facetSums,
      highSodiumDays: highSodiumDays.size,
      highAddedSugarDays: highAddedSugarDays.size,
    },
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

function emptyVerdictCounts(): CalVerdictCounts {
  return { good: 0, fine: 0, bad: 0, unscored: 0, manualOverride: 0 };
}

function emptyTrendEstimatedFacets(): CalTrendEstimatedFacets {
  return {
    sodiumMgEstimated: null,
    addedSugarGEstimated: null,
    alcoholServingsEstimated: null,
    highSodium: false,
    highAddedSugar: false,
  };
}

function addVerdictToCounts(
  counts: CalVerdictCounts,
  verdict: FoodVerdict | null,
  verdictSource: FoodVerdictSource,
) {
  if (verdictSource === "manual_override") counts.manualOverride += 1;

  if (verdict === "good" || verdict === "fine" || verdict === "bad") {
    counts[verdict] += 1;
    return;
  }

  if (verdictSource === "pending" || verdictSource === "unscored") {
    counts.unscored += 1;
  }
}

function addTrendEstimatedFacets(
  existing: CalTrendEstimatedFacets,
  verdictContext: FoodVerdictContext | null,
): CalTrendEstimatedFacets {
  const facets = verdictContext?.estimated_facets;
  if (!facets) return existing;

  return {
    sodiumMgEstimated: addNullableNumber(
      existing.sodiumMgEstimated,
      facets.sodium_mg,
    ),
    addedSugarGEstimated: addNullableNumber(
      existing.addedSugarGEstimated,
      facets.added_sugar_g,
    ),
    alcoholServingsEstimated: addNullableNumber(
      existing.alcoholServingsEstimated,
      facets.alcohol_servings,
    ),
    highSodium: existing.highSodium || facets.high_sodium === true,
    highAddedSugar:
      existing.highAddedSugar || facets.high_added_sugar === true,
  };
}

function addNullableNumber(
  current: number | null,
  value: number | null | undefined,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return current;
  return (current ?? 0) + value;
}

function mapTargets(row: SettingsTargetsRow | null): CalTargets {
  return {
    tdeeCalories: row?.tdee_calories ?? null,
    proteinTargetG: row?.protein_target_g ?? null,
    carbsTargetG: row?.carbs_target_g ?? null,
    fatTargetG: row?.fat_target_g ?? null,
    fiberTargetG: row?.fiber_target_g ?? null,
    age: row?.age ?? null,
    sex: mapSex(row?.sex ?? null),
    heightCm: row?.height_cm === null || row?.height_cm === undefined
      ? null
      : Number(row.height_cm),
    activityLevel: row?.activity_level ?? null,
    currentPhase: mapPhase(row?.current_phase ?? null),
    goalsText: row?.goals_text ?? null,
    healthFlags: Array.isArray(row?.health_flags) ? row.health_flags : [],
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
    verdict: mapVerdict(row.verdict),
    verdictReason: row.verdict_reason,
    verdictSource: mapVerdictSource(row.verdict_source),
    verdictContext: row.verdict_context ?? null,
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

function buildDailyTargetBand(tdeeCalories: number | null) {
  return {
    low: tdeeCalories === null ? null : Math.round(tdeeCalories * 0.85),
    high: tdeeCalories === null ? null : Math.round(tdeeCalories * 1.15),
  };
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

function mapVerdict(value: string | null): FoodVerdict | null {
  if (value === "good" || value === "fine" || value === "bad") return value;
  return null;
}

function mapVerdictSource(value: string | null): FoodVerdictSource {
  if (
    value === "pending" ||
    value === "ai" ||
    value === "manual_override" ||
    value === "unscored"
  ) {
    return value;
  }

  return "pending";
}

function mapSex(value: string | null): CalSex | null {
  if (value === "male" || value === "female") return value;
  return null;
}

function mapPhase(value: string | null): CalPhase | null {
  if (
    value === "cut" ||
    value === "maintain" ||
    value === "bulk" ||
    value === "recomp"
  ) {
    return value;
  }

  return null;
}
