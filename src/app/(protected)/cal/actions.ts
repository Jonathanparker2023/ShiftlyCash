"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { requireUser } from "@/lib/auth";
import { estimateFood, type FoodEstimate } from "@/lib/cal/estimate";
import type { FoodCategory, FoodVerdict } from "@/lib/cal/types";
import { scoreEntry, type VerdictInput } from "@/lib/cal/verdict";
import { addDaysIso, getTodayIso } from "@/lib/dashboard/dates";
import { createAdminClient } from "@/lib/supabase/admin";

type NullableMacroInput = number | string | null | undefined;
const FOOD_CATEGORIES = new Set<FoodCategory>([
  "meal",
  "healthy_snack",
  "unhealthy_snack",
  "drink",
  "other",
]);
const FOOD_VERDICTS = new Set<FoodVerdict>(["good", "fine", "bad"]);
const JON_FALLBACK_WEIGHT_LBS = 201.9;

type VerdictEntryRow = {
  id: string;
  user_id: string;
  date: string;
  meal_name: string;
  category: string | null;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
};

type VerdictSettingsRow = {
  age: number | null;
  sex: string | null;
  height_cm: number | string | null;
  activity_level: string | null;
  current_phase: string | null;
  goals_text: string | null;
  health_flags: string[] | null;
  tdee_calories: number | null;
  protein_target_g: number | null;
  fiber_target_g: number | null;
};

type VerdictWeekEntryRow = {
  date: string;
  category: string | null;
  calories: number;
  protein_g: number | null;
  fiber_g: number | null;
};

export async function createFoodEntryAction(input: {
  date?: string;
  loggedTime?: string | null;
  mealName?: string | null;
  category?: FoodCategory | string | null;
  calories: number | string;
  proteinG?: NullableMacroInput;
  carbsG?: NullableMacroInput;
  fatG?: NullableMacroInput;
  fiberG?: NullableMacroInput;
  savedFoodId?: string | null;
}): Promise<{ ok: true; id: string }> {
  const { supabase, user } = await requireUser();
  const calories = requireNonNegativeInteger(input.calories, "Calories");
  const date = normalizeIsoDate(input.date);
  const mealName = input.mealName?.trim() ?? "";
  const category = parseCategory(input.category);

  const { data, error } = await supabase
    .from("food_entries")
    .insert({
      user_id: user.id,
      date,
      logged_time: normalizeTimeInput(input.loggedTime) ?? getCurrentLocalTimeHm(),
      meal_name: mealName,
      category,
      calories,
      protein_g: optionalNonNegativeInteger(input.proteinG, "Protein"),
      carbs_g: optionalNonNegativeInteger(input.carbsG, "Carbs"),
      fat_g: optionalNonNegativeInteger(input.fatG, "Fat"),
      fiber_g: optionalNonNegativeInteger(input.fiberG, "Fiber"),
      saved_food_id: input.savedFoodId || null,
      verdict: null,
      verdict_source: "pending",
      verdict_reason: null,
      verdict_context: null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  scheduleScoreFoodEntry(data.id, user.id);
  return { ok: true, id: data.id };
}

export async function estimateFoodAction(input: {
  description: string;
}): Promise<FoodEstimate> {
  await requireUser();
  return estimateFood(input.description);
}

export async function deleteFoodEntryAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("food_entries")
    .delete()
    .eq("user_id", user.id)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true };
}

