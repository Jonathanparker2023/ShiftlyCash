export type SpendProjectionInputWeek = {
  spendCents: number;
};

export type DashboardSpendProjection = {
  previousWeekSpendCents: number;
  projectedDailySpendCents: number;
  sourceWeekCount: number;
  sourceTotalSpendCents: number;
  sourceMedianWeekSpendCents: number;
  method: "recent_six_median";
};

export function deriveSpendProjection(
  weeks: SpendProjectionInputWeek[],
): DashboardSpendProjection {
  const included = weeks.filter((week) => week.spendCents > 0).slice(-6);
  const sourceTotalSpendCents = included.reduce(
    (total, week) => total + week.spendCents,
    0,
  );
  const sourceWeekCount = included.length;
  const sourceMedianWeekSpendCents = medianCents(
    included.map((week) => week.spendCents),
  );
  const projectedDailySpendCents = Math.round(sourceMedianWeekSpendCents / 7);

  return {
    previousWeekSpendCents: sourceMedianWeekSpendCents,
    projectedDailySpendCents,
    sourceWeekCount,
    sourceTotalSpendCents,
    sourceMedianWeekSpendCents,
    method: "recent_six_median",
  };
}

function medianCents(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
