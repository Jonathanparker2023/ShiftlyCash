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

  it("smooths the YPWI gross via per-job medians, not realized sums", () => {
    // Build a 5-week dataset with one outlier ability week and one outlier
    // prestige week. The median should ignore the outliers; the realized
    // sum would include them and inflate YPWI gross.
    //
    // Ability values:  $1000, $1000, $1000, $1000, $3000  (median 1000, sum 7000)
    // Prestige values: $400,  $400,  $400,  $400,  $1200  (median 400,  sum 2800)
    //
    // Expected smoothed ytd at 5 closed weeks:
    //   ytdAeNet = 1000 * 5 = 5000   (vs realized sum 7000)
    //   ytdPeNet = 400  * 5 = 2000   (vs realized sum 2800)
    const closedWeeks = [
      { ability: 100_000, prestige: 40_000 },
      { ability: 100_000, prestige: 40_000 },
      { ability: 100_000, prestige: 40_000 },
      { ability: 100_000, prestige: 40_000 },
      { ability: 300_000, prestige: 120_000 }, // outlier week
    ].map((row, idx) => ({
      startDate: `2026-01-${String(idx * 7 + 4).padStart(2, "0")}`,
      earningsCents: row.ability + row.prestige,
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

    // weeksRemaining = max(0, 53 - 6) = 47
    expect(projection.weeksRemaining).toBe(47);

    // Smoothed YTD per job (in cents):
    //   ytdAeNet  = 100_000 (median) * 5 (ytdWeekCount) = 500_000
    //   ytdPeNet  = 40_000  (median) * 5                = 200_000
    //   ytdAeGross = 500_000 / 0.7348 ≈ 680_457
    //   ytdPeGross = 200_000 / 0.82   ≈ 243_902
    // Recent rolling avg (last 2 weeks include the outlier in week 5):
    //   avgAeNet  = (100_000 + 300_000) / 2 = 200_000
    //   avgPeNet  = (40_000 + 120_000) / 2  = 80_000
    //   avgAeGross = 200_000 / 0.7348 ≈ 272_182
    //   avgPeGross = 80_000  / 0.82   ≈ 97_561
    //   forecast   = (272_182 + 97_561) * 47 ≈ 17_377_921
    //   ypwiGross  ≈ 680_457 + 243_902 + 17_377_921 ≈ 18_302_280
    //
    // The realized-sum version would have been:
    //   ytdAeGross = 700_000 / 0.7348 ≈ 952_640
    //   ytdPeGross = 280_000 / 0.82   ≈ 341_463
    //   ypwiGross  ≈ 952_640 + 341_463 + 17_377_921 ≈ 18_672_024
    //
    // So smoothed gross is ~$3,697 less than realized. Lock the smoothed
    // value within rounding noise.
    expect(projection.ypwiGrossCents).toBeGreaterThan(18_300_000);
    expect(projection.ypwiGrossCents).toBeLessThan(18_310_000);

    // ypwiNet stays realized (sum-based) — that's still YPWI net's contract.
    //   ytdEarnings = (5 * 140_000) + (300_000 + 120_000 - 140_000) = 700_000 + 280_000 = 980_000
    //   avgEarnings = (140_000 + 420_000) / 2 = 280_000
    //   ypwiNet = 980_000 + 280_000 * 47 = 980_000 + 13_160_000 = 14_140_000
    expect(projection.ytdEarningsCents).toBe(980_000);
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
