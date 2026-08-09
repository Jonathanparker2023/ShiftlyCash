import { describe, expect, it } from "vitest";

import { deriveSpendProjection } from "@/lib/dashboard/spendProjection";

describe("deriveSpendProjection", () => {
  it("takes the median of every week it is given, divided by seven", () => {
    // No longer truncates to a trailing window — the caller decides the scope
    // (the year, or a trailing fallback early in January) so the client mirrors
    // whatever apply_future_day_projection wrote onto the days.
    const projection = deriveSpendProjection([
      { spendCents: 700_00 },
      { spendCents: 1_400_00 },
      { spendCents: 2_100_00 },
      { spendCents: 3_500_00 },
      { spendCents: 1_050_00 },
      { spendCents: 630_00 },
      { spendCents: 980_00 },
    ]);

    expect(projection.sourceWeekCount).toBe(7);
    expect(projection.sourceTotalSpendCents).toBe(10_360_00);
    // Sorted: 630, 700, 980, 1050, 1400, 2100, 3500 -> middle is 1050.
    expect(projection.sourceMedianWeekSpendCents).toBe(1_050_00);
    expect(projection.projectedDailySpendCents).toBe(150_00);
    expect(projection.method).toBe("year_median");
  });

  it("averages the two middle weeks when the count is even", () => {
    const projection = deriveSpendProjection([
      { spendCents: 700_00 },
      { spendCents: 900_00 },
      { spendCents: 1_100_00 },
      { spendCents: 1_500_00 },
    ]);

    expect(projection.sourceMedianWeekSpendCents).toBe(1_000_00);
    expect(projection.projectedDailySpendCents).toBe(142_86);
  });

  it("reports the fallback method when the caller says so", () => {
    const projection = deriveSpendProjection(
      [{ spendCents: 700_00 }],
      "recent_twelve_median",
    );

    expect(projection.method).toBe("recent_twelve_median");
  });

  it("ignores zero spend weeks", () => {
    const projection = deriveSpendProjection([
      { spendCents: 0 },
      { spendCents: 700_00 },
    ]);

    expect(projection.sourceWeekCount).toBe(1);
    expect(projection.projectedDailySpendCents).toBe(100_00);
  });
});
