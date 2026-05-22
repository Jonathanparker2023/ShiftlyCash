import { describe, expect, it } from "vitest";

import { stripQuantitativeClaims } from "@/lib/cal/verdictSanitize";

describe("stripQuantitativeClaims", () => {
  it("removes the percentage-claim sentence and keeps the food description", () => {
    const input =
      "Protein powder shake. Pushes daily calories to 110% of target and sodium to 217% of DASH ceiling.";
    const out = stripQuantitativeClaims(input);
    expect(out).toBe("Protein powder shake.");
  });

  it("strips bare percentage clauses", () => {
    const input = "Greek salad. About 45% of the daily fiber goal.";
    expect(stripQuantitativeClaims(input)).toBe("Greek salad.");
  });

  it("strips mg / cal / g claims that compare to budgets/targets", () => {
    const input = "Burger. Over 1500mg sodium, hits 1200 cal of the daily budget.";
    const out = stripQuantitativeClaims(input);
    expect(out).not.toMatch(/1500mg/);
    expect(out).not.toMatch(/1200 cal/);
    expect(out).toContain("Burger.");
  });

  it("leaves descriptive macro names alone", () => {
    const input = "Yogurt with chia. High protein, moderate fiber, low sodium.";
    expect(stripQuantitativeClaims(input)).toBe(input);
  });

  it("cleans up extra punctuation after stripping", () => {
    const input = "Apple juice. 34g liquid sugar — no fiber buffer.";
    const out = stripQuantitativeClaims(input);
    // The "34g liquid sugar" form is a food descriptor about the entry
    // itself (not a budget comparison), so it should survive.
    expect(out).toContain("liquid sugar");
  });
});
