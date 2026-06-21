export type SpendProjectionInputWeek = {
  spendCents: number;
};

export type DashboardSpendProjection = {
  previousWeekSpendCents: number;
  projectedDailySpendCents: number;
  sourceWeekCount: number;
  sourceTotalSpendCents: number;
  sourceAverageWeekSpendCents: number;
  method: "all_closed_week_average";
};

export function deriveSpendProjection(
  weeks: SpendProjectionInputWeek[],
): DashboardSpendProjection {
  const included = weeks.filter((week) => week.spendCents > 0);
  const sourceTotalSpendCents = included.reduce(
    (total, week) => total + week.spendCents,
    0,
  );
  const sourceWeekCount = included.length;
  const sourceAverageWeekSpendCents =
    sourceWeekCount > 0
      ? Math.round(sourceTotalSpendCents / sourceWeekCount)
      : 0;
  const projectedDailySpendCents = Math.round(sourceAverageWeekSpendCents / 7);

  return {
    previousWeekSpendCents: sourceAverageWeekSpendCents,
    projectedDailySpendCents,
    sourceWeekCount,
    sourceTotalSpendCents,
    sourceAverageWeekSpendCents,
    method: "all_closed_week_average",
  };
}
