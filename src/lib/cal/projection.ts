import type { CalWeek } from "@/lib/cal/types";

export type MagnitudeTone = "green" | "amber" | "red" | "neutral";

export type MagnitudeThresholds = {
  green: number;
  amber: number;
};

export const DAILY_CALORIE_THRESHOLDS: MagnitudeThresholds = {
  green: 100,
  amber: 300,
};

export const DAILY_MACRO_THRESHOLDS: MagnitudeThresholds = {
  green: 10,
  amber: 30,
};

export const WEEKLY_CALORIE_THRESHOLDS: MagnitudeThresholds = {
  green: 700,
  amber: 2100,
};

export function computeWeeklyDeficit(week: CalWeek, tdee: number | null): number {
  if (tdee === null) return 0;
  return week.totals.calories - tdee * 7;
}

export function projectWeeklyWeightChangeLbs(deficitCalories: number): number {
  return deficitCalories / 3500;
}

export function dailyDeviation(
  consumed: number,
  target: number | null,
): number | null {
  return target === null ? null : consumed - target;
}

export function colorToneFromMagnitude(
  deviation: number | null,
  thresholds: MagnitudeThresholds,
): MagnitudeTone {
  if (deviation === null) return "neutral";

  const magnitude = Math.abs(deviation);
  if (magnitude <= thresholds.green) return "green";
  if (magnitude <= thresholds.amber) return "amber";
  return "red";
}
