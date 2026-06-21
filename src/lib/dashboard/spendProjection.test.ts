import { describe, expect, it } from "vitest";

import { deriveSpendProjection } from "@/lib/dashboard/spendProjection";

describe("deriveSpendProjection", () => {
  it("uses the median of the most recent six weeks divided by seven", () => {
    const projection = deriveSpendProjection([
      { spendCents: 700_00 },
      { spendCents: 1_400_00 },
      { spendCents: 2_100_00 },
      { spendCents: 3_500_00 },
      { spendCents: 1_050_00 },
      { spendCents: 630_00 },
      { spendCents: 980_00 },
    ]);

    expect(projection.sourceWeekCount).toBe(6);
    expect(projection.sourceTotalSpendCents).toBe(9_660_00);
    expect(projection.sourceMedianWeekSpendCents).toBe(1_225_00);
    expect(projection.projectedDailySpendCents).toBe(175_00);
    expect(projection.method).toBe("recent_six_median");
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
