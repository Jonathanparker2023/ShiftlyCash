import "server-only";

import { requireUser } from "@/lib/auth";
import { getTodayIso } from "@/lib/dashboard/dates";
import type {
  CalTargets,
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

  const [entriesRes, savedFoodsRes, settingsRes, weightRes] = await Promise.all([
    supabase
      .from("food_entries")
      .select(
        "id,date,meal_name,calories,protein_g,carbs_g,fat_g,saved_food_id,created_at,updated_at",
      )
      .eq("user_id", user.id)
      .eq("date", todayIso)
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
      .eq("date", todayIso)
      .maybeSingle(),
  ]);

  if (entriesRes.error) throw new Error(`Food entries: ${entriesRes.error.message}`);
  if (savedFoodsRes.error) throw new Error(`Saved foods: ${savedFoodsRes.error.message}`);
  if (settingsRes.error) throw new Error(`Cal targets: ${settingsRes.error.message}`);
  if (weightRes.error) throw new Error(`Weight log: ${weightRes.error.message}`);

  return {
    todayIso,
    targets: mapTargets((settingsRes.data ?? null) as SettingsTargetsRow | null),
    todaysEntries: ((entriesRes.data ?? []) as FoodEntryRow[]).map(mapFoodEntry),
    savedFoods: ((savedFoodsRes.data ?? []) as SavedFoodRow[]).map(mapSavedFood),
    todaysWeight: weightRes.data ? mapWeightLog(weightRes.data as WeightLogRow) : null,
  };
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
