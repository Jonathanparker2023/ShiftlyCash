import { describe, expect, it } from "vitest";

import { formatFixedBreakdownDetail } from "@/lib/dashboard/fixedBreakdown";

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
});
