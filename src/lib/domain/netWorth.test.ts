import { describe, expect, it } from "vitest";

import {
  buildNetWorthProjection,
  visibleNetWorthPoints,
} from "@/lib/domain/netWorth";

describe("net worth projection", () => {
  it("splits projected value into principal and interest", () => {
    const projection = buildNetWorthProjection({
      startingBalanceCents: 10_000,
      weeklyContributionCents: 1_000,
      annualReturnRate: 0.1,
      horizonYears: 1,
    });

    const first = projection.points[0];
    const last = projection.points.at(-1);

    expect(first).toEqual({
      week: 0,
      principalCents: 10_000,
      interestCents: 0,
      totalCents: 10_000,
    });
    expect(last).toBeDefined();
    expect(last!.principalCents).toBe(62_000);
    expect(last!.interestCents).toBeGreaterThan(0);
    expect(last!.totalCents).toBe(
      last!.principalCents + last!.interestCents,
    );
  });

  it("detects when interest overtakes contributed principal", () => {
    const projection = buildNetWorthProjection({
      startingBalanceCents: 1_000_000,
      weeklyContributionCents: 1_000,
      annualReturnRate: 0.5,
      horizonYears: 3,
    });

    expect(projection.crossoverWeek).not.toBeNull();
  });

  it("filters visible points by selected timeframe", () => {
    const projection = buildNetWorthProjection({
      startingBalanceCents: 0,
      weeklyContributionCents: 1_000,
      annualReturnRate: 0.1,
      horizonYears: 1,
    });

    expect(visibleNetWorthPoints(projection.points, 13)).toHaveLength(14);
    expect(visibleNetWorthPoints(projection.points, 13).at(-1)?.week).toBe(13);
  });
});
