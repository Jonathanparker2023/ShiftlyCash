import { describe, expect, it } from "vitest";

import { canonicalText, commitFromText } from "@/lib/goals/numberField";

describe("commitFromText", () => {
  it("treats an emptied field as cleared, not as zero", () => {
    // The regression: this used to come back as 0, which the Goals page read as
    // "no override" and immediately refilled with the median.
    expect(commitFromText("")).toEqual({ kind: "cleared" });
    expect(commitFromText("   ")).toEqual({ kind: "cleared" });
  });

  it("keeps a typed zero distinct from a cleared field", () => {
    expect(commitFromText("0")).toEqual({ kind: "value", cents: 0 });
  });

  it("converts dollars to cents", () => {
    expect(commitFromText("900")).toEqual({ kind: "value", cents: 90000 });
    expect(commitFromText("123.45")).toEqual({ kind: "value", cents: 12345 });
  });

  it("ignores keystrokes that are on the way to a number", () => {
    for (const partial of [".", ",", "-", "abc", "1e"]) {
      expect(commitFromText(partial)).toEqual({ kind: "ignore" });
    }
  });

  it("ignores negatives rather than committing them", () => {
    expect(commitFromText("-5")).toEqual({ kind: "ignore" });
  });
});

describe("canonicalText", () => {
  it("drops the decimals on whole dollars", () => {
    expect(canonicalText(90000)).toBe("900");
  });

  it("keeps cents when they exist, instead of truncating them", () => {
    // The old display did Math.round(cents / 100), so 123.45 typed in came
    // back out as "123" and the cents were silently lost on the next render.
    expect(canonicalText(12345)).toBe("123.45");
  });

  it("handles zero", () => {
    expect(canonicalText(0)).toBe("0");
  });
});
