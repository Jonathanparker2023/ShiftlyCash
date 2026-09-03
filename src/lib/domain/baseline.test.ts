import { describe, expect, it } from "vitest";

import {
  calculateBaselineTotals,
  isExpenseExpired,
  isExpenseVisible,
} from "@/lib/domain/baseline";
import { dollarsToCents } from "@/lib/domain/money";

describe("baseline expense calculations", () => {
  it("flags expenses expired before today", () => {
    expect(isExpenseExpired("2026-05-03", "2026-05-04")).toBe(true);
    expect(isExpenseExpired("2026-05-04", "2026-05-04")).toBe(false);
    expect(isExpenseExpired(null, "2026-05-04")).toBe(false);
  });

  it("totals active non-expired monthly expenses into weekly and daily base", () => {
    const totals = calculateBaselineTotals(
      [
        {
          amountCents: dollarsToCents(455),
          expirationDate: null,
          isActive: true,
        },
        {
          amountCents: dollarsToCents(131),
          expirationDate: "2026-05-03",
          isActive: true,
        },
        {
          amountCents: dollarsToCents(20),
          expirationDate: null,
          isActive: false,
        },
      ],
      "2026-05-04",
    );

    expect(totals.monthlyTotalCents).toBe(45_500);
    expect(totals.weeklyAverageCents).toBe(10_508);
    expect(totals.projectedDailyBaseCents).toBe(1_501);
  });

  it("returns zero totals when there are no expenses", () => {
    expect(calculateBaselineTotals([], "2026-05-04")).toEqual({
      monthlyTotalCents: 0,
      weeklyAverageCents: 0,
      projectedDailyBaseCents: 0,
    });
  });

  it("counts an expense through its expiration date", () => {
    const totals = calculateBaselineTotals(
      [
        {
          amountCents: dollarsToCents(100),
          expirationDate: "2026-05-04",
          isActive: true,
        },
      ],
      "2026-05-04",
    );

    expect(totals.monthlyTotalCents).toBe(10_000);
  });

  it("excludes inactive expenses even when they do not expire", () => {
    const totals = calculateBaselineTotals(
      [
        {
          amountCents: dollarsToCents(100),
          expirationDate: null,
          isActive: false,
        },
      ],
      "2026-05-04",
    );

    expect(totals.monthlyTotalCents).toBe(0);
  });

  it("shows only active, unexpired expenses in the current Fixed list", () => {
    expect(
      isExpenseVisible(
        { expirationDate: null, isActive: false },
        "2026-09-02",
      ),
    ).toBe(false);
    expect(
      isExpenseVisible(
        {
          expirationDate: "2026-09-01",
          isActive: true,
        },
        "2026-09-02",
      ),
    ).toBe(false);
    expect(
      isExpenseVisible(
        { expirationDate: null, isActive: true },
        "2026-09-02",
      ),
    ).toBe(true);
  });

  it("prorates the Tesla payment with BashFlow's standard Fixed formula", () => {
    expect(
      calculateBaselineTotals(
        [
          {
            amountCents: 71_452,
            expirationDate: null,
            isActive: true,
          },
        ],
        "2026-09-02",
      ),
    ).toEqual({
      monthlyTotalCents: 71_452,
      weeklyAverageCents: 16_502,
      projectedDailyBaseCents: 2_357,
    });
  });
});
