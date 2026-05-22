import { describe, expect, it } from "vitest";

import type {
  CoachObservations,
  CoachSignal,
} from "@/lib/cal/coachReview";
import {
  buildFallbackBody,
  primarySignalPhrase,
} from "@/lib/cal/coachReviewFallback";

function makeObservations(
  partial: Partial<CoachObservations> = {},
): CoachObservations {
  return {
    scope: "day",
    periodKey: "2026-05-22",
    recentEntries: [],
    signals: [],
    suggestion: { kind: "none", body: "" },
    ...partial,
  };
}

describe("coachReviewFallback", () => {
  it("bp_alert outranks fiber_low for the headline", () => {
    const signals: CoachSignal[] = ["bp_alert", "fiber_low"];
    expect(primarySignalPhrase(signals)).toMatch(/sodium/i);
  });

  it("renders food name + signal headline + suggestion tail", () => {
    const body = buildFallbackBody(
      makeObservations({
        recentEntries: ["Chick-fil-A Meal Deal", "Triple Protein Shake"],
        signals: ["bp_alert", "sodium_dash_streak", "fiber_low"],
        suggestion: {
          kind: "electrolytes",
          body: "a banana or some leafy greens",
        },
      }),
    );
    expect(body).toContain("Chick-fil-A Meal Deal");
    expect(body).toMatch(/sodium/i);
    expect(body).toContain("a banana or some leafy greens");
  });

  it("omits suggestion tail when kind is none", () => {
    const body = buildFallbackBody(
      makeObservations({
        recentEntries: ["Greek Yogurt"],
        signals: ["protein_on_track", "calories_on_track"],
        suggestion: { kind: "none", body: "" },
      }),
    );
    expect(body).toContain("Greek Yogurt");
    expect(body).not.toContain("Try ");
  });

  it("contains no raw numbers anywhere in the output", () => {
    const body = buildFallbackBody(
      makeObservations({
        recentEntries: ["Chick-fil-A Meal Deal"],
        signals: ["sodium_high_today", "calories_over", "fiber_low"],
        suggestion: { kind: "fiber_food", body: "beans, berries, or oats" },
      }),
    );
    expect(body).not.toMatch(/\d/);
  });

  it("collapses 3+ food names into a 'plus N more' tail", () => {
    const body = buildFallbackBody(
      makeObservations({
        recentEntries: ["A", "B", "C", "D", "E"],
        signals: ["calories_on_track"],
      }),
    );
    expect(body).toContain("+3 more");
  });

  it("handles zero entries gracefully", () => {
    const body = buildFallbackBody(makeObservations());
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/\d/);
  });
});
