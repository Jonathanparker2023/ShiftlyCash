import { describe, expect, it } from "vitest";

import {
  buildCashflowBreakdown,
  buildIncomeBreakdown,
} from "@/lib/dashboard/metricBreakdowns";
import { DEFAULT_PAY_SETTINGS } from "@/lib/domain/pay";
import type { DashboardDay, DashboardSlot } from "@/lib/dashboard/types";

function slot(overrides: Partial<DashboardSlot>): DashboardSlot {
  return {
    id: null,
    dayId: "day-1",
    slotIndex: 0,
    jobType: "none",
    payType: "none",
    hoursOrUnits: 0,
    regularHours: 0,
    overtimeHours: 0,
    incentiveMode: "none",
    incentiveRate: 0,
    incentiveAmount: 0,
    label: "",
    source: "user",
    kind: "earn",
    ...overrides,
  };
}

describe("dashboard metric breakdowns", () => {
  it("separates jobs from other income and reconciles to Earn", () => {
    const days = [
      {
        slots: [
          slot({
            jobType: "custom",
            customJobId: "homewell",
            customName: "HomeWell",
            payType: "regular",
            hoursOrUnits: 4,
            regularHours: 4,
            customRegularRateCents: 1978,
          }),
          slot({ jobType: "other", hoursOrUnits: 250, label: "Refund" }),
          slot({
            jobType: "other",
            kind: "bucket",
            bucketId: "bucket-1",
            label: "Amortized Income",
            creditCents: 2500,
          }),
        ],
      } as Pick<DashboardDay, "slots">,
    ];

    const income = buildIncomeBreakdown(days, DEFAULT_PAY_SETTINGS, 35412);

    expect(income.jobs).toEqual([
      { key: "custom:homewell", label: "HomeWell", cents: 7912 },
    ]);
    expect(income.other).toEqual([
      { key: "other:refund", label: "Refund", cents: 25000 },
      { key: "bucket:bucket-1", label: "Amortized Income", cents: 2500 },
    ]);
    expect(income.laborIncomeCents).toBe(7912);
    expect(income.otherIncomeCents).toBe(27500);
    expect(income.totalCents).toBe(35412);
  });

  it("shows labor cash flow without the other-income lift", () => {
    const income = {
      jobs: [],
      other: [],
      laborIncomeCents: 100000,
      otherIncomeCents: 25000,
      totalCents: 125000,
    };

    const cashflow = buildCashflowBreakdown(income, 30000, 20000, 75000);

    expect(cashflow.laborCashflowCents).toBe(50000);
    expect(cashflow.cashflowCents).toBe(75000);
  });
});
