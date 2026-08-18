import { describe, expect, it } from "vitest";

import { simulateLadder, weeklyToMonthlyCents } from "@/lib/goals/simulate";

const explorer = {
  id: "explorer",
  remainingCents: 1_392_300,
  minimumPaymentCents: 45_533,
  apr: 0.188,
  isDebt: true,
};
const tesla = {
  id: "tesla",
  remainingCents: 3_183_600,
  minimumPaymentCents: 60_594,
  apr: 0.1094,
  isDebt: true,
};
const savings = {
  id: "reserves",
  remainingCents: 500_000,
  minimumPaymentCents: 0,
  apr: 0,
  isDebt: false,
};

describe("simulateLadder", () => {
  it("clears rungs in ladder order", () => {
    const [a, b] = simulateLadder({
      rungs: [explorer, tesla],
      monthlyCashflowCents: 100_000,
    });
    expect(a.monthsToClear).not.toBeNull();
    expect(b.monthsToClear).not.toBeNull();
    expect(a.monthsToClear!).toBeLessThanOrEqual(b.monthsToClear!);
  });

  it("keeps a later rung moving while an earlier one is being attacked", () => {
    // The Tesla is not frozen while the Explorer is the target -- it accrues
    // interest and pays its own minimum the whole time. Its ETA cannot be read
    // off its balance in isolation, which is the point of simulating.
    const [, teslaResult] = simulateLadder({
      rungs: [explorer, tesla],
      monthlyCashflowCents: 100_000,
    });
    expect(teslaResult.interestPaidCents).toBeGreaterThan(0);
  });

  it("aims cashflow at one rung at a time, not spread across them", () => {
    const results = simulateLadder({
      rungs: [explorer, tesla],
      monthlyCashflowCents: 100_000,
    });
    // The second rung only becomes the target after the first clears.
    expect(results[1].becameActiveMonth).toBeGreaterThan(results[0].monthsToClear!);
  });

  it("more cashflow clears the ladder sooner", () => {
    const slow = simulateLadder({ rungs: [explorer], monthlyCashflowCents: 20_000 });
    const fast = simulateLadder({ rungs: [explorer], monthlyCashflowCents: 200_000 });
    expect(fast[0].monthsToClear!).toBeLessThan(slow[0].monthsToClear!);
  });

  it("a zero-minimum savings rung is funded purely by cashflow", () => {
    const [result] = simulateLadder({
      rungs: [savings],
      monthlyCashflowCents: 100_000,
    });
    // $5,000 at $1,000/month.
    expect(result.monthsToClear).toBe(5);
    expect(result.interestPaidCents).toBe(0);
  });

  it("rolls a cleared debt's freed payment into the next rung", () => {
    const withRoll = simulateLadder({
      rungs: [explorer, tesla],
      monthlyCashflowCents: 100_000,
      rollFreedPayments: true,
    });
    const withoutRoll = simulateLadder({
      rungs: [explorer, tesla],
      monthlyCashflowCents: 100_000,
      rollFreedPayments: false,
    });
    // Once the Explorer is gone its $455.33 stops leaving the account, so the
    // Tesla should land sooner when that money is put back to work.
    expect(withRoll[1].monthsToClear!).toBeLessThan(withoutRoll[1].monthsToClear!);
  });

  it("treats an already-cleared rung as done at month zero", () => {
    const [result] = simulateLadder({
      rungs: [{ ...savings, remainingCents: 0 }],
      monthlyCashflowCents: 100_000,
    });
    expect(result.monthsToClear).toBe(0);
  });

  it("reports never-clearing rather than looping when nothing can move", () => {
    // No cashflow, and a minimum under the monthly interest.
    const [result] = simulateLadder({
      rungs: [{ ...explorer, minimumPaymentCents: 10_000 }],
      monthlyCashflowCents: 0,
    });
    expect(result.monthsToClear).toBeNull();
  });
});

describe("weeklyToMonthlyCents", () => {
  it("scales by 52/12, not by 4", () => {
    // $614/wk is $2,660.67/mo, not $2,456. Using 4 weeks loses a month a year.
    expect(weeklyToMonthlyCents(61_400)).toBe(266_067);
  });
});
