import { describe, expect, it } from "vitest";

import {
  formatFixedBreakdownDetail,
  sortFixedBreakdownGreatestFirst,
} from "@/lib/dashboard/fixedBreakdown";

describe("Fixed breakdown detail", () => {
  it("shows only the recurring monthly amount", () => {
    expect(
      formatFixedBreakdownDetail({
        itemKind: "recurring",
        originalAmountCents: 700,
        periodDays: null,
      }),
    ).toBe("$7.00/mo");
  });

  it("describes an amortized total without repeating its daily slice", () => {
    expect(
      formatFixedBreakdownDetail({
        itemKind: "amortized",
        originalAmountCents: 25_055,
        periodDays: 30,
      }),
    ).toBe("$250.55 spread over 30d");
  });

  it("sorts daily contributions from greatest to least", () => {
    const items = [
      { appliedCents: 49, itemName: "Fortiva" },
      { appliedCents: 1_501, itemName: "Ford Explorer" },
      { appliedCents: 49, itemName: "Aspire" },
    ];

    expect(sortFixedBreakdownGreatestFirst(items)).toEqual([
      { appliedCents: 1_501, itemName: "Ford Explorer" },
      { appliedCents: 49, itemName: "Aspire" },
      { appliedCents: 49, itemName: "Fortiva" },
    ]);
    expect(items.map((item) => item.itemName)).toEqual([
      "Fortiva",
      "Ford Explorer",
      "Aspire",
    ]);
  });
});
