import { describe, expect, it } from "vitest";

import { amortize, cashflowCostCents, monthlyInterestCents } from "@/lib/goals/amortize";

// Jon's real loans, so the numbers in the test are the numbers on the page.
const EXPLORER = { balanceCents: 1_392_300, apr: 0.188, monthlyPaymentCents: 45_533 };
const TESLA = { balanceCents: 3_183_600, apr: 0.1094, monthlyPaymentCents: 60_594 };

describe("monthlyInterestCents", () => {
  it("charges a twelfth of the annual rate", () => {
    // 13,923 * 0.188 / 12 = 218.13
    expect(monthlyInterestCents(1_392_300, 0.188)).toBe(21_813);
  });

  it("is zero at a zero balance or a zero rate", () => {
    expect(monthlyInterestCents(0, 0.188)).toBe(0);
    expect(monthlyInterestCents(1_392_300, 0)).toBe(0);
  });
});

describe("amortize", () => {
  it("splits the first Explorer payment into interest and principal", () => {
    const result = amortize(EXPLORER);
    // Barely half the $455.33 payment reaches the loan. This is the number that
    // makes extra principal feel worth paying.
    expect(result.firstInterestCents).toBe(21_813);
    expect(result.firstPrincipalCents).toBe(23_720);
  });

  it("splits the first Tesla payment", () => {
    const result = amortize(TESLA);
    expect(result.firstInterestCents).toBe(29_024);
    expect(result.firstPrincipalCents).toBe(31_570);
  });

  it("retires the Explorer and charges real interest on the way", () => {
    const result = amortize(EXPLORER);
    expect(result.neverPaysOff).toBe(false);
    expect(result.months).toBeGreaterThan(0);
    expect(result.totalInterestCents).toBeGreaterThan(0);
  });

  it("pays off sooner with extra principal, and costs less interest", () => {
    const base = amortize(EXPLORER);
    const attacked = amortize({ ...EXPLORER, extraMonthlyCents: 20_000 });

    expect(attacked.months).toBeLessThan(base.months!);
    expect(attacked.totalInterestCents).toBeLessThan(base.totalInterestCents);
  });

  it("reports a loan that never pays off rather than inventing a date", () => {
    // A payment under the monthly interest never retires anything. Looping to
    // the safety bound would have implied a payoff date that does not exist.
    const result = amortize({ balanceCents: 1_392_300, apr: 0.188, monthlyPaymentCents: 10_000 });
    expect(result.neverPaysOff).toBe(true);
    expect(result.months).toBeNull();
  });

  it("treats a cleared debt as done", () => {
    const result = amortize({ balanceCents: 0, apr: 0.188, monthlyPaymentCents: 45_533 });
    expect(result.months).toBe(0);
    expect(result.totalInterestCents).toBe(0);
  });

  it("never overshoots -- the last payment is only what is left", () => {
    const result = amortize({ balanceCents: 50_000, apr: 0.1, monthlyPaymentCents: 40_000 });
    expect(result.months).toBe(2);
  });
});

describe("cashflowCostCents", () => {
  it("charges cashflow for the extra only, never for the note", () => {
    // The whole point: the contractual payment is already a fixed expense, so
    // demanding it from cashflow again is the double-count this replaces.
    const result = amortize({ ...EXPLORER, extraMonthlyCents: 20_000 });
    expect(cashflowCostCents(result, 20_000)).toBe(20_000 * result.months!);
  });

  it("costs cashflow nothing when there is no extra", () => {
    expect(cashflowCostCents(amortize(EXPLORER), 0)).toBe(0);
  });
});
