import { monthlyInterestCents } from "@/lib/goals/amortize";

/**
 * Month-by-month simulation of the whole ladder.
 *
 * The ladder is sequential and the money is not. Three things happen every
 * month, and only the third one is a choice:
 *
 *   1. Every debt accrues interest, whether or not it is the rung being worked.
 *   2. Every debt pays its own minimum -- contractual, already a fixed expense.
 *   3. All free cashflow piles onto the ACTIVE rung, on top of its minimum.
 *
 * That third line is what pulls a date in, and it is per rung: the Explorer's
 * $455.33 and a savings rung's $0 behave completely differently under it. A
 * single "extra per month" box at the top of the page cannot express this,
 * because the acceleration is not a number the user types -- it is whatever
 * cashflow is left after the minimums, aimed at one rung at a time.
 *
 * A rung further up the ladder is not frozen while you work the one below it.
 * Its balance keeps moving, which is why its ETA cannot be read off its own
 * balance in isolation.
 */

export type SimRung = {
  id: string;
  /** Balance or savings target still to cover, after starting capital. */
  remainingCents: number;
  /** Contractual monthly payment. Zero for savings rungs. */
  minimumPaymentCents: number;
  /** Annual rate as a fraction. Zero for savings rungs. */
  apr: number;
  /** Debts amortise; savings rungs just accumulate. */
  isDebt: boolean;
};

export type SimResult = {
  id: string;
  /** Months from today until this rung clears. Null if it never does. */
  monthsToClear: number | null;
  /** Interest this rung costs along the way. */
  interestPaidCents: number;
  /** Month this rung became the one cashflow was attacking. */
  becameActiveMonth: number | null;
};

export type SimulateInput = {
  rungs: SimRung[];
  /** Free cashflow per month, after fixed costs. */
  monthlyCashflowCents: number;
  /**
   * When a debt clears, its minimum payment stops leaving the account and
   * becomes available to attack the next rung. Snowballing is the default
   * because it is what actually happens to the money.
   */
  rollFreedPayments?: boolean;
  maxMonths?: number;
};

export function simulateLadder(input: SimulateInput): SimResult[] {
  const maxMonths = input.maxMonths ?? 600;
  const rollFreed = input.rollFreedPayments ?? true;
  const cashflow = Math.max(0, Math.round(input.monthlyCashflowCents));

  const state = input.rungs.map((rung) => ({
    ...rung,
    balance: Math.max(0, Math.round(rung.remainingCents)),
    interestPaidCents: 0,
    monthsToClear: null as number | null,
    becameActiveMonth: null as number | null,
  }));

  // Anything already at zero is done before we start.
  for (const rung of state) {
    if (rung.balance <= 0) rung.monthsToClear = 0;
  }

  let freedPaymentsCents = 0;

  for (let month = 1; month <= maxMonths; month += 1) {
    const active = state.find((rung) => rung.monthsToClear === null);
    if (!active) break;
    if (active.becameActiveMonth === null) active.becameActiveMonth = month;

    // 1 + 2. Interest and minimums on every open debt, active or not.
    for (const rung of state) {
      if (rung.monthsToClear !== null || !rung.isDebt) continue;
      const interest = monthlyInterestCents(rung.balance, rung.apr);
      rung.interestPaidCents += interest;
      rung.balance += interest;
      const paid = Math.min(rung.balance, rung.minimumPaymentCents);
      rung.balance -= paid;
      if (rung.balance <= 0) {
        rung.balance = 0;
        rung.monthsToClear = month;
        if (rollFreed) freedPaymentsCents += rung.minimumPaymentCents;
      }
    }

    // 3. Everything left over goes at the active rung, whichever it now is.
    const target = state.find((rung) => rung.monthsToClear === null);
    if (target) {
      const attack = cashflow + (rollFreed ? freedPaymentsCents : 0);
      if (attack > 0) {
        target.balance = Math.max(0, target.balance - attack);
        if (target.balance <= 0) {
          target.monthsToClear = month;
          if (target.isDebt && rollFreed) {
            freedPaymentsCents += target.minimumPaymentCents;
          }
        }
      }
    }

    // No cashflow and no minimum that touches principal means nothing moves.
    const stalled =
      cashflow === 0 &&
      freedPaymentsCents === 0 &&
      state.every(
        (rung) =>
          rung.monthsToClear !== null ||
          !rung.isDebt ||
          rung.minimumPaymentCents <= monthlyInterestCents(rung.balance, rung.apr),
      );
    if (stalled) break;
  }

  return state.map((rung) => ({
    id: rung.id,
    monthsToClear: rung.monthsToClear,
    interestPaidCents: rung.interestPaidCents,
    becameActiveMonth: rung.becameActiveMonth,
  }));
}

/** Weekly cashflow is what the app tracks; the loans run monthly. */
export function weeklyToMonthlyCents(weeklyCents: number): number {
  return Math.round((weeklyCents * 52) / 12);
}
