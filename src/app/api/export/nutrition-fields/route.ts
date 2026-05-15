import { NextResponse } from "next/server";

import {
  getShiftlyCalDataForUser,
  getShiftlyCalTrendsDataForUser,
  type CalTrendDay,
} from "@/lib/cal/data";
import type {
  CalDay,
  CalTargets,
  CalTotals,
  FoodEntry,
  SavedFood,
} from "@/lib/cal/types";
import { addDaysIso } from "@/lib/dashboard/dates";
import { createAdminClient } from "@/lib/supabase/admin";

const LEDGER_TOKEN_ENV = "SHIFTLYCASH_LEDGER_TOKEN";
const LEDGER_USER_ID_ENV = "SHIFTLYCASH_LEDGER_USER_ID";

export async function GET(request: Request) {
  const authResult = authorizeLedgerRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const supabase = createAdminClient();
    const userId = await resolveLedgerUserId(supabase);
    const data = await getShiftlyCalDataForUser(userId);
    const trends = await getShiftlyCalTrendsDataForUser(userId, {
      weekStartIso: data.currentWeek.weekStartIso,
    });
    const today =
      data.currentWeek.days.find((day) => day.date === data.todayIso) ??
      data.currentWeek.days[0];
    const rolling7Start = addDaysIso(data.todayIso, -6);
    const rolling7Days = trends.trendDays.filter(
      (day) => day.date >= rolling7Start && day.date <= data.todayIso,
    );

    return NextResponse.json({
      as_of: new Date().toISOString(),
      today_iso: data.todayIso,
      week_of: data.currentWeek.weekStartIso,
      targets: mapTargets(data.targets),
      today: mapToday(today, data.targets),
      current_week: {
        start: data.currentWeek.weekStartIso,
        end: data.currentWeek.weekEndIso,
        totals: mapTotals(data.currentWeek.totals),
        avg_daily_logged: mapAverages(
          data.currentWeek.totals,
          countLoggedCalDays(data.currentWeek.days),
        ),
        days_logged: countLoggedCalDays(data.currentWeek.days),
        deficit_cal: roundInteger(data.projection.weeklyDeficitCalories),
        projected_weight_change_lbs: roundWeight(
          data.projection.projectedWeightDeltaLbs,
        ),
        days: data.currentWeek.days.map(mapWeekDay),
      },
      rolling_7d: buildRollingWindow(rolling7Days, data.targets, rolling7Start),
      rolling_28d: buildRollingWindow(
        trends.trendDays,
        data.targets,
        trends.trendDays[0]?.date ?? data.todayIso,
        true,
      ),
      saved_foods: data.savedFoods.map(mapSavedFood),
      trend_days_28: trends.trendDays.map(mapTrendDay),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Nutrition export failed.",
      },
      { status: 500 },
    );
  }
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;

