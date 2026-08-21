import { describe, expect, it } from "vitest";

import { mobileCashflowFontSize } from "@/lib/dashboard/cellText";

const cqwOf = (css: string) => Number(/([\d.]+)cqw/.exec(css)?.[1] ?? NaN);

describe("mobileCashflowFontSize", () => {
  it("caps at the short-day size so nothing renders larger than text-xs", () => {
    expect(mobileCashflowFontSize("118")).toContain("min(0.75rem");
    expect(mobileCashflowFontSize("+1,432")).toContain("min(0.75rem");
  });

  it("gives a four-figure day the same 12px ceiling as a three-figure one", () => {
    expect(mobileCashflowFontSize("118")).toContain("0.75rem");
    expect(mobileCashflowFontSize("1,432")).toContain("0.75rem");
  });

  it("does not discount the cell padding twice", () => {
    // The regression this replaced: cqw resolves against the container's
    // CONTENT box, which already excludes padding and border. Multiplying by a
    // 0.74 "usable fraction" on top sized every figure to three-quarters of the
    // room it had, making four-figure days SMALLER than the step table before
    // it. The fraction here is headroom against the glyph estimate, nothing
    // more, so it has to stay close to 1.
    const cqw = cqwOf(mobileCashflowFontSize("1,432"));
    const perfectFit = 100 / 2.6; // measured advance of "1,432" in em
    expect(cqw).toBeGreaterThan(perfectFit * 0.9);
    expect(cqw).toBeLessThanOrEqual(perfectFit);
  });

  it("allows a longer figure a smaller share of the cell", () => {
    expect(cqwOf(mobileCashflowFontSize("1,432"))).toBeLessThan(
      cqwOf(mobileCashflowFontSize("118")),
    );
    expect(cqwOf(mobileCashflowFontSize("-12,345"))).toBeLessThan(
      cqwOf(mobileCashflowFontSize("1,432")),
    );
  });

  it("does not treat a comma as a full digit", () => {
    // "1,432" and "14321" are both 5 characters, but the comma is narrower, so
    // the figure with the comma may take a larger face. Counting characters
    // rather than widths is what made the old estimate over-shrink.
    expect(cqwOf(mobileCashflowFontSize("1,432"))).toBeGreaterThan(
      cqwOf(mobileCashflowFontSize("14321")),
    );
  });

  it("never returns a bare cqw that could overflow the cap", () => {
    for (const text of ["0", "+1", "-999", "1,000", "+10,000", "-100,000"]) {
      const css = mobileCashflowFontSize(text);
      expect(css.startsWith("min(")).toBe(true);
      expect(cqwOf(css)).toBeGreaterThan(0);
    }
  });

  it("handles an empty string without dividing by zero", () => {
    expect(Number.isFinite(cqwOf(mobileCashflowFontSize("")))).toBe(true);
  });
});
