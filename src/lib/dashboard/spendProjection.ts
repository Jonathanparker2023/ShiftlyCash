export type SpendProjectionInputWeek = {
  spendCents: number;
};

export type DashboardSpendProjection = {
  previousWeekSpendCents: number;
  projectedDailySpendCents: number;
  sourceWeekCount: number;
  sourceTotalSpendCents: number;
  sourceMedianWeekSpendCents: number;
  method: "year_median" | "recent_twelve_median";
};

/**
 * Autofill spending: the per-day placeholder written onto future days.
 *
 * Uses the median week of the CALENDAR YEAR, not a short trailing window. A
 * six-week window made the forecast chase whatever just happened — two lumpy
 * weeks pushed it from the year's typical $104/day up to $127/day. The median
 * of the year answers "what does a normal week cost", which is the right
 * question for a day that has not happened yet.
 *
 * Callers pass only the weeks they want considered (the server scopes the
 * query to the current year); the early-January fallback to a trailing window
 * lives in apply_future_day_projection, which is what actually writes the days.
 * This mirror exists so the dashboard displays the same figure it stored.
 */
export function deriveSpendProjection(
  weeks: SpendProjectionInputWeek[],
  method: DashboardSpendProjection["method"] = "year_median",
): DashboardSpendProjection {
  const included = weeks.filter((week) => week.spendCents > 0);
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
    method,
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
