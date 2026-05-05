import { describe, expect, it } from "vitest";

import {
  calcWeeklyProjection,
  ctTax2025,
  fedTax2025,
  simulateLegacyMillionaire,
} from "@/lib/domain/projections";

describe("projection math", () => {
  it("uses the legacy net wage projection for YPWI", () => {
    const projection = calcWeeklyProjection({
      currentWeekNumber: 10,
      rollingWindowWeeks: 2,
      closedWeeks: [
        {
          startDate: "2026-03-01",
          earningsCents: 150_000,
          cashflowCents: 50_000,
          abilityPaycheckCents: 100_000,
          prestigePaycheckCents: 50_000,
        },
        {
          startDate: "2026-03-08",
          earningsCents: 200_000,
          cashflowCents: 70_000,
          abilityPaycheckCents: 120_000,
          prestigePaycheckCents: 80_000,
        },
      ],
      settings: {
        abilityRegularNetRateCents: 1563,
        abilityOvertimeNetRateCents: 2173,
        prestigeRegularNetRateCents: 1428,
        prestigeOvertimeNetRateCents: 2142,
        abilityNetMultiplier: 0.7348,
      },
      withholding: {
        ability: 0.2652,
        prestige: 0.18,
        incentive: 0.2652,
        filingFeeCents: 16_000,
        standardDeductionCents: 1_500_000,
      },
    });

    expect(projection.avgEarningsCents).toBe(175_000);
    expect(projection.ytdEarningsCents).toBe(350_000);
    expect(projection.weeksRemaining).toBe(43);
    expect(projection.ypwiNetCents).toBe(7_875_000);
  });

  it("applies the 2025 federal and Connecticut tax shapes", () => {
    expect(fedTax2025(1_192_500)).toBe(119_250);
    expect(ctTax2025(3_000_000)).toBe(42_500);
    expect(ctTax2025(4_500_000)).toBe(177_500);
  });

  it("simulates legacy millionaire cashflow step-ups from freed linked debts", () => {
    const result = simulateLegacyMillionaire({
      startingBalanceCents: 0,
      weeklyCashflowCents: 10_000,
      debtsList: [
        {
          name: "Auto Loan",
          balanceCents: 20_000,
          minimumPaymentWeeklyCents: 5_000,
        },
      ],
      targetCents: 50_000,
      annualGrowthRate: 0,
    });

    expect(result.payoffEvents).toEqual([
      { week: 2, name: "Auto Loan", freedCents: 5_000 },
    ]);
    expect(result.weeksToTarget).toBe(4);
  });
});
