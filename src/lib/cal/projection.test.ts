import { describe, expect, it } from "vitest";

import {
  colorToneFromMagnitude,
  computeWeeklyDeficit,
  dailyCalorieThresholdsForTarget,
  dailyDeviation,
  projectWeeklyWeightChangeLbs,
} from "@/lib/cal/projection";
import type { CalWeek } from "@/lib/cal/types";

describe("ShiftlyCal projection helpers", () => {
  it("computes weekly calorie delta from consumed calories minus TDEE", () => {
    expect(computeWeeklyDeficit(makeWeek(12_600), 2_000)).toBe(-1400);
    expect(computeWeeklyDeficit(makeWeek(15_400), 2_000)).toBe(1400);
  });

  it("returns zero weekly delta when TDEE is not set", () => {
    expect(computeWeeklyDeficit(makeWeek(12_600), null)).toBe(0);
  });

  it("projects weight change with the Wishnofsky approximation", () => {
    expect(projectWeeklyWeightChangeLbs(-1750)).toBe(-0.5);
    expect(projectWeeklyWeightChangeLbs(875)).toBe(0.25);
  });

  it("returns daily deviation only when the target exists", () => {
    expect(dailyDeviation(2100, 2000)).toBe(100);
    expect(dailyDeviation(2100, null)).toBeNull();
  });

  it("colors by distance from target, not direction", () => {
    const thresholds = { green: 100, amber: 300 };

    expect(colorToneFromMagnitude(null, thresholds)).toBe("neutral");
    expect(colorToneFromMagnitude(100, thresholds)).toBe("green");
    expect(colorToneFromMagnitude(-100, thresholds)).toBe("green");
    expect(colorToneFromMagnitude(250, thresholds)).toBe("amber");
    expect(colorToneFromMagnitude(-250, thresholds)).toBe("amber");
    expect(colorToneFromMagnitude(301, thresholds)).toBe("red");
  });

  it("scales daily calorie thresholds from the active target", () => {
    expect(dailyCalorieThresholdsForTarget(1650)).toEqual({
      green: 165,
      amber: 330,
    });
    expect(dailyCalorieThresholdsForTarget(null)).toEqual({
      green: 100,
      amber: 300,
    });
  });
});

function makeWeek(calories: number): CalWeek {
  return {
    weekStartIso: "2026-05-10",
    weekEndIso: "2026-05-16",
    days: [],
    totals: {
      calories,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      sodiumMg: 0,
      addedSugarG: 0,
      saturatedFatG: 0,
    },
  };
}
