"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { estimateFood, type FoodEstimate } from "@/lib/cal/estimate";
import type { FoodCategory } from "@/lib/cal/types";
import { getTodayIso } from "@/lib/dashboard/dates";

type NullableMacroInput = number | string | null | undefined;
const FOOD_CATEGORIES = new Set<FoodCategory>([
  "meal",
  "healthy_snack",
  "unhealthy_snack",
  "drink",
  "other",
]);

export async function createFoodEntryAction(input: {
  date?: string;
  loggedTime?: string | null;
  mealName?: string | null;
  category?: FoodCategory | string | null;
  calories: number | string;
  proteinG?: NullableMacroInput;
  carbsG?: NullableMacroInput;
  fatG?: NullableMacroInput;
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
      saved_food_id: input.savedFoodId || null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
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
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const calories = requireNonNegativeInteger(input.calories, "Calories");

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
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("settings")
    .update({
      tdee_calories: optionalPositiveInteger(input.tdeeCalories, "TDEE"),
      protein_target_g: optionalNonNegativeInteger(input.proteinTargetG, "Protein target"),
      carbs_target_g: optionalNonNegativeInteger(input.carbsTargetG, "Carbs target"),
      fat_target_g: optionalNonNegativeInteger(input.fatTargetG, "Fat target"),
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

function parseInteger(value: NullableMacroInput): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error("Whole numbers only.");
  return parsed;
}
