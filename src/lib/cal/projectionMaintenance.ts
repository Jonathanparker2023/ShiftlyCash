import "server-only";

import { buildProjectedPlanEntries } from "@/lib/cal/planProjection";
import type { CalTargets } from "@/lib/cal/types";
import { addDaysIso } from "@/lib/dashboard/dates";
import { createAdminClient } from "@/lib/supabase/admin";

type ProjectionMaintenanceSupabase = ReturnType<typeof createAdminClient>;

type ExistingEntryRow = {
  date: string;
};

type ResetProjectedEntriesRow = {
  cleaned: number;
  projected: number;
};

export type ShiftlyCalProjectionMaintenanceResult = {
  cleaned: number;
  projected: number;
};

export async function applyShiftlyCalProjectionMaintenance(
  supabase: ProjectionMaintenanceSupabase,
  input: {
    userId: string;
    weekStartIso: string;
    weekEndIso: string;
    todayIso: string;
    targets: Pick<
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
  },
): Promise<ShiftlyCalProjectionMaintenanceResult> {
  if (
    input.todayIso < input.weekStartIso ||
    input.todayIso > input.weekEndIso
  ) {
    return resetProjectedEntries(supabase, input.userId, []);
  }

  const firstFutureDate = addDaysIso(input.todayIso, 1);
  if (firstFutureDate > input.weekEndIso) {
    return resetProjectedEntries(supabase, input.userId, []);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("food_entries")
    .select("date")
    .eq("user_id", input.userId)
    .eq("is_projected_plan", false)
    .gte("date", firstFutureDate)
    .lte("date", input.weekEndIso);

  if (existingError) {
    throw new Error(`Unable to load ShiftlyCal projections: ${existingError.message}`);
  }

  const datesWithEntries = new Set(
    ((existingRows ?? []) as ExistingEntryRow[]).map((row) => row.date),
  );
  const planEntries = buildProjectedPlanEntries(input.targets);
  const rowsToInsert = [];

  for (
    let date = firstFutureDate;
    date <= input.weekEndIso;
    date = addDaysIso(date, 1)
  ) {
    if (datesWithEntries.has(date)) continue;

    for (const entry of planEntries) {
      rowsToInsert.push({
        date,
        logged_time: entry.loggedTime,
        meal_name: entry.mealName,
        category: entry.category,
        calories: entry.calories,
        protein_g: entry.proteinG,
        carbs_g: entry.carbsG,
        fat_g: entry.fatG,
        fiber_g: entry.fiberG,
        sodium_mg: entry.sodiumMg,
        added_sugar_g: entry.addedSugarG,
        saturated_fat_g: entry.saturatedFatG,
        is_projected_plan: true,
      });
    }
  }

  return resetProjectedEntries(supabase, input.userId, rowsToInsert);
}

async function resetProjectedEntries(
  supabase: ProjectionMaintenanceSupabase,
  userId: string,
  rowsToInsert: Array<Record<string, string | number | boolean | null>>,
): Promise<ShiftlyCalProjectionMaintenanceResult> {
  const { data, error } = await supabase.rpc(
    "reset_shiftlycal_projected_entries",
    {
      p_user_id: userId,
      p_rows: rowsToInsert,
    },
  );

  if (error) {
    throw new Error(`Unable to reset ShiftlyCal projections: ${error.message}`);
  }

  const result = Array.isArray(data)
    ? (data[0] as ResetProjectedEntriesRow | undefined)
    : (data as ResetProjectedEntriesRow | null);

  return {
    cleaned: Number(result?.cleaned ?? 0),
    projected: Number(result?.projected ?? 0),
  };
}
