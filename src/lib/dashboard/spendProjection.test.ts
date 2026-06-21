import { describe, expect, it } from "vitest";

import { deriveSpendProjection } from "@/lib/dashboard/spendProjection";

describe("deriveSpendProjection", () => {
  it("uses the all-time average weekly spend divided by seven", () => {
    const projection = deriveSpendProjection([
      { spendCents: 700_00 },
      { spendCents: 1_400_00 },
      { spendCents: 2_100_00 },
    ]);

    expect(projection.sourceWeekCount).toBe(3);
    expect(projection.sourceTotalSpendCents).toBe(4_200_00);
    expect(projection.sourceAverageWeekSpendCents).toBe(1_400_00);
    expect(projection.projectedDailySpendCents).toBe(200_00);
    expect(projection.method).toBe("all_closed_week_average");
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