export async function updateFoodEntryAction(input: {
  id: string;
  loggedTime?: string | null;
  mealName?: string | null;
  category?: FoodCategory | string | null;
  calories: number | string;
  proteinG?: NullableMacroInput;
  carbsG?: NullableMacroInput;
  fatG?: NullableMacroInput;
  fiberG?: NullableMacroInput;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const calories = requireNonNegativeInteger(input.calories, "Calories");

  const { data: current, error: currentError } = await supabase
    .from("food_entries")
    .select("verdict_source")
    .eq("user_id", user.id)
    .eq("id", input.id)
    .single();

  if (currentError) throw new Error(currentError.message);

  const { error } = await supabase
    .from("food_entries")
    .update({
      meal_name: input.mealName?.trim() ?? "",
      logged_time: normalizeTimeInput(input.loggedTime),
      category: parseCategory(input.category),
      calories,
      protein_g: optionalNonNegativeInteger(input.proteinG, "Protein"),
      carbs_g: optionalNonNegativeInteger(input.carbsG, "Carbs"),
      fat_g: optionalNonNegativeInteger(input.fatG, "Fat"),
      fiber_g: optionalNonNegativeInteger(input.fiberG, "Fiber"),
      ...(current?.verdict_source === "manual_override"
        ? {}
        : {
            verdict: null,
            verdict_reason: null,
            verdict_source: "pending",
            verdict_context: null,
          }),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  if (current?.verdict_source !== "manual_override") {
    scheduleScoreFoodEntry(input.id, user.id);
  }
  return { ok: true };
}

export async function regenerateVerdictAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("food_entries")
    .update({
      verdict: null,
      verdict_reason: null,
      verdict_source: "pending",
      verdict_context: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  scheduleScoreFoodEntry(input.id, user.id);
  return { ok: true };
}

export async function overrideVerdictAction(input: {
  id: string;
  verdict: FoodVerdict | string;
  verdictReason?: string | null;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const verdict = parseVerdict(input.verdict);

  const { error } = await supabase
    .from("food_entries")
    .update({
      verdict,
      verdict_reason: input.verdictReason?.trim() || null,
      verdict_source: "manual_override",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true };
}

export async function createSavedFoodAction(input: {
  name: string;
  category?: FoodCategory | string | null;
  calories: number | string;
  proteinG?: NullableMacroInput;
  carbsG?: NullableMacroInput;
  fatG?: NullableMacroInput;
  fiberG?: NullableMacroInput;
}): Promise<{ ok: true; id: string }> {
  const { supabase, user } = await requireUser();
  const name = input.name.trim();
  if (!name) throw new Error("Saved food name is required.");

  const { data: maxRow, error: maxError } = await supabase
    .from("saved_foods")
    .select("sort_order")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) throw new Error(maxError.message);

  const { data, error } = await supabase
    .from("saved_foods")
    .insert({
      user_id: user.id,
      name,
      category: parseCategory(input.category),
      calories: requireNonNegativeInteger(input.calories, "Calories"),
      protein_g: optionalNonNegativeInteger(input.proteinG, "Protein"),
      carbs_g: optionalNonNegativeInteger(input.carbsG, "Carbs"),
      fat_g: optionalNonNegativeInteger(input.fatG, "Fat"),
      fiber_g: optionalNonNegativeInteger(input.fiberG, "Fiber"),
      sort_order: Number(maxRow?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true, id: data.id };
}

export async function archiveSavedFoodAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("saved_foods")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true };
}

export async function logWeightAction(input: {
  date?: string;
  weightLbs: number | string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const weightLbs = Number(input.weightLbs);
  if (!Number.isFinite(weightLbs) || weightLbs <= 0) {
    throw new Error("Weight must be greater than zero.");
  }

  const { error } = await supabase.from("weight_logs").upsert(
    {
      user_id: user.id,
      date: normalizeIsoDate(input.date),
      weight_lbs: weightLbs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,date" },
  );

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true };
}

export async function saveCalTargetsAction(input: {
  tdeeCalories?: NullableMacroInput;
  proteinTargetG?: NullableMacroInput;
  carbsTargetG?: NullableMacroInput;
  fatTargetG?: NullableMacroInput;
  fiberTargetG?: NullableMacroInput;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("settings")
    .update({
      tdee_calories: optionalPositiveInteger(input.tdeeCalories, "TDEE"),
      protein_target_g: optionalNonNegativeInteger(input.proteinTargetG, "Protein target"),
      carbs_target_g: optionalNonNegativeInteger(input.carbsTargetG, "Carbs target"),
      fat_target_g: optionalNonNegativeInteger(input.fatTargetG, "Fat target"),
      fiber_target_g: optionalPositiveInteger(input.fiberTargetG, "Fiber target"),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true };
}

function normalizeIsoDate(value: string | null | undefined): string {
  if (!value) {
    return getTodayIso();
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date must be an ISO date.");
  }

  return value;
}

function normalizeTimeInput(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error("Time must be HH:mm.");
  }

  const [hours, minutes] = value.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error("Time must be HH:mm.");
  }

  return value;
}

function getCurrentLocalTimeHm(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: process.env.SHIFTLYCASH_TIME_ZONE ?? "America/New_York",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

function requireNonNegativeInteger(value: number | string, label: string): number {
  const parsed = parseInteger(value);
  if (parsed === null || parsed < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
  return parsed;
}

function optionalPositiveInteger(value: NullableMacroInput, label: string): number | null {
  const parsed = parseInteger(value);
  if (parsed === null) return null;
  if (parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function optionalNonNegativeInteger(value: NullableMacroInput, label: string): number | null {
  const parsed = parseInteger(value);
  if (parsed === null) return null;
  if (parsed < 0) throw new Error(`${label} must be zero or greater.`);
  return parsed;
}

function parseCategory(value: FoodCategory | string | null | undefined): FoodCategory {
  if (value === null || value === undefined || value === "") return "meal";
  if (FOOD_CATEGORIES.has(value as FoodCategory)) return value as FoodCategory;
  throw new Error("Unknown food category.");
}

function parseVerdict(value: FoodVerdict | string): FoodVerdict {
  if (FOOD_VERDICTS.has(value as FoodVerdict)) return value as FoodVerdict;
  throw new Error("Unknown verdict.");
}

function parseInteger(value: NullableMacroInput): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error("Whole numbers only.");
  return parsed;
}

function scheduleScoreFoodEntry(entryId: string, userId: string) {
  after(async () => {
    await scoreEntryAndUpdate(entryId, userId);
  });
}

async function scoreEntryAndUpdate(entryId: string, userId: string) {
  const supabase = createAdminClient();

  try {
    const input = await buildVerdictInput(supabase, entryId, userId);
    const result = await scoreEntry(input);

    const { error } = await supabase
      .from("food_entries")
      .update({
        verdict: result.verdict,
        verdict_reason: result.verdict_reason,
        verdict_source: "ai",
        verdict_context: result.verdict_context,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("id", entryId);

    if (error) throw new Error(error.message);
  } catch {
    await supabase
      .from("food_entries")
      .update({
        verdict: null,
        verdict_reason: null,
        verdict_source: "unscored",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("id", entryId);
  }

  revalidatePath("/cal");
}

async function buildVerdictInput(
  supabase: ReturnType<typeof createAdminClient>,
  entryId: string,
  userId: string,
): Promise<VerdictInput> {
  const { data: entry, error: entryError } = await supabase
    .from("food_entries")
    .select("id,user_id,date,meal_name,category,calories,protein_g,carbs_g,fat_g,fiber_g")
    .eq("user_id", userId)
    .eq("id", entryId)
    .single();

  if (entryError || !entry) {
    throw new Error(entryError?.message ?? "Food entry not found.");
  }

  const row = entry as VerdictEntryRow;
  const weekStartIso = getSundayOnOrBeforeIso(row.date);
  const weekEndIso = addDaysIso(weekStartIso, 6);

  const [settingsRes, weekEntriesRes, weightRes] = await Promise.all([
    supabase
      .from("settings")
      .select(
        "age,sex,height_cm,activity_level,current_phase,goals_text,health_flags,tdee_calories,protein_target_g,fiber_target_g",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("food_entries")
      .select("date,category,calories,protein_g,fiber_g")
      .eq("user_id", userId)
      .gte("date", weekStartIso)
      .lte("date", weekEndIso),
    supabase
      .from("weight_logs")
      .select("weight_lbs")
      .eq("user_id", userId)
      .lte("date", row.date)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (settingsRes.error) throw new Error(settingsRes.error.message);
  if (weekEntriesRes.error) throw new Error(weekEntriesRes.error.message);
  if (weightRes.error) throw new Error(weightRes.error.message);

  const settings = (settingsRes.data ?? {}) as Partial<VerdictSettingsRow>;
  const weekRows = (weekEntriesRes.data ?? []) as VerdictWeekEntryRow[];
  const tdee = Number(settings.tdee_calories ?? 1650);
  const proteinTarget = Number(settings.protein_target_g ?? 180);
  const fiberTarget = Number(settings.fiber_target_g ?? 30);
  const todayRows = weekRows.filter((item) => item.date === row.date);
  const dayTotals = totalRows(todayRows);
  const weekTotals = totalRows(weekRows);
  const dayTotalsByDate = new Map<string, number>();
  const countsByCategory = emptyCategoryCounts();

  for (const item of weekRows) {
    dayTotalsByDate.set(
      item.date,
      (dayTotalsByDate.get(item.date) ?? 0) + Number(item.calories),
    );
    const category = parseCategory(item.category);
    countsByCategory[category] += 1;
  }

  const dayCalories = [...dayTotalsByDate.values()];

  return {
    entry: {
      mealName: row.meal_name,
      category: parseCategory(row.category),
      calories: Number(row.calories),
      proteinG: row.protein_g === null ? null : Number(row.protein_g),
      carbsG: row.carbs_g === null ? null : Number(row.carbs_g),
      fatG: row.fat_g === null ? null : Number(row.fat_g),
      fiberG: row.fiber_g === null ? null : Number(row.fiber_g),
    },
    profile: {
      age: Number(settings.age ?? 28),
      sex: settings.sex === "female" ? "female" : "male",
      height_cm: Number(settings.height_cm ?? 175),
      weight_lbs: Number(
        (weightRes.data as { weight_lbs?: number | string } | null)?.weight_lbs ??
          JON_FALLBACK_WEIGHT_LBS,
      ),
      activity_level: settings.activity_level ?? "sedentary",
      current_phase: parsePhase(settings.current_phase),
      goals_text:
        settings.goals_text ??
        "Aggressive but healthy fat loss; protein-prioritized, sustainable energy.",
      health_flags: Array.isArray(settings.health_flags) ? settings.health_flags : [],
    },
    targets: {
      tdee_cal: tdee,
      protein_g: proteinTarget,
      fiber_g: fiberTarget,
    },
    today_so_far: {
      cal: dayTotals.calories,
      protein_g: dayTotals.proteinG,
      fiber_g: dayTotals.fiberG,
      entry_count: todayRows.length,
    },
    week_so_far: {
      cal: weekTotals.calories,
      protein_g: weekTotals.proteinG,
      fiber_g: weekTotals.fiberG,
      entry_count: weekRows.length,
      days_logged: dayCalories.length,
      counts_by_category: countsByCategory,
      indulgence_days: dayCalories.filter((calories) => calories > tdee * 1.15).length,
      clean_days: dayCalories.filter((calories) => calories <= tdee).length,
    },
  };
}

function totalRows(rows: VerdictWeekEntryRow[]) {
  return rows.reduce(
    (total, row) => ({
      calories: total.calories + Number(row.calories),
      proteinG: total.proteinG + Number(row.protein_g ?? 0),
      fiberG: total.fiberG + Number(row.fiber_g ?? 0),
    }),
    { calories: 0, proteinG: 0, fiberG: 0 },
  );
}

function emptyCategoryCounts(): Record<FoodCategory, number> {
  return {
    meal: 0,
    healthy_snack: 0,
    unhealthy_snack: 0,
    drink: 0,
    other: 0,
  };
}

function parsePhase(value: string | null | undefined): VerdictInput["profile"]["current_phase"] {
  if (value === "maintain" || value === "bulk" || value === "recomp") return value;
  return "cut";
}

function getSundayOnOrBeforeIso(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}
