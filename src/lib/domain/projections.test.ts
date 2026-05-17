import { describe, expect, it } from "vitest";

import {
  calcWeeklyProjection,
  ctTax2025,
  fedTax2025,
  grossUpNetWageCents,
  simulateLegacyMillionaire,
} from "@/lib/domain/projections";

describe("projection math", () => {
  it("grosses up net wages with a safe withholding ceiling", () => {
    expect(grossUpNetWageCents(100_000, 0.18)).toBe(121_951);
    expect(grossUpNetWageCents(100_000, 1)).toBe(250_000);
  });

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
        prestigeRegularNetRateCents: 1462,
        prestigeOvertimeNetRateCents: 2193,
        prestigeIlstRegularNetRateCents: 1548,
        prestigeIlstOvertimeNetRateCents: 2322,
        abilityNetMultiplier: 0.7348,
      },
      withholding: {
        ability: 0.2652,
        prestige: 0.14,
        incentive: 0.2652,
        filingFeeCents: 16_000,
        standardDeductionCents: 1_500_000,
      },
    });

    expect(projection.avgEarningsCents).toBe(175_000);
    expect(projection.ytdEarningsCents).toBe(350_000);
    expect(projection.ytdWageNetCents).toBe(350_000);
    expect(projection.avgWageNetCents).toBe(175_000);
    expect(projection.weeksRemaining).toBe(43);
    expect(projection.ypwiNetCents).toBe(7_875_000);
  });

  it("grosses YPWI from realized wage-only YTD and projected wage avg", () => {
    // Build a 5-week dataset with one outlier ability week and one outlier
    // prestige week. YPWI deliberately uses realized wage YTD, not medians,
    // then grosses that net wage number back up by the presumed withholding
    // rates. This keeps one-off "other" income out of wage income while still
    // counting actual wage history.
    const closedWeeks = [
      { ability: 100_000, prestige: 40_000, other: 50_000 },
      { ability: 100_000, prestige: 40_000, other: 0 },
      { ability: 100_000, prestige: 40_000, other: 0 },
      { ability: 100_000, prestige: 40_000, other: 0 },
      { ability: 300_000, prestige: 120_000, other: 0 }, // outlier week
    ].map((row, idx) => ({
      startDate: `2026-01-${String(idx * 7 + 4).padStart(2, "0")}`,
      earningsCents: row.ability + row.prestige + row.other,
      cashflowCents: 0,
      abilityPaycheckCents: row.ability,
      prestigePaycheckCents: row.prestige,
    }));

    const projection = calcWeeklyProjection({
      currentWeekNumber: 6,
      rollingWindowWeeks: 2,
      closedWeeks,
      settings: {
        abilityRegularNetRateCents: 1563,
        abilityOvertimeNetRateCents: 2173,
        prestigeRegularNetRateCents: 1462,
        prestigeOvertimeNetRateCents: 2193,
        prestigeIlstRegularNetRateCents: 1548,
        prestigeIlstOvertimeNetRateCents: 2322,
        abilityNetMultiplier: 0.7348,
      },
      withholding: {
        ability: 0.2652,
        prestige: 0.14,
        incentive: 0.2652,
        filingFeeCents: 16_000,
        standardDeductionCents: 1_500_000,
      },
    });

    // weeksRemaining = max(0, 53 - 6) = 47
    expect(projection.weeksRemaining).toBe(47);

    // Wage-only YTD (in cents):
    //   ytdAeNet   = 700_000
    //   ytdPeNet   = 280_000
    //   ytdWageNet = 980_000
    //   ytdAeGross = 700_000 / 0.7348 ~= 952_640
    //   ytdPeGross = 280_000 / 0.86   ~= 325_581
    // Recent rolling avg (last 2 weeks include the outlier in week 5):
    //   avgAeNet  = (100_000 + 300_000) / 2 = 200_000
    //   avgPeNet  = (40_000 + 120_000) / 2  = 80_000
    //   avgAeGross = 200_000 / 0.7348 ~= 272_183
    //   avgPeGross = 80_000  / 0.86   ~= 93_023
    //   forecast   = (272_183 + 93_023) * 47 ~= 17_164_690
    //   ypwiGross  = 952_640 + 325_581 + (272_183 + 93_023) * 47 = 18_442_903
    //   ypwiNet = 980_000 + 280_000 * 47 = 980_000 + 13_160_000 = 14_140_000
    expect(projection.ypwiGrossCents).toBe(18_442_903);
    expect(projection.ytdEarningsCents).toBe(1_030_000);
    expect(projection.ytdWageNetCents).toBe(980_000);
    expect(projection.avgWageNetCents).toBe(280_000);
    expect(projection.ypwiNetCents).toBe(14_140_000);
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
