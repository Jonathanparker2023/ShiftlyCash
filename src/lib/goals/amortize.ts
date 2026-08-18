/**
 * Amortisation for debt rungs.
 *
 * The ladder used to treat a debt as a static pile of cash to be saved out of
 * weekly cashflow. That double-counted every car payment: the note is already a
 * fixed expense, so it was subtracted from the cashflow feeding the ladder while
 * the balance it was killing never moved. The payment slowed the goal down and
 * never advanced it.
 *
 * A debt is not a savings target. It is a balance with two inflows -- the
 * contractual payment, which is already happening and already paid for, and any
 * extra principal, which is the only part that competes with other rungs.
 */

export type AmortizeInput = {
  balanceCents: number;
  /** Annual rate as a fraction: 0.188 for 18.8%. */
  apr: number;
  /** The contractual monthly payment. */
  monthlyPaymentCents: number;
  /** Optional extra principal per month, on top of the payment. */
  extraMonthlyCents?: number;
  /** Safety bound; a 30-year note is 360. */
  maxMonths?: number;
};

export type AmortizeResult = {
  /** Months until the balance reaches zero. Null when it never does. */
  months: number | null;
  totalInterestCents: number;
  /** What the FIRST payment splits into -- the number that motivates extra. */
  firstInterestCents: number;
  firstPrincipalCents: number;
  /** True when the payment cannot even cover the interest. */
  neverPaysOff: boolean;
};

export function monthlyInterestCents(balanceCents: number, apr: number): number {
  if (balanceCents <= 0 || apr <= 0) return 0;
  return Math.round((balanceCents * apr) / 12);
}

export function amortize(input: AmortizeInput): AmortizeResult {
  const balance0 = Math.max(0, Math.round(input.balanceCents));
  const apr = Math.max(0, input.apr);
  const payment = Math.max(0, Math.round(input.monthlyPaymentCents));
  const extra = Math.max(0, Math.round(input.extraMonthlyCents ?? 0));
  const maxMonths = input.maxMonths ?? 600;

  const firstInterestCents = monthlyInterestCents(balance0, apr);
  const firstPrincipalCents = Math.max(0, payment + extra - firstInterestCents);

  if (balance0 === 0) {
    return {
      months: 0,
      totalInterestCents: 0,
      firstInterestCents: 0,
      firstPrincipalCents: 0,
      neverPaysOff: false,
    };
  }

  // A payment that does not clear the month's interest never retires the loan.
  // Say so instead of looping to the safety bound and implying a payoff date.
  if (payment + extra <= firstInterestCents) {
    return {
      months: null,
      totalInterestCents: 0,
      firstInterestCents,
      firstPrincipalCents: 0,
      neverPaysOff: true,
    };
  }

  let balance = balance0;
  let totalInterestCents = 0;
  let months = 0;

  while (balance > 0 && months < maxMonths) {
    const interest = monthlyInterestCents(balance, apr);
    // The final payment is only whatever is left.
    const principal = Math.min(balance, payment + extra - interest);
    balance -= principal;
    totalInterestCents += interest;
    months += 1;
  }

  return {
    months: balance <= 0 ? months : null,
    totalInterestCents,
    firstInterestCents,
    firstPrincipalCents,
    neverPaysOff: false,
  };
}

/** What clearing this debt costs from CASHFLOW -- the extra only, never the note. */
export function cashflowCostCents(result: AmortizeResult, extraMonthlyCents: number): number {
  if (result.months === null) return 0;
  return Math.max(0, Math.round(extraMonthlyCents)) * result.months;
}
