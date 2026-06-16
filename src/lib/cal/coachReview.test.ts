import { describe, expect, it } from "vitest";

import {
  buildDayObservations,
  buildWeekObservations,
  deriveStyleSeed,
  hashObservations,
  pickSuggestion,
} from "@/lib/cal/coachReview";
import type {
  CalDay,
  CalTargets,
  CalWeek,
  FoodEntry,
} from "@/lib/cal/types";

const DEFAULT_TARGETS: CalTargets = {
  tdeeCalories: 1650,
  proteinTargetG: 180,
  carbsTargetG: 120,
  fatTargetG: 50,
  fiberTargetG: 30,
  sodiumTargetMg: 1500,
  addedSugarTargetG: 41,
  saturatedFatTargetG: 18,
  waterTargetOz: 80,
  age: 30,
  sex: "male",
  heightCm: 180,
  activityLevel: "active",
  currentPhase: null,
  goalsText: null,
  healthFlags: ["high_blood_pressure"],
  bannedFoods: [],
};

function makeEntry(partial: Partial<FoodEntry> & { id: string }): FoodEntry {
  return {
    id: partial.id,
    date: partial.date ?? "2026-05-22",
    loggedTime: partial.loggedTime ?? "12:00:00",
    mealName: partial.mealName ?? "Test meal",
    category: partial.category ?? "meal",
    calories: partial.calories ?? 500,
    proteinG: partial.proteinG ?? 30,
    carbsG: partial.carbsG ?? 50,
    fatG: partial.fatG ?? 20,
    fiberG: partial.fiberG ?? 5,
    sodiumMg: partial.sodiumMg ?? 600,
    addedSugarG: partial.addedSugarG ?? 0,
    saturatedFatG: partial.saturatedFatG ?? 4,
    savedFoodId: null,
    verdict: partial.verdict ?? "good",
    verdictReason: null,
    verdictSource: "ai",
    verdictError: null,
    verdictContext: null,
    isProjectedPlan: false,
    createdAt: "2026-05-22T12:00:00Z",
    updatedAt: "2026-05-22T12:00:00Z",
  };
}

function makeDay(
  date: string,
  entries: FoodEntry[],
  overrides: Partial<CalDay["totals"]> = {},
): CalDay {
  const baseTotals = entries.reduce(
    (totals, entry) => ({
      calories: totals.calories + entry.calories,
      proteinG: totals.proteinG + (entry.proteinG ?? 0),
      carbsG: totals.carbsG + (entry.carbsG ?? 0),
      fatG: totals.fatG + (entry.fatG ?? 0),
      fiberG: totals.fiberG + (entry.fiberG ?? 0),
      sodiumMg: totals.sodiumMg + (entry.sodiumMg ?? 0),
      addedSugarG: totals.addedSugarG + (entry.addedSugarG ?? 0),
      saturatedFatG: totals.saturatedFatG + (entry.saturatedFatG ?? 0),
    }),
    {
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      sodiumMg: 0,
      addedSugarG: 0,
      saturatedFatG: 0,
    },
  );
  return {
    date,
    dayIndex: 0,
    entries,
    totals: { ...baseTotals, ...overrides },
    dayVerdict: null,
    weight: null,
    waterOz: 0,
  };
}

describe("coachReview observations", () => {
  it("flags sodium_high_today + bp_alert for a single over-DASH day with BP flag", () => {
    const day = makeDay("2026-05-22", [
      makeEntry({
        id: "1",
        mealName: "Chick-fil-A Meal Deal",
        sodiumMg: 2890,
      }),
    ]);
    const obs = buildDayObservations(day, DEFAULT_TARGETS, [day]);
    expect(obs.signals).toContain("sodium_high_today");
    expect(obs.signals).toContain("bp_alert");
    expect(obs.recentEntries).toEqual(["Chick-fil-A Meal Deal"]);
  });

  it("flags sodium_dash_streak after 3 consecutive over-DASH logged days", () => {
    const week = ["05-20", "05-21", "05-22"].map((d) =>
      makeDay(`2026-${d}`, [
        makeEntry({ id: d, sodiumMg: 2500, mealName: "Greasy plate" }),
      ]),
    );
    const obs = buildDayObservations(week[2], DEFAULT_TARGETS, week);
    expect(obs.signals).toContain("sodium_dash_streak");
  });

  it("flags fiber_low and protein_low for an under-fed day", () => {
    const day = makeDay("2026-05-22", [
      makeEntry({
        id: "1",
        mealName: "Plain bagel",
        proteinG: 10,
        fiberG: 2,
        sodiumMg: 200,
        calories: 800,
      }),
    ]);
    const obs = buildDayObservations(day, DEFAULT_TARGETS, [day]);
    expect(obs.signals).toContain("protein_low");
    expect(obs.signals).toContain("fiber_low");
  });

  it("flags liquid_sugar_today on a high-carb low-fiber drink", () => {
    const day = makeDay("2026-05-22", [
      makeEntry({
        id: "1",
        mealName: "Orange juice",
        category: "drink",
        carbsG: 28,
        fiberG: 0,
        proteinG: 1,
      }),
    ]);
    const obs = buildDayObservations(day, DEFAULT_TARGETS, [day]);
    expect(obs.signals).toContain("liquid_sugar_today");
  });

  it("returns recentEntries in chronological order", () => {
    const day = makeDay("2026-05-22", [
      makeEntry({ id: "1", loggedTime: "17:46:00", mealName: "Shake" }),
      makeEntry({ id: "2", loggedTime: "12:30:00", mealName: "Lunch" }),
      makeEntry({ id: "3", loggedTime: "08:30:00", mealName: "Breakfast" }),
    ]);
    const obs = buildDayObservations(day, DEFAULT_TARGETS, [day]);
    expect(obs.recentEntries).toEqual(["Breakfast", "Lunch", "Shake"]);
  });
});

