import { describe, expect, it } from "vitest";

import {
  accruedTowardNextPayment,
  buildLoanPaymentForecast,
  classifyPostedLoanPayment,
  type LoanScheduleInput,
} from "@/lib/debt/loanSchedule";

const teslaLoan: LoanScheduleInput = {
  loanStartDate: "2026-08-22",
  firstPaymentDate: "2026-09-22",
  paymentDay: 22,
  contractualPaymentCents: 71_452,
  lifecycleStatus: "active",
};

describe("auto-loan cashflow and analytic accrual separation", () => {
  it("accrues nothing before the loan starts", () => {
    expect(accruedTowardNextPayment(teslaLoan, "2026-08-21")).toMatchObject({
      accruedCents: 0,
      elapsedDays: 0,
      cycleDays: 31,
    });
  });

  it("uses an inclusive start and exclusive payment-date boundary", () => {
    expect(accruedTowardNextPayment(teslaLoan, "2026-08-22")).toMatchObject({
      accruedCents: 2_305,
      elapsedDays: 1,
      cycleStartDate: "2026-08-22",
      cycleEndDate: "2026-09-22",
    });
  });

  it("matches the September 2 analytic as-of amount without booking it", () => {
    expect(accruedTowardNextPayment(teslaLoan, "2026-09-02")).toMatchObject({
      accruedCents: 27_659,
      elapsedDays: 12,
      cycleDays: 31,
    });
  });

  it("allocates the first cycle exactly across August and September", () => {
    expect(
      accruedTowardNextPayment(teslaLoan, "2026-08-31")?.accruedCents,
    ).toBe(23_049);
    expect(
      accruedTowardNextPayment(teslaLoan, "2026-09-21")?.accruedCents,
    ).toBe(71_452);
    expect(71_452 - 23_049).toBe(48_403);
  });

  it("keeps the September 22 cash payment whole and starts a new accrual cycle", () => {
    expect(buildLoanPaymentForecast(teslaLoan, "2026-09-22", 1)).toEqual([
      { date: "2026-09-22", amountCents: 71_452 },
    ]);
    expect(accruedTowardNextPayment(teslaLoan, "2026-09-22")).toMatchObject({
      accruedCents: 2_382,
      elapsedDays: 1,
      cycleDays: 30,
      cycleStartDate: "2026-09-22",
      cycleEndDate: "2026-10-22",
    });
  });

  it("forecasts twelve full contractual payments and never prorates cash", () => {
    const forecast = buildLoanPaymentForecast(teslaLoan, "2026-09-02", 12);
    expect(forecast[0]).toEqual({
      date: "2026-09-22",
      amountCents: 71_452,
    });
    expect(forecast.at(-1)).toEqual({
      date: "2027-08-22",
      amountCents: 71_452,
    });
    expect(forecast.reduce((sum, row) => sum + row.amountCents, 0)).toBe(
      857_424,
    );
  });

  it("does not forecast or accrue a payoff-pending TD installment", () => {
    const tdLoan: LoanScheduleInput = {
      loanStartDate: "2026-07-29",
      firstPaymentDate: "2026-09-12",
      paymentDay: 12,
      contractualPaymentCents: 60_594,
      lifecycleStatus: "payoff_pending",
    };
    expect(buildLoanPaymentForecast(tdLoan, "2026-09-02", 12)).toEqual([]);
    expect(accruedTowardNextPayment(tdLoan, "2026-09-02")).toBeNull();

    const confirmedPaid = { ...tdLoan, lifecycleStatus: "paid" as const };
    expect(buildLoanPaymentForecast(confirmedPaid, "2026-09-12", 12)).toEqual(
      [],
    );
    expect(accruedTowardNextPayment(confirmedPaid, "2026-09-12")).toBeNull();
  });

  it("counts principal as liability reduction, not economic expense", () => {
    expect(
      classifyPostedLoanPayment({
        paymentCents: 71_452,
        principalCents: 29_000,
        interestCents: 42_000,
        feeCents: 452,
      }),
    ).toEqual({
      cashOutflowCents: 71_452,
      liabilityReductionCents: 29_000,
      economicCostCents: 42_452,
    });
  });
});
