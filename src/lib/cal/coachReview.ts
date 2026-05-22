// Cached coach-review observation/suggestion layer.
//
// This file contains ZERO AI/network calls. It only:
//   1. Builds categorical observation bundles from real day/week data
//      (numbers stay in code; observations are semantic flags + food
//      names).
//   2. Picks a code-side suggestion from a closed enum.
//   3. Hashes the observation bundle for cache-key purposes.
//
// The AI generator that consumes these observations lives in a
// separate module (Commit B). Anything here can be tested without
// importing "server-only".

import { createHash } from "node:crypto";

import type {
  CalDay,
  CalTargets,
  CalTotals,
  CalWeek,
} from "@/lib/cal/types";

// ── Public types ──────────────────────────────────────────────────────

export type CoachReviewScope = "week" | "day";

// Closed enum. AI may ONLY render prose around a suggestion the code
// already chose. Adding a new kind requires a code change + matching
// prompt copy — that's the whole point.
export type CoachSuggestionKind =
  | "protein_food"
  | "fiber_food"
  | "water"
  | "electrolytes"
  | "whole_food_swap"
  | "fiber_supplement"
  | "none";

export type CoachSuggestion = {
  kind: CoachSuggestionKind;
  // Short concrete phrase the AI weaves into prose. Code chooses this
  // verbatim from a curated table; AI doesn't pick supplements.
  body: string;
};

// What the AI ultimately sees. NO raw numbers anywhere.
export type CoachObservations = {
  scope: CoachReviewScope;
  // ISO date for day; ISO Monday for week.
  periodKey: string;
  // Verbatim food names from entries (strings = zero math = safe).
  recentEntries: string[];
  // Categorical flags. Stable enum strings, no embedded numbers.
  signals: CoachSignal[];
  // Code-chosen suggestion. AI renders, doesn't pick.
  suggestion: CoachSuggestion;
};

// Categorical signal vocabulary. Adding to this list requires
// adding matching prompt guidance for the AI generator.
export type CoachSignal =
  // Calorie position vs the day's TDEE
  | "calories_under"
  | "calories_on_track"
  | "calories_over"
  // Protein status vs daily target
  | "protein_low"
  | "protein_on_track"
  | "protein_short_streak"
  // Fiber status
  | "fiber_low"
  | "fiber_on_track"
  | "fiber_week_short"
  // Sodium / DASH-specific
  | "sodium_high_today"
  | "sodium_dash_streak"
  | "bp_alert"
  // Added sugar
  | "sugar_high_today"
  | "liquid_sugar_today"
  // Saturated fat
  | "sat_fat_high_today"
  // Water
  | "water_short"
  // Weekly aggregates (only meaningful for scope=week)
  | "week_deficit"
  | "week_surplus"
  | "week_balanced"
  | "week_indulgence_heavy"
  | "week_clean_streak";

// ── Configuration ─────────────────────────────────────────────────────

// Same 10% tolerance the calendar/day verdict uses (per recent audit).
// Below 90% of TDEE → under; above 110% → over.
const CAL_TOLERANCE = 0.10;
// 3-day streak threshold for streak signals.
const STREAK_THRESHOLD_DAYS = 3;

// DASH weekly sodium ceiling = 1,500 mg × 7 = 10,500 mg. We flag
// streaks against the per-day ceiling, not the weekly sum, because
// per-day overshoots are more actionable than a weekly average.

// ── Suggestion picker ─────────────────────────────────────────────────

// Order of priority. First matching condition wins. Keep this list
// short and obvious — the whole point is that suggestions are
// deterministic and reviewable.
export function pickSuggestion(
  signals: CoachSignal[],
  scope: CoachReviewScope,
): CoachSuggestion {
  const has = (signal: CoachSignal) => signals.includes(signal);

  // Safety-first signals (BP + sodium) take precedence over generic
  // macro suggestions.
  if (has("bp_alert") || has("sodium_dash_streak")) {
    return { kind: "electrolytes", body: "a banana or some leafy greens" };
  }

  if (has("sodium_high_today")) {
    return {
      kind: "whole_food_swap",
      body: "a glass of water and something fresh next round",
    };
  }

  if (has("water_short")) {
    return { kind: "water", body: "another glass of water" };
  }

  if (has("fiber_low") || has("fiber_week_short")) {
    return { kind: "fiber_food", body: "beans, berries, or oats" };
  }

  if (has("protein_low") || has("protein_short_streak")) {
    return { kind: "protein_food", body: "eggs, yogurt, or grilled chicken" };
  }

  if (has("liquid_sugar_today")) {
    return {
      kind: "whole_food_swap",
      body: "whole fruit instead of juice next time",
    };
  }

  // Weekly scope rarely needs a daily nudge if the week looks fine.
  if (scope === "week" && has("week_balanced") && !has("week_indulgence_heavy")) {
    return { kind: "none", body: "" };
  }

  return { kind: "none", body: "" };
}

