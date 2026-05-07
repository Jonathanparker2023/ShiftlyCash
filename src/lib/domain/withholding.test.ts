import { describe, expect, it } from "vitest";

import {
  estimateBiweeklyWithholding,
  marginalTaxForExtraHours,
} from "@/lib/domain/withholding";

const ABILITY_KNOTS = [
  { gross: 171.5, tax: 13.98 },
  { gross: 1359.9, tax: 272.6 },
  { gross: 1594.74, tax: 362.27 },
  { gross: 1696.43, tax: 401.71 },
  { gross: 2174.18, tax: 551.59 },
  { gross: 2504.78, tax: 699.46 },
  { gross: 2548.34, tax: 715.88 },
  { gross: 2606.65, tax: 738.78 },
  { gross: 3173.1, tax: 954.94 },
  { gross: 3320.4, tax: 1010.4 },
  { gross: 3717.03, tax: 1162.62 },
] as const;

describe("estimateBiweeklyWithholding", () => {
  it("matches Ability paystub calibration knots within one dollar", () => {
    ABILITY_KNOTS.forEach((knot) => {
      const result = estimateBiweeklyWithholding({
        jobType: "ability",
        biweeklyGross: knot.gross,
      });

      expect(result.tax).toBeCloseTo(knot.tax, 0);
    });
  });

  it("keeps the below-floor Ability rate in the 7%-9% band", () => {
    const result = estimateBiweeklyWithholding({
      jobType: "ability",
      biweeklyGross: 100,
    });

    expect(result.effectiveRate).toBeGreaterThanOrEqual(0.07);
    expect(result.effectiveRate).toBeLessThanOrEqual(0.09);
  });

  it("uses a sane high-end Ability extrapolation marginal rate", () => {
    const base = estimateBiweeklyWithholding({
      jobType: "ability",
      biweeklyGross: 3717.03,
    });
    const next = estimateBiweeklyWithholding({
      jobType: "ability",
      biweeklyGross: 3817.03,
    });
    const marginalRate = (next.tax - base.tax) / 100;

    expect(marginalRate).toBeGreaterThanOrEqual(0.35);
    expect(marginalRate).toBeLessThanOrEqual(0.42);
  });

  it("keeps Ability tax monotonic across sampled gross values", () => {
    let seed = 42;
    const sampledGrosses = Array.from({ length: 50 }, () => {
      seed = (seed * 16_807) % 2_147_483_647;
      return (seed / 2_147_483_647) * 4_500;
    }).sort((left, right) => left - right);

    let previousTax = 0;
    sampledGrosses.forEach((gross) => {
      const { tax } = estimateBiweeklyWithholding({
        jobType: "ability",
        biweeklyGross: gross,
      });

      expect(tax).toBeGreaterThanOrEqual(previousTax);
      previousTax = tax;
    });
  });

  it("keeps Prestige on the existing flat 18% rate", () => {
    const result = estimateBiweeklyWithholding({
      jobType: "prestige",
      biweeklyGross: 1000,
    });

    expect(result.tax).toBe(180);
    expect(result.effectiveRate).toBe(0.18);
  });
});

describe("marginalTaxForExtraHours", () => {
  it("returns the difference between two withholding estimates", () => {
    const currentBiweeklyGross = 2504.78;
    const extraHours = 2;
    const hourlyRate = 30;
    const expectedCurrent = estimateBiweeklyWithholding({
      jobType: "ability",
      biweeklyGross: currentBiweeklyGross,
    });
    const expectedNext = estimateBiweeklyWithholding({
      jobType: "ability",
      biweeklyGross: currentBiweeklyGross + extraHours * hourlyRate,
    });

    const result = marginalTaxForExtraHours({
      jobType: "ability",
      currentBiweeklyGross,
      extraHours,
      hourlyRate,
    });

    expect(result.extraGross).toBe(60);
    expect(result.extraTax).toBeCloseTo(expectedNext.tax - expectedCurrent.tax, 5);
    expect(result.effectiveMarginalRate).toBeCloseTo(result.extraTax / 60, 5);
  });
});
