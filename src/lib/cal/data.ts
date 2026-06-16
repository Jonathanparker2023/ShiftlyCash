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
import { applyShiftlyCalProjectionMaintenance } from "@/lib/cal/projectionMaintenance";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CalDay,
  CalPhase,
  CalSex,
  CalTargets,
  CalTotals,
  DayFoodVerdict,
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
  sodium_mg: number | null;
  added_sugar_g: number | null;
  saturated_fat_g: number | null;
  saved_food_id: string | null;
  verdict: string | null;
  verdict_reason: string | null;
  verdict_source: string | null;
  verdict_error: string | null;
  verdict_context: FoodVerdictContext | null;
  is_projected_plan: boolean | null;
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
  sodium_mg: number | null;
  added_sugar_g: number | null;
  saturated_fat_g: number | null;
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

type WaterLogRow = {
  id: string;
  date: string;
  amount_oz: number;
  created_at: string;
  updated_at: string;
};

type SettingsTargetsRow = {
  tdee_calories: number | null;
  protein_target_g: number | null;
  carbs_target_g: number | null;
  fat_target_g: number | null;
  fiber_target_g: number | null;
  sodium_target_mg: number | null;
  added_sugar_target_g: number | null;
  saturated_fat_target_g: number | null;
  water_target_oz: number | null;
  age: number | null;
  sex: string | null;
  height_cm: number | string | null;
  activity_level: string | null;
  current_phase: string | null;
  goals_text: string | null;
  health_flags: string[] | null;
  banned_foods: string[] | null;
};

type DayFoodVerdictRow = {
  id: string;
  date: string;
  verdict: string;
  reason: string;
  calorie_total: number;
  protein_total: number;
  within_calorie_tolerance: boolean;
  within_protein_target: boolean;
  generated_at: string;
};

type TrendFoodEntryRow = {
  date: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sodium_mg: number | null;
  added_sugar_g: number | null;
  saturated_fat_g: number | null;
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
  sodiumMg: number;
  addedSugarG: number;
  saturatedFatG: number;
  waterOz: number;
  entryCount: number;
  verdictCounts: CalVerdictCounts;
  estimatedFacets: CalTrendEstimatedFacets;
  weightLbs: number | null;
};