// ── Observation builders ──────────────────────────────────────────────

// Build a day-scoped observation bundle. Numbers stay in this
// function — outputs are categorical labels + food names only.
export function buildDayObservations(
  day: CalDay,
  targets: CalTargets,
  weekDays: CalDay[],
): CoachObservations {
  const signals: CoachSignal[] = [];
  const totals = day.totals;

  // Calories
  if (targets.tdeeCalories) {
    const ratio = totals.calories / targets.tdeeCalories;
    if (ratio < 1 - CAL_TOLERANCE) signals.push("calories_under");
    else if (ratio > 1 + CAL_TOLERANCE) signals.push("calories_over");
    else signals.push("calories_on_track");
  }

  // Protein
  if (targets.proteinTargetG) {
    const ratio = totals.proteinG / targets.proteinTargetG;
    if (ratio < 0.6) signals.push("protein_low");
    else if (ratio >= 0.85) signals.push("protein_on_track");
    if (countStreak(weekDays, day.date, (d) =>
        targets.proteinTargetG
          ? d.totals.proteinG / targets.proteinTargetG < 0.6
          : false,
      ) >= STREAK_THRESHOLD_DAYS) {
      signals.push("protein_short_streak");
    }
  }

  // Fiber
  if (targets.fiberTargetG) {
    const ratio = totals.fiberG / targets.fiberTargetG;
    if (ratio < 0.5) signals.push("fiber_low");
    else if (ratio >= 0.85) signals.push("fiber_on_track");
  }

  // Sodium + DASH
  if (targets.sodiumTargetMg) {
    if (totals.sodiumMg > targets.sodiumTargetMg) {
      signals.push("sodium_high_today");
    }
    const sodiumStreak = countStreak(weekDays, day.date, (d) =>
      targets.sodiumTargetMg
        ? d.totals.sodiumMg > targets.sodiumTargetMg
        : false,
    );
    if (sodiumStreak >= STREAK_THRESHOLD_DAYS) {
      signals.push("sodium_dash_streak");
    }
    if (
      targets.healthFlags.includes("high_blood_pressure") &&
      (totals.sodiumMg > targets.sodiumTargetMg || sodiumStreak >= 2)
    ) {
      signals.push("bp_alert");
    }
  }

  // Added sugar
  if (
    targets.addedSugarTargetG &&
    totals.addedSugarG > targets.addedSugarTargetG
  ) {
    signals.push("sugar_high_today");
  }
  if (hasLiquidSugarPattern(day)) signals.push("liquid_sugar_today");

  // Sat fat
  if (
    targets.saturatedFatTargetG &&
    totals.saturatedFatG > targets.saturatedFatTargetG
  ) {
    signals.push("sat_fat_high_today");
  }

  // Water
  if (targets.waterTargetOz && day.waterOz < targets.waterTargetOz * 0.5) {
    signals.push("water_short");
  }

  const recentEntries = day.entries
    .slice()
    .sort((a, b) => (a.loggedTime ?? "").localeCompare(b.loggedTime ?? ""))
    .map((e) => e.mealName);

  const suggestion = pickSuggestion(signals, "day");

  return {
    scope: "day",
    periodKey: day.date,
    recentEntries,
    signals,
    suggestion,
  };
}

