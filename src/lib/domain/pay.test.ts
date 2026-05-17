import { describe, expect, it } from "vitest";

import {
  calculateDayTotals,
  calculateEarnSlot,
  calculateWeekTotals,
  getPayPeriodInfo,
  getShiftlyDisplayWeekNumber,
  netEarningsByBucket,
  type PaySettings,
} from "@/lib/domain/pay";
import { dollarsToCents } from "@/lib/domain/money";

describe("pay calculations", () => {
  it("calculates ability regular and overtime earnings from net rates", () => {
    expect(
      calculateEarnSlot({
        jobType: "ability",
        payType: "regular",
        hoursOrUnits: 8,
      }),
    ).toMatchObject({
      earningsCents: 12_504,
      abilityPaycheckCents: 12_504,
      prestigePaycheckCents: 0,
      wageHours: 8,
    });

    expect(
      calculateEarnSlot({
        jobType: "ability",
        payType: "overtime",
        hoursOrUnits: 2,
      }),
    ).toMatchObject({
      earningsCents: 4_346,
      abilityPaycheckCents: 4_346,
      prestigePaycheckCents: 0,
      wageHours: 2,
    });
  });

  it("calculates prestige regular and overtime earnings from net rates", () => {
    expect(
      calculateEarnSlot({
        jobType: "prestige",
        payType: "regular",
        hoursOrUnits: 13,
      }),
    ).toMatchObject({
      earningsCents: 19_006,
      abilityPaycheckCents: 0,
      prestigePaycheckCents: 19_006,
      wageHours: 13,
    });

    expect(
      calculateEarnSlot({
        jobType: "prestige",
        payType: "overtime",
        hoursOrUnits: 8,
      }),
    ).toMatchObject({
      earningsCents: 17_544,
      abilityPaycheckCents: 0,
      prestigePaycheckCents: 17_544,
      wageHours: 8,
    });
  });

  it("calculates Prestige ILST regular and overtime earnings from ILST rates", () => {
    expect(
      calculateEarnSlot({
        jobType: "prestige_ilst",
        payType: "regular",
        hoursOrUnits: 2,
      }),
    ).toMatchObject({
      earningsCents: 3_096,
      abilityPaycheckCents: 0,
      prestigePaycheckCents: 3_096,
      wageHours: 2,
    });

    expect(
      calculateEarnSlot({
        jobType: "prestige_ilst",
        payType: "overtime",
        hoursOrUnits: 3,
      }),
    ).toMatchObject({
      earningsCents: 6_966,
      abilityPaycheckCents: 0,
      prestigePaycheckCents: 6_966,
      wageHours: 3,
    });
  });

  it("calculates split wage slots from regular and overtime hours", () => {
    expect(
      calculateEarnSlot({
        jobType: "ability",
        payType: "split",
        hoursOrUnits: 12,
        regularHours: 4,
        overtimeHours: 8,
      }),
    ).toMatchObject({
      earningsCents: 23_636,
      abilityPaycheckCents: 23_636,
      prestigePaycheckCents: 0,
      wageHours: 12,
    });

    expect(
      calculateEarnSlot({
        jobType: "prestige",
        payType: "split",
        hoursOrUnits: 12,
        regularHours: 4,
        overtimeHours: 8,
      }),
    ).toMatchObject({
      earningsCents: 23_392,
      abilityPaycheckCents: 0,
      prestigePaycheckCents: 23_392,
      wageHours: 12,
    });

    expect(
      calculateEarnSlot({
        jobType: "prestige_ilst",
        payType: "split",
        hoursOrUnits: 12,
        regularHours: 4,
        overtimeHours: 8,
      }),
    ).toMatchObject({
      earningsCents: 24_768,
      abilityPaycheckCents: 0,
      prestigePaycheckCents: 24_768,
      wageHours: 12,
    });
  });

  it("counts incentive toward ability paycheck and other income only toward cashflow", () => {
    expect(
      calculateEarnSlot({
        jobType: "incentive",
        payType: "unit",
        hoursOrUnits: 20,
      }),
    ).toMatchObject({
      earningsCents: 1_470,
      abilityPaycheckCents: 1_470,
      prestigePaycheckCents: 0,
      wageHours: 0,
    });

    expect(
      calculateEarnSlot({
        jobType: "other",
        payType: "unit",
        hoursOrUnits: 80,
      }),
    ).toMatchObject({
      earningsCents: 8_000,
      abilityPaycheckCents: 0,
      prestigePaycheckCents: 0,
      wageHours: 0,
    });
  });

  it("calculates day totals with exact and legacy-rounded cashflow", () => {
    const totals = calculateDayTotals({
      earnSlots: [
        { jobType: "ability", payType: "regular", hoursOrUnits: 8 },
        { jobType: "prestige", payType: "regular", hoursOrUnits: 3 },
        { jobType: "other", payType: "unit", hoursOrUnits: 10 },
      ],
      spendCents: dollarsToCents(60),
      baseCents: dollarsToCents(52),
    });

    expect(totals.earningsCents).toBe(17_890);
    expect(totals.abilityPaycheckCents).toBe(12_504);
    expect(totals.prestigePaycheckCents).toBe(4_386);
    expect(totals.spendCents).toBe(6_000);
    expect(totals.baseCents).toBe(5_200);
    expect(totals.cashflowCents).toBe(6_690);
    expect(totals.legacyRoundedCashflowCents).toBe(7_000);
  });

  it("calculates ability shift plus incentive by rate or lump sum", () => {
    expect(
      calculateEarnSlot({
        jobType: "ability_incentive",
        payType: "regular",
        hoursOrUnits: 8,
        incentiveMode: "rate",
        incentiveRate: 5,
      }),
    ).toMatchObject({
      earningsCents: 15_443,
      abilityPaycheckCents: 15_443,
      prestigePaycheckCents: 0,
      wageHours: 8,
    });

    expect(
      calculateEarnSlot({
        jobType: "ability_incentive",
        payType: "split",
        hoursOrUnits: 10,
        regularHours: 8,
        overtimeHours: 2,
        incentiveMode: "lump_sum",
        incentiveAmount: 100,
      }),
    ).toMatchObject({
      earningsCents: 24_198,
      abilityPaycheckCents: 24_198,
      prestigePaycheckCents: 0,
      wageHours: 10,
    });
  });

  it("sums week totals across days", () => {
    const totals = calculateWeekTotals({
      days: [
        {
          earnSlots: [{ jobType: "ability", payType: "regular", hoursOrUnits: 8 }],
          spendCents: dollarsToCents(20),
          baseCents: dollarsToCents(52),
        },
        {
          earnSlots: [
            { jobType: "prestige", payType: "overtime", hoursOrUnits: 8 },
            { jobType: "incentive", payType: "unit", hoursOrUnits: 10 },
          ],
          spendCents: dollarsToCents(30),
          baseCents: dollarsToCents(57),
        },
      ],
    });

    expect(totals.dayCount).toBe(2);
    expect(totals.earningsCents).toBe(30_783);
    expect(totals.abilityPaycheckCents).toBe(13_239);
    expect(totals.prestigePaycheckCents).toBe(17_544);
    expect(totals.spendCents).toBe(5_000);
    expect(totals.baseCents).toBe(10_900);
    expect(totals.cashflowCents).toBe(14_883);
    expect(totals.legacyRoundedCashflowCents).toBe(15_000);
  });

  it("uses custom settings instead of defaults", () => {
    const customSettings: PaySettings = {
      abilityRegularNetRateCents: 2_000,
      abilityOvertimeNetRateCents: 3_000,
      prestigeRegularNetRateCents: 1_000,
      prestigeOvertimeNetRateCents: 1_500,
      prestigeIlstRegularNetRateCents: 1_100,
      prestigeIlstOvertimeNetRateCents: 1_650,
      abilityNetMultiplier: 0.5,
    };

    const totals = calculateDayTotals(
      {
        earnSlots: [
          { jobType: "ability", payType: "regular", hoursOrUnits: 2 },
          { jobType: "prestige", payType: "overtime", hoursOrUnits: 3 },
          { jobType: "incentive", payType: "unit", hoursOrUnits: 10 },
        ],
        spendCents: dollarsToCents(20),
        baseCents: dollarsToCents(52),
      },
      customSettings,
    );

    expect(totals.earningsCents).toBe(9_000);
    expect(totals.abilityPaycheckCents).toBe(4_500);
    expect(totals.prestigePaycheckCents).toBe(4_500);
    expect(totals.cashflowCents).toBe(1_800);
  });

  it("groups net earnings into Prestige and Ability buckets", () => {
    expect(
      netEarningsByBucket([
        { jobType: "prestige", computedEarningsCents: 1_200 },
        { jobType: "prestige_ilst", computedEarningsCents: 800 },
        { jobType: "ability", computedEarningsCents: 1_500 },
        { jobType: "ability_incentive", computedEarningsCents: 400 },
        { jobType: "incentive", computedEarningsCents: 250 },
        { jobType: "other", computedEarningsCents: 9_999 },
        { jobType: "none", computedEarningsCents: 999 },
      ]),
    ).toEqual({
      prestigeNetCents: 2_000,
      abilityNetCents: 2_150,
    });
  });
});

describe("week numbering and pay period metadata", () => {
  it("derives display week number from the first Sunday of the start year", () => {
    expect(getShiftlyDisplayWeekNumber("2026-01-04")).toBe(1);
    expect(getShiftlyDisplayWeekNumber("2026-04-12")).toBe(15);
  });

  it("keeps early-January non-week-start dates visible as week zero for future validation", () => {
    expect(getShiftlyDisplayWeekNumber("2026-01-01")).toBe(0);
  });

  it("assigns cross-year weeks to the start year display sequence", () => {
    expect(getShiftlyDisplayWeekNumber("2025-12-28")).toBe(52);
  });

  it("calculates biweekly role and paycheck due date", () => {
    expect(getPayPeriodInfo("2026-04-05")).toEqual({
      displayWeekNumber: 14,
      role: "week_1",
      paycheckDueDate: null,
    });

    expect(getPayPeriodInfo("2026-04-12")).toEqual({
      displayWeekNumber: 15,
      role: "week_2",
      paycheckDueDate: "2026-04-23",
    });
  });
});