function authorizeLedgerRequest(
  request: Request,
):
  | { ok: true }
  | { ok: false; response: NextResponse<{ error: string }> } {
  const token = process.env[LEDGER_TOKEN_ENV];

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${LEDGER_TOKEN_ENV} is not configured.` },
        { status: 500 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (provided !== token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}

async function resolveLedgerUserId(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const configuredUserId = process.env[LEDGER_USER_ID_ENV];

  if (configuredUserId) {
    return configuredUserId;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data?.id) {
    throw new Error(
      `Unable to resolve ledger user: ${error?.message ?? "missing profile"}`,
    );
  }

  return data.id as string;
}

function methodNotAllowed() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

function mapTargets(targets: CalTargets) {
  return {
    tdee_cal: targets.tdeeCalories,
    protein_g: targets.proteinTargetG,
    carbs_g: targets.carbsTargetG,
    fat_g: targets.fatTargetG,
    fiber_g: targets.fiberTargetG,
  };
}

function mapToday(day: CalDay, targets: CalTargets) {
  const tdee = targets.tdeeCalories;
  const calDeviation = tdee === null ? null : day.totals.calories - tdee;

  return {
    date: day.date,
    totals: mapTotals(day.totals),
    remaining_cal: tdee === null ? null : roundInteger(tdee - day.totals.calories),
    deviation: {
      cal: calDeviation === null ? null : roundInteger(calDeviation),
      cal_pct:
        calDeviation === null || !tdee
          ? null
          : roundInteger((calDeviation / tdee) * 100),
      protein_g:
        targets.proteinTargetG === null
          ? null
          : roundInteger(day.totals.proteinG - targets.proteinTargetG),
      fiber_g:
        targets.fiberTargetG === null
          ? null
          : roundInteger(day.totals.fiberG - targets.fiberTargetG),
    },
    entry_count: day.entries.length,
    entries: day.entries.map(mapEntry),
    weight_lbs: day.weight === null ? null : roundWeight(day.weight.weightLbs),
  };
}

function mapWeekDay(day: CalDay) {
  return {
    date: day.date,
    totals: mapTotals(day.totals),
    weight_lbs: day.weight === null ? null : roundWeight(day.weight.weightLbs),
    entry_count: day.entries.length,
  };
}

function mapEntry(entry: FoodEntry) {
  return {
    id: entry.id,
    name: entry.mealName,
    category: entry.category,
    calories: roundInteger(entry.calories),
    protein_g: nullableInteger(entry.proteinG),
    carbs_g: nullableInteger(entry.carbsG),
    fat_g: nullableInteger(entry.fatG),
    fiber_g: nullableInteger(entry.fiberG),
    logged_time: normalizeLoggedTime(entry.loggedTime),
    saved_food_id: entry.savedFoodId,
    created_at: entry.createdAt,
  };
}

function mapSavedFood(food: SavedFood) {
  return {
    id: food.id,
    name: food.name,
    category: food.category,
    calories: roundInteger(food.calories),
    protein_g: nullableInteger(food.proteinG),
    carbs_g: nullableInteger(food.carbsG),
    fat_g: nullableInteger(food.fatG),
    fiber_g: nullableInteger(food.fiberG),
    sort_order: roundInteger(food.sortOrder),
    archived_at: food.archivedAt,
  };
}

function mapTrendDay(day: CalTrendDay) {
  return {
    date: day.date,
    cal: roundInteger(day.calories),
    protein_g: roundInteger(day.proteinG),
    carbs_g: roundInteger(day.carbsG),
    fat_g: roundInteger(day.fatG),
    fiber_g: roundInteger(day.fiberG),
    weight_lbs: day.weightLbs === null ? null : roundWeight(day.weightLbs),
  };
}

function mapTotals(totals: CalTotals) {
  return {
    cal: roundInteger(totals.calories),
    protein_g: roundInteger(totals.proteinG),
    carbs_g: roundInteger(totals.carbsG),
    fat_g: roundInteger(totals.fatG),
    fiber_g: roundInteger(totals.fiberG),
  };
}

function mapAverages(totals: CalTotals, denominator: number) {
  const divisor = denominator || 1;

  return {
    cal: roundInteger(totals.calories / divisor),
    protein_g: roundInteger(totals.proteinG / divisor),
    carbs_g: roundInteger(totals.carbsG / divisor),
    fat_g: roundInteger(totals.fatG / divisor),
    fiber_g: roundInteger(totals.fiberG / divisor),
  };
}

function buildRollingWindow(
  days: CalTrendDay[],
  targets: CalTargets,
  start: string,
  includeCompliance = false,
) {
  const loggedDays = days.filter((day) => day.entryCount > 0);
  const totals = loggedDays.reduce(
    (sum, day) => ({
      calories: sum.calories + day.calories,
      proteinG: sum.proteinG + day.proteinG,
      carbsG: sum.carbsG + day.carbsG,
      fatG: sum.fatG + day.fatG,
      fiberG: sum.fiberG + day.fiberG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  );
  const denominator = loggedDays.length || 1;
  const weightTrend = weightDelta(days);
  const tdee = targets.tdeeCalories;
  const tdeeDays = tdee === null ? [] : loggedDays;
  const daysUnderTdee =
    tdee === null ? 0 : tdeeDays.filter((day) => day.calories < tdee).length;
  const daysOverTdee =
    tdee === null ? 0 : tdeeDays.filter((day) => day.calories > tdee).length;
  const result: Record<string, unknown> = {
    start,
    end: days.at(-1)?.date ?? start,
    avg_cal: roundInteger(totals.calories / denominator),
    avg_protein_g: roundInteger(totals.proteinG / denominator),
    avg_carbs_g: roundInteger(totals.carbsG / denominator),
    avg_fat_g: roundInteger(totals.fatG / denominator),
    avg_fiber_g: roundInteger(totals.fiberG / denominator),
    days_under_tdee: daysUnderTdee,
    days_over_tdee: daysOverTdee,
    days_logged: loggedDays.length,
    weight_start_lbs: weightTrend.start,
    weight_end_lbs: weightTrend.end,
  };

  if (includeCompliance) {
    result.compliance_pct =
      tdee === null || loggedDays.length === 0
        ? null
        : roundInteger(
            (loggedDays.filter((day) => Math.abs(day.calories - tdee) <= tdee * 0.15)
              .length /
              loggedDays.length) *
              100,
          );
    result.weight_change_lbs = weightTrend.delta;
  } else {
    result.weight_trend_lbs = weightTrend.delta;
  }

  return result;
}

function countLoggedCalDays(days: CalDay[]): number {
  return days.filter((day) => day.entries.length > 0).length;
}

function weightDelta(days: CalTrendDay[]) {
  const weights = days
    .filter((day) => day.weightLbs !== null)
    .map((day) => ({ date: day.date, weight: day.weightLbs as number }));
  const first = weights[0]?.weight ?? null;
  const last = weights.at(-1)?.weight ?? null;

  return {
    start: first === null ? null : roundWeight(first),
    end: last === null ? null : roundWeight(last),
    delta: first === null || last === null ? null : roundWeight(last - first),
  };
}

function normalizeLoggedTime(value: string | null): string | null {
  if (value === null) return null;
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return value;
}

function nullableInteger(value: number | null): number | null {
  return value === null ? null : roundInteger(value);
}

function roundInteger(value: number): number {
  return Math.round(value);
}

function roundWeight(value: number): number {
  return Math.round(value * 10) / 10;
}