// Build a week-scoped observation bundle.
export function buildWeekObservations(
  week: CalWeek,
  targets: CalTargets,
): CoachObservations {
  const signals: CoachSignal[] = [];
  const loggedDays = week.days.filter((d) => d.entries.length > 0);

  // Week deficit/surplus
  if (targets.tdeeCalories && loggedDays.length > 0) {
    const avg =
      loggedDays.reduce((sum, d) => sum + d.totals.calories, 0) /
      loggedDays.length;
    const ratio = avg / targets.tdeeCalories;
    if (ratio < 1 - CAL_TOLERANCE) signals.push("week_deficit");
    else if (ratio > 1 + CAL_TOLERANCE) signals.push("week_surplus");
    else signals.push("week_balanced");
  }

  // Sodium streak across the week
  if (targets.sodiumTargetMg) {
    const sodiumDays = loggedDays.filter(
      (d) => targets.sodiumTargetMg !== null &&
             d.totals.sodiumMg > targets.sodiumTargetMg,
    ).length;
    if (sodiumDays >= STREAK_THRESHOLD_DAYS) signals.push("sodium_dash_streak");
    if (targets.healthFlags.includes("high_blood_pressure") && sodiumDays >= 2) {
      signals.push("bp_alert");
    }
  }

  // Fiber across the week
  if (targets.fiberTargetG) {
    const lowFiberDays = loggedDays.filter(
      (d) => targets.fiberTargetG !== null &&
             d.totals.fiberG / targets.fiberTargetG < 0.5,
    ).length;
    if (lowFiberDays >= STREAK_THRESHOLD_DAYS) signals.push("fiber_week_short");
  }

  // Verdict pattern
  const verdictCounts = countVerdicts(week);
  if (verdictCounts.bad >= 4 && verdictCounts.bad > verdictCounts.good) {
    signals.push("week_indulgence_heavy");
  }
  if (verdictCounts.good >= 5 && verdictCounts.bad <= 1) {
    signals.push("week_clean_streak");
  }

  // Recent foods = top items by frequency across the week (capped).
  const recentEntries = topFoodsByFrequency(week, 6);

  const suggestion = pickSuggestion(signals, "week");

  return {
    scope: "week",
    periodKey: week.weekStartIso,
    recentEntries,
    signals,
    suggestion,
  };
}

// ── Hashing ──────────────────────────────────────────────────────────

// Stable SHA-1 over the user-facing semantic content. style_seed is
// NOT included — same observations should not regenerate just because
// a cosmetic seed rotates.
export function hashObservations(obs: CoachObservations): string {
  const canonical = JSON.stringify({
    scope: obs.scope,
    periodKey: obs.periodKey,
    recentEntries: obs.recentEntries,
    signals: obs.signals.slice().sort(),
    suggestion: obs.suggestion,
  });
  return createHash("sha1").update(canonical).digest("hex").slice(0, 16);
}

// Derive a cosmetic style seed from the hash + date so equivalent
// observations land on the same style but different days nudge
// toward different voices.
export function deriveStyleSeed(observationsHash: string, periodKey: string): string {
  const seeds = ["dry", "wry", "flat-coach", "observational", "deadpan"];
  const mix = createHash("md5")
    .update(observationsHash + periodKey)
    .digest()
    .readUInt32BE(0);
  return seeds[mix % seeds.length];
}

// ── Internal helpers ──────────────────────────────────────────────────

// Count how many consecutive logged days ending at `endDate` satisfy
// the predicate. Days without entries don't break the streak — they
// just don't contribute.
function countStreak(
  days: CalDay[],
  endDate: string,
  predicate: (day: CalDay) => boolean,
): number {
  const sorted = days
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const endIdx = sorted.findIndex((d) => d.date === endDate);
  if (endIdx < 0) return 0;

  let streak = 0;
  for (let i = endIdx; i >= 0; i--) {
    const day = sorted[i];
    if (day.entries.length === 0) continue;
    if (!predicate(day)) break;
    streak += 1;
  }
  return streak;
}

// "Liquid sugar pattern" mirrors the verdict-prompt rule: any drink
// entry that's high-carb + zero-fiber + low-protein.
function hasLiquidSugarPattern(day: CalDay): boolean {
  return day.entries.some(
    (e) =>
      e.category === "drink" &&
      e.carbsG !== null &&
      e.carbsG > 15 &&
      (e.fiberG ?? 0) === 0 &&
      (e.proteinG ?? 0) < 5,
  );
}

function countVerdicts(week: CalWeek): { good: number; bad: number } {
  let good = 0;
  let bad = 0;
  for (const day of week.days) {
    for (const entry of day.entries) {
      if (entry.verdict === "good") good += 1;
      else if (entry.verdict === "bad") bad += 1;
    }
  }
  return { good, bad };
}

function topFoodsByFrequency(week: CalWeek, max: number): string[] {
  const counts = new Map<string, number>();
  for (const day of week.days) {
    for (const entry of day.entries) {
      const name = entry.mealName.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([name]) => name);
}

// Suppress unused-import warnings until Commit B starts using the
// totals type at the consumer layer.
export type _CoachTotalsRef = CalTotals;