export type CalVerdictCounts = {
  good: number;
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

  const settingsRes = await supabase
    .from("settings")
    .select("tdee_calories,protein_target_g,carbs_target_g,fat_target_g,fiber_target_g,sodium_target_mg,added_sugar_target_g,saturated_fat_target_g,water_target_oz,age,sex,height_cm,activity_level,current_phase,goals_text,health_flags,banned_foods")
    .eq("user_id", userId)
    .maybeSingle();

  if (settingsRes.error) throw new Error(`Cal targets: ${settingsRes.error.message}`);

  const targets = mapTargets((settingsRes.data ?? null) as SettingsTargetsRow | null);

  await applyShiftlyCalProjectionMaintenance(supabase, {
    userId,
    weekStartIso,
    weekEndIso,
    todayIso,
    targets,
  });

  const [entriesRes, savedFoodsRes, weightRes, waterRes, dayVerdictsRes] =
    await Promise.all([
    supabase
      .from("food_entries")
      .select(
        "id,date,logged_time,meal_name,category,calories,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,added_sugar_g,saturated_fat_g,saved_food_id,verdict,verdict_reason,verdict_source,verdict_error,verdict_context,is_projected_plan,created_at,updated_at",
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
        "id,name,category,calories,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,added_sugar_g,saturated_fat_g,sort_order,archived_at,created_at,updated_at",
      )
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("weight_logs")
      .select("id,date,weight_lbs,created_at,updated_at")
      .eq("user_id", userId)
      .gte("date", weekStartIso)
      .lte("date", weekEndIso),
    supabase
      .from("water_logs")
      .select("id,date,amount_oz,created_at,updated_at")
      .eq("user_id", userId)
      .gte("date", weekStartIso)
      .lte("date", weekEndIso),
    supabase
      .from("day_food_verdicts")
      .select(
        "id,date,verdict,reason,calorie_total,protein_total,within_calorie_tolerance,within_protein_target,generated_at",
      )
      .eq("user_id", userId)
      .gte("date", weekStartIso)
      .lte("date", weekEndIso),
  ]);

  if (entriesRes.error) throw new Error(`Food entries: ${entriesRes.error.message}`);
  if (savedFoodsRes.error) throw new Error(`Saved foods: ${savedFoodsRes.error.message}`);
  if (weightRes.error) throw new Error(`Weight log: ${weightRes.error.message}`);
  if (waterRes.error) throw new Error(`Water log: ${waterRes.error.message}`);
  if (dayVerdictsRes.error) {
    throw new Error(`Day food verdicts: ${dayVerdictsRes.error.message}`);
  }

  const entries = ((entriesRes.data ?? []) as FoodEntryRow[]).map(mapFoodEntry);
  const weights = ((weightRes.data ?? []) as WeightLogRow[]).map(mapWeightLog);
  const currentWeek = buildCalWeek(
    weekStartIso,
    weekEndIso,
    entries,
    weights,
    (waterRes.data ?? []) as WaterLogRow[],
    ((dayVerdictsRes.data ?? []) as DayFoodVerdictRow[]).map(mapDayFoodVerdict),
    targets,
  );
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

  const [entriesRes, weightRes, waterRes] = await Promise.all([
    supabase
      .from("food_entries")
      .select("date,calories,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,added_sugar_g,saturated_fat_g,verdict,verdict_source,verdict_context")
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
    supabase
      .from("water_logs")
      .select("date,amount_oz")
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
  if (waterRes.error) {
    throw new Error(`Water: ${waterRes.error.message}`);
  }

  const caloriesByDate = new Map<
    string,
    {
      calories: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      fiberG: number;
      sodiumMg: number;
      addedSugarG: number;
      saturatedFatG: number;
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
      sodiumMg: 0,
      addedSugarG: 0,
      saturatedFatG: 0,
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
      sodiumMg: existing.sodiumMg + Number(row.sodium_mg ?? 0),
      addedSugarG: existing.addedSugarG + Number(row.added_sugar_g ?? 0),
      saturatedFatG: existing.saturatedFatG + Number(row.saturated_fat_g ?? 0),
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
  const waterByDate = new Map<string, number>();
  for (const row of (waterRes.data ?? []) as Array<{ date: string; amount_oz: number }>) {
    waterByDate.set(row.date, (waterByDate.get(row.date) ?? 0) + Number(row.amount_oz));
  }

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
        sodiumMg: sums?.sodiumMg ?? 0,
        addedSugarG: sums?.addedSugarG ?? 0,
        saturatedFatG: sums?.saturatedFatG ?? 0,
        waterOz: waterByDate.get(date) ?? 0,
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
    facetSums.sodiumMgEstimated = addNullableNumber(
      facetSums.sodiumMgEstimated,
      entry.sodiumMg ?? entry.verdictContext?.estimated_facets?.sodium_mg,
    );
    facetSums.addedSugarGEstimated = addNullableNumber(
      facetSums.addedSugarGEstimated,
      entry.addedSugarG ?? entry.verdictContext?.estimated_facets?.added_sugar_g,
    );
    const facets = entry.verdictContext?.estimated_facets;
    if (!facets) continue;

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
  waterLogs: WaterLogRow[],
  dayVerdicts: DayFoodVerdict[],
  targets: CalTargets,
) {
  const entriesByDate = groupByDate(entries);
  const weightsByDate = new Map(weights.map((weight) => [weight.date, weight]));
  const dayVerdictsByDate = new Map(
    dayVerdicts.map((verdict) => [verdict.date, verdict]),
  );
  const waterByDate = new Map<string, number>();
  for (const log of waterLogs) {
    waterByDate.set(log.date, (waterByDate.get(log.date) ?? 0) + Number(log.amount_oz));
  }
  const days: CalDay[] = Array.from({ length: 7 }, (_, dayIndex) => {
    const date = addDaysIso(weekStartIso, dayIndex);
    const dayEntries = entriesByDate.get(date) ?? [];
    const totals = sumTotals(dayEntries);

    return {
      date,
      dayIndex,
      entries: dayEntries,
      totals,
      dayVerdict: normalizeDayVerdictForCurrentTargets(
        dayVerdictsByDate.get(date) ?? null,
        totals,
        targets,
      ),
      weight: weightsByDate.get(date) ?? null,
      waterOz: waterByDate.get(date) ?? 0,
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
      sodiumMg: totals.sodiumMg + (entry.sodiumMg ?? 0),
      addedSugarG: totals.addedSugarG + (entry.addedSugarG ?? 0),
      saturatedFatG: totals.saturatedFatG + (entry.saturatedFatG ?? 0),
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
    sodiumMg: left.sodiumMg + right.sodiumMg,
    addedSugarG: left.addedSugarG + right.addedSugarG,
    saturatedFatG: left.saturatedFatG + right.saturatedFatG,
  };
}

function normalizeDayVerdictForCurrentTargets(
  verdict: DayFoodVerdict | null,
  totals: CalTotals,
  targets: CalTargets,
): DayFoodVerdict | null {
  if (!verdict || targets.tdeeCalories === null || targets.proteinTargetG === null) {
    return verdict;
  }

  const withinCalorieTolerance =
    totals.calories >= targets.tdeeCalories * 0.9 &&
    totals.calories <= targets.tdeeCalories * 1.1;
  const withinProteinTarget = totals.proteinG >= targets.proteinTargetG * 0.9;
  const nextVerdict =
    withinCalorieTolerance && withinProteinTarget ? "good" : "bad";

  return {
    ...verdict,
    verdict: nextVerdict,
    calorieTotal: Math.round(totals.calories),
    proteinTotal: Math.round(totals.proteinG),
    withinCalorieTolerance,
    withinProteinTarget,
  };
}

function emptyTotals(): CalTotals {
  return {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    sodiumMg: 0,
    addedSugarG: 0,
    saturatedFatG: 0,
  };
}

function emptyVerdictCounts(): CalVerdictCounts {
  return { good: 0, bad: 0, unscored: 0, manualOverride: 0 };
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

  if (verdict === "good" || verdict === "bad") {
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
    carbsTargetG: row?.carbs_target_g ?? 120,
    fatTargetG: row?.fat_target_g ?? null,
    fiberTargetG: row?.fiber_target_g ?? null,
    sodiumTargetMg: row?.sodium_target_mg ?? 2300,
    addedSugarTargetG: row?.added_sugar_target_g ?? 36,
    saturatedFatTargetG: row?.saturated_fat_target_g ?? 20,
    waterTargetOz: row?.water_target_oz ?? 100,
    age: row?.age ?? null,
    sex: mapSex(row?.sex ?? null),
    heightCm: row?.height_cm === null || row?.height_cm === undefined
      ? null
      : Number(row.height_cm),
    activityLevel: row?.activity_level ?? null,
    currentPhase: mapPhase(row?.current_phase ?? null),
    goalsText: row?.goals_text ?? null,
    healthFlags: Array.isArray(row?.health_flags) ? row.health_flags : [],
    bannedFoods: Array.isArray(row?.banned_foods) ? row.banned_foods : [],
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
    sodiumMg: nullableNumber(row.sodium_mg),
    addedSugarG: nullableNumber(row.added_sugar_g),
    saturatedFatG: nullableNumber(row.saturated_fat_g),
    savedFoodId: row.saved_food_id,
    verdict: mapVerdict(row.verdict),
    verdictReason: row.verdict_reason,
    verdictSource: mapVerdictSource(row.verdict_source),
    verdictError: row.verdict_error,
    verdictContext: row.verdict_context ?? null,
    isProjectedPlan: row.is_projected_plan === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDayFoodVerdict(row: DayFoodVerdictRow): DayFoodVerdict {
  return {
    id: row.id,
    date: row.date,
    verdict: row.verdict === "good" ? "good" : "bad",
    reason: row.reason,
    calorieTotal: Number(row.calorie_total),
    proteinTotal: Number(row.protein_total),
    withinCalorieTolerance: row.within_calorie_tolerance === true,
    withinProteinTarget: row.within_protein_target === true,
    generatedAt: row.generated_at,
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
    sodiumMg: nullableNumber(row.sodium_mg),
    addedSugarG: nullableNumber(row.added_sugar_g),
    saturatedFatG: nullableNumber(row.saturated_fat_g),
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
    low: tdeeCalories === null ? null : Math.round(tdeeCalories * 0.95),
    high: tdeeCalories === null ? null : Math.round(tdeeCalories * 1.05),
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
  if (value === "good" || value === "bad") return value;
  if (value === "fine") return "bad";
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