describe("coachReview suggestion picker", () => {
  it("electrolytes wins when BP alert is set", () => {
    expect(
      pickSuggestion(["bp_alert", "fiber_low"], "day").kind,
    ).toBe("electrolytes");
  });

  it("fiber_food wins over protein_food when both signals present and no BP", () => {
    expect(
      pickSuggestion(["fiber_low", "protein_low"], "day").kind,
    ).toBe("fiber_food");
  });

  it("none for a clean balanced week", () => {
    expect(
      pickSuggestion(["week_balanced", "week_clean_streak"], "week").kind,
    ).toBe("none");
  });

  it("whole_food_swap for liquid sugar without other major flags", () => {
    expect(pickSuggestion(["liquid_sugar_today"], "day").kind).toBe(
      "whole_food_swap",
    );
  });
});

describe("coachReview hashing", () => {
  it("identical observations produce identical hash", () => {
    const day = makeDay("2026-05-22", [
      makeEntry({ id: "1", mealName: "Same", sodiumMg: 600 }),
    ]);
    const a = buildDayObservations(day, DEFAULT_TARGETS, [day]);
    const b = buildDayObservations(day, DEFAULT_TARGETS, [day]);
    expect(hashObservations(a)).toBe(hashObservations(b));
  });

  it("different entries produce different hashes", () => {
    const dayA = makeDay("2026-05-22", [
      makeEntry({ id: "1", mealName: "First", sodiumMg: 600 }),
    ]);
    const dayB = makeDay("2026-05-22", [
      makeEntry({ id: "2", mealName: "Second", sodiumMg: 600 }),
    ]);
    const obsA = buildDayObservations(dayA, DEFAULT_TARGETS, [dayA]);
    const obsB = buildDayObservations(dayB, DEFAULT_TARGETS, [dayB]);
    expect(hashObservations(obsA)).not.toBe(hashObservations(obsB));
  });

  it("style seed is deterministic per hash+periodKey", () => {
    expect(deriveStyleSeed("abc123", "2026-05-22")).toBe(
      deriveStyleSeed("abc123", "2026-05-22"),
    );
  });
});

describe("coachReview weekly observations", () => {
  it("flags week_indulgence_heavy when 4+ bad verdicts", () => {
    const days = ["05-17", "05-18", "05-19", "05-20", "05-21"].map((d) =>
      makeDay(`2026-${d}`, [
        makeEntry({
          id: `${d}-1`,
          verdict: "bad",
          mealName: "Heavy meal",
        }),
      ]),
    );
    const week: CalWeek = {
      weekStartIso: "2026-05-17",
      weekEndIso: "2026-05-23",
      days,
      totals: {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sodiumMg: 0,
        addedSugarG: 0,
        saturatedFatG: 0,
      },
    };
    const obs = buildWeekObservations(week, DEFAULT_TARGETS);
    expect(obs.signals).toContain("week_indulgence_heavy");
  });

  it("uses trend labels instead of food names for week observations", () => {
    const days = ["05-17", "05-18", "05-19"].map((d) =>
      makeDay(`2026-${d}`, [
        makeEntry({
          id: `${d}-1`,
          mealName: "Chick-fil-A Meal Deal",
          sodiumMg: 2500,
        }),
      ]),
    );
    const week: CalWeek = {
      weekStartIso: "2026-05-17",
      weekEndIso: "2026-05-23",
      days,
      totals: {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sodiumMg: 0,
        addedSugarG: 0,
        saturatedFatG: 0,
      },
    };

    const obs = buildWeekObservations(week, DEFAULT_TARGETS);
    expect(obs.recentEntries).toContain("sodium trend");
    expect(obs.recentEntries).not.toContain("Chick-fil-A Meal Deal");
  });
});
