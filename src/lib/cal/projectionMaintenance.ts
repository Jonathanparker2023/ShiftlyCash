import "server-only";

import { buildProjectedPlanEntries } from "@/lib/cal/planProjection";
import type { CalTargets } from "@/lib/cal/types";
import { addDaysIso } from "@/lib/dashboard/dates";
import { createAdminClient } from "@/lib/supabase/admin";

type ProjectionMaintenanceSupabase = ReturnType<typeof createAdminClient>;

type ExistingEntryRow = {
  date: string;
  is_projected_plan: boolean | null;
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
  const { data: cleanedRows, error: cleanupError } = await supabase
    .from("food_entries")
    .delete()
    .eq("user_id", input.userId)
    .eq("is_projected_plan", true)
    .lte("date", input.todayIso)
    .select("id");

  if (cleanupError) {
    throw new Error(`Unable to clean ShiftlyCal projections: ${cleanupError.message}`);
  }

  if (
    input.todayIso < input.weekStartIso ||
    input.todayIso > input.weekEndIso
  ) {
    return { cleaned: cleanedRows?.length ?? 0, projected: 0 };
  }

  const firstFutureDate = addDaysIso(input.todayIso, 1);
  if (firstFutureDate > input.weekEndIso) {
    return { cleaned: cleanedRows?.length ?? 0, projected: 0 };
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("food_entries")
    .select("date,is_projected_plan")
    .eq("user_id", input.userId)
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
        user_id: input.userId,
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
        verdict: "good",
        verdict_source: "unscored",
        verdict_reason: "Projected plan entry.",
        verdict_context: null,
      });
    }
  }

  if (rowsToInsert.length === 0) {
    return { cleaned: cleanedRows?.length ?? 0, projected: 0 };
  }

  const { error: insertError } = await supabase
    .from("food_entries")
    .insert(rowsToInsert);

  if (insertError) {
    throw new Error(`Unable to apply ShiftlyCal projections: ${insertError.message}`);
  }

  return { cleaned: cleanedRows?.length ?? 0, projected: rowsToInsert.length };
}
