/**
 * Year-end projection engine.
 * Ports legacy ShiftlyCash's calcWnc / calcDTI / fedTax2025 / ctTax2025 / ficaTax /
 * simulateMillionaire from index.html into TypeScript.
 *
 * All earnings/cashflow inputs are NET (post-withholding take-home).
 * Tax bracket math grosses-up to derive yearly liability.
 */

import type { PaySettings } from "@/lib/domain/pay";

export type WeekRow = {
  startDate: string;
  earningsCents: number;
  cashflowCents: number;
  abilityPaycheckCents: number;
  prestigePaycheckCents: number;
};

export type DebtRow = {
  id: string;
  name: string;
  balanceCents: number;
  minimumPaymentCents: number;
  aprBps: number; // basis points (e.g., 1850 = 18.50%)
  status: "active" | "paid";
  priorityOrder: number;
};

export type ProjectionInput = {
  closedWeeks: WeekRow[];
  currentWeekNumber: number;
  settings: PaySettings;
  withholding: {
    ability: number;
    prestige: number;
    incentive: number;
    filingFeeCents: number;
    standardDeductionCents: number;
    overtimeExemptionCents?: number;
  };
  rollingWindowWeeks?: number;
};

export type ProjectionOutput = {
  wpcCents: number;
  avgEarningsCents: number;
  recentEarningsCents: number[];
  recentCashflowCents: number[];
  weeksRemaining: number;
  ytdCfCents: number;
  ytdEarningsCents: number;
  ytdWageNetCents: number;
  avgWageNetCents: number;
  ypgcCents: number;
  ypwiNetCents: number;
  ypwiGrossCents: number;
  withheldYrCents: number;
  fedLiabilityCents: number;
  ctLiabilityCents: number;
  ficaLiabilityCents: number;
  totalLiabilityCents: number;
  estTaxCents: number;
  ypncCents: number;
  mweCents: number;
};

const FICA_SS_CAP = 17_610_000; // $176,100 in cents
const FICA_SS_RATE = 0.062;
const FICA_MEDICARE_RATE = 0.0145;
const MAX_WEEKS_IN_YEAR = 53;
const DEFAULT_OVERTIME_EXEMPTION_CENTS = 90_000; // $900 federal-only legacy exemption
const MAX_GROSS_UP_WITHHOLDING_RATE = 0.6;

export function grossUpNetWageCents(
  netCents: number,
  withholdingRate: number,
): number {
  const safeWithholdingRate = Math.min(
    MAX_GROSS_UP_WITHHOLDING_RATE,
    Math.max(0, Number.isFinite(withholdingRate) ? withholdingRate : 0),
  );
  return Math.round(netCents / (1 - safeWithholdingRate));
}

/** Federal 2025 tax brackets (single filer). Input is taxable income in cents. */
export function fedTax2025(taxableCents: number): number {
  if (taxableCents <= 0) return 0;
  const brackets: Array<[number, number]> = [
    [1_192_500, 0.1], // up to $11,925
    [4_847_500, 0.12], // up to $48,475
    [10_335_000, 0.22], // up to $103,350
    [19_730_000, 0.24], // up to $197,300
    [25_052_500, 0.32], // up to $250,525
    [62_635_000, 0.35], // up to $626,350
    [Number.POSITIVE_INFINITY, 0.37],
  ];
  let lastCap = 0;
  let tax = 0;
  for (const [cap, rate] of brackets) {
    if (taxableCents <= cap) {
      tax += (taxableCents - lastCap) * rate;
      return Math.round(tax);
    }
    tax += (cap - lastCap) * rate;
    lastCap = cap;
  }
  return Math.round(tax);
}

/** Connecticut 2025 tax brackets (single filer). Input is income in cents. */
export function ctTax2025(incomeCents: number): number {
  if (incomeCents <= 0) return 0;
  const baseExemption = 1_500_000;
  const phaseoutStart = 3_000_000;
  const phaseoutEnd = 4_500_000;
  const exemption =
    incomeCents <= phaseoutStart
      ? baseExemption
      : incomeCents >= phaseoutEnd
        ? 0
        : Math.max(0, baseExemption - (incomeCents - phaseoutStart));
  const taxableIncomeCents = Math.max(0, incomeCents - exemption);
  const brackets: Array<[number, number]> = [
    [1_000_000, 0.02], // up to $10,000
    [5_000_000, 0.045], // up to $50,000
    [10_000_000, 0.055], // up to $100,000
    [20_000_000, 0.06], // up to $200,000
    [25_000_000, 0.065], // up to $250,000
    [50_000_000, 0.069], // up to $500,000
    [Number.POSITIVE_INFINITY, 0.0699],
  ];
  let lastCap = 0;
  let tax = 0;
  for (const [cap, rate] of brackets) {
    if (taxableIncomeCents <= cap) {
      tax += (taxableIncomeCents - lastCap) * rate;
      return Math.round(tax);
    }
    tax += (cap - lastCap) * rate;
    lastCap = cap;
  }
  return Math.round(tax);
}

/** FICA: 6.2% Social Security (capped) + 1.45% Medicare (uncapped). Input in cents. */
export function ficaTax(incomeCents: number): number {
  if (incomeCents <= 0) return 0;
  const ssTaxable = Math.min(incomeCents, FICA_SS_CAP);
  const ss = ssTaxable * FICA_SS_RATE;
  const medicare = incomeCents * FICA_MEDICARE_RATE;
  return Math.round(ss + medicare);
}

/**
 * Compute projections from closed weeks + current settings/withholding.
 * Defaults rolling window to 2 weeks.
 */
export function calcWeeklyProjection(input: ProjectionInput): ProjectionOutput {
  const window = input.rollingWindowWeeks ?? 2;
  const closed = [...input.closedWeeks].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  const last = closed.slice(-window);

  // WPC = avg cashflow over the rolling window (cents)
  const wpcCents =
    last.length > 0
      ? Math.round(
          last.reduce((s, w) => s + w.cashflowCents, 0) / last.length,
        )
      : 0;
  const recentEarningsCents = last.map((week) => week.earningsCents);
  const recentCashflowCents = last.map((week) => week.cashflowCents);
  const avgEarningsCents =
    recentEarningsCents.length > 0
      ? Math.round(
          recentEarningsCents.reduce((sum, value) => sum + value, 0) /
            recentEarningsCents.length,
        )
      : 0;

  const weeksRemaining = Math.max(0, MAX_WEEKS_IN_YEAR - input.currentWeekNumber);
  const ytdCfCents = closed.reduce((s, w) => s + w.cashflowCents, 0);
  const ytdEarningsCents = closed.reduce(
    (sum, week) => sum + week.earningsCents,
    0,
  );
  const ytdAeNet = closed.reduce(
    (sum, week) => sum + week.abilityPaycheckCents,
    0,
  );
  const ytdPeNet = closed.reduce(
    (sum, week) => sum + week.prestigePaycheckCents,
    0,
  );
  const ytdWageNetCents = ytdAeNet + ytdPeNet;
  const ypgcCents = ytdCfCents + wpcCents * weeksRemaining;

  // Average paycheck split (NET) across the rolling window. This uses the same
  // arithmetic mean window as WPC/avg earnings; YTD wage uses all closed weeks.
  const avgAeNet =
    last.length > 0
      ? last.reduce((s, w) => s + w.abilityPaycheckCents, 0) / last.length
      : 0;
  const avgPeNet =
    last.length > 0
      ? last.reduce((s, w) => s + w.prestigePaycheckCents, 0) / last.length
      : 0;
  const avgWageNetCents = Math.round(avgAeNet + avgPeNet);
  const ypwiNetCents = Math.round(
    ytdWageNetCents + avgWageNetCents * weeksRemaining,
  );

  // Gross-up wage-only net earnings using the presumed withholding rates.
  // "Other" income remains in cashflow, but it is not wage income for YPWI.
  // The weekly buckets come from v_week_totals, which records earned wages by
  // work week. That avoids bias from the biweekly deposit cadence.
  const ytdAeGross = grossUpNetWageCents(ytdAeNet, input.withholding.ability);
  const ytdPeGross = grossUpNetWageCents(ytdPeNet, input.withholding.prestige);
  const avgAeGross = grossUpNetWageCents(avgAeNet, input.withholding.ability);
  const avgPeGross = grossUpNetWageCents(avgPeNet, input.withholding.prestige);

  // Yearly Projected Wage Income (gross)
  const ypwiGrossCents = Math.round(
    ytdAeGross + ytdPeGross + (avgAeGross + avgPeGross) * weeksRemaining,
  );

  // Total withheld over the year
  const withheldYrCents = Math.round(
    (ytdAeGross - ytdAeNet) +
      (ytdPeGross - ytdPeNet) +
      (avgAeGross -
        avgAeNet +
        avgPeGross -
        avgPeNet) *
        weeksRemaining,
  );

  // Liability calculation (gross income to fed/CT/FICA)
  const overtimeExemptionCents =
    input.withholding.overtimeExemptionCents ??
    DEFAULT_OVERTIME_EXEMPTION_CENTS;
  const fedLiabilityCents = fedTax2025(
    ypwiGrossCents -
      input.withholding.standardDeductionCents -
      overtimeExemptionCents,
  );
  const ctLiabilityCents = ctTax2025(ypwiGrossCents);
  const ficaLiabilityCents = ficaTax(ypwiGrossCents);
  const totalLiabilityCents =
    fedLiabilityCents + ctLiabilityCents + ficaLiabilityCents;

  const estTaxCents =
    Math.max(0, totalLiabilityCents - withheldYrCents) +
    input.withholding.filingFeeCents;

  const ypncCents = ypgcCents - estTaxCents;
  const mweCents = Math.round(ypncCents / 12);

  return {
    wpcCents,
    avgEarningsCents,
    recentEarningsCents,
    recentCashflowCents,
    weeksRemaining,
    ytdCfCents,
    ytdEarningsCents,
    ytdWageNetCents,
    avgWageNetCents,
    ypgcCents,
    ypwiNetCents,
    ypwiGrossCents,
    withheldYrCents,
    fedLiabilityCents,
    ctLiabilityCents,
    ficaLiabilityCents,
    totalLiabilityCents,
    estTaxCents,
    ypncCents,
    mweCents,
  };
}

/** Debt-to-Income percentage (0-100). monthlyGrossCents = gross monthly wage. */
export function calcDTI(
  totalActiveDebtCents: number,
  monthlyGrossCents: number,
): number {
  if (monthlyGrossCents <= 0) return 0;
  return Math.round((totalActiveDebtCents / monthlyGrossCents) * 100);
}

/**
 * Apply available cash to active debts in avalanche order without mutating the
 * source rows. The returned rows retain their original display order.
 */
export function applyDebtLumpSum(
  debts: DebtRow[],
  availableCashCents: number,
): {
  debts: DebtRow[];
  appliedCents: number;
  remainingCashCents: number;
} {
  const adjusted = debts.map((debt) => ({ ...debt }));
  const avalanche = adjusted
    .filter((debt) => debt.status === "active" && debt.balanceCents > 0)
    .sort(
      (a, b) =>
        b.aprBps - a.aprBps ||
        a.priorityOrder - b.priorityOrder ||
        a.id.localeCompare(b.id),
    );
  const startingCash = Math.max(0, Math.round(availableCashCents));
  let remainingCashCents = startingCash;

  for (const debt of avalanche) {
    if (remainingCashCents <= 0) break;
    const payment = Math.min(debt.balanceCents, remainingCashCents);
    debt.balanceCents -= payment;
    remainingCashCents -= payment;
  }

  return {
    debts: adjusted,
    appliedCents: startingCash - remainingCashCents,
    remainingCashCents,
  };
}

/**
 * Simulate weekly debt balance under avalanche payoff (highest APR first).
 * Returns array of weekly snapshots: total remaining debt at end of each week.
 * weeklyExtraCents = cashflow available beyond minimum payments.
 *
 * Minimums are paid out of the SAME weekly cashflow as everything else. They
 * used to be applied unconditionally, which quietly spent money that was never
 * there: at $10/wk of cashflow the simulation still serviced $480/mo of
 * minimums and reported a payoff date, when the real outcome is missed
 * payments. `minimumShortfallWeeks` counts the weeks where cashflow could not
 * cover every minimum — a payoff date with a nonzero count is not a plan, it
 * is a warning.
 */
export function simulateDebtFree(
  debts: DebtRow[],
  weeklyCashflowCents: number,
  maxWeeks = 520, // 10 years
): {
  weeklyBalances: number[];
  weeksToPayoff: number | null;
  minimumShortfallWeeks: number;
} {
  const active = debts
    .filter((d) => d.status === "active" && d.balanceCents > 0)
    .map((d) => ({ ...d }))
    .sort((a, b) => b.aprBps - a.aprBps);

  if (active.length === 0) {
    return { weeklyBalances: [0], weeksToPayoff: 0, minimumShortfallWeeks: 0 };
  }

  const balances: number[] = [];
  let minimumShortfallWeeks = 0;
  for (let week = 0; week < maxWeeks; week++) {
    // Apply weekly interest (APR / 52)
    for (const d of active) {
      if (d.balanceCents > 0 && d.aprBps > 0) {
        const weeklyRate = d.aprBps / 10000 / 52;
        d.balanceCents += Math.round(d.balanceCents * weeklyRate);
      }
    }

    // Total minimum payments per week (monthly min / 4.33)
    const totalMinWeekly = active.reduce(
      (s, d) =>
        s + (d.balanceCents > 0 ? Math.round(d.minimumPaymentCents / 4.33) : 0),
      0,
    );
    if (totalMinWeekly > weeklyCashflowCents) minimumShortfallWeeks++;

    // Every payment comes out of the same weekly budget. Minimums go first, in
    // avalanche order, but only as far as the money actually reaches.
    let budget = Math.max(0, weeklyCashflowCents);
    for (const d of active) {
      if (d.balanceCents <= 0 || budget <= 0) continue;
      const minWeekly = Math.min(
        Math.round(d.minimumPaymentCents / 4.33),
        budget,
      );
      const pay = Math.min(d.balanceCents, minWeekly);
      d.balanceCents -= pay;
      budget -= pay;
    }
    let extra = budget;
    for (const d of active) {
      if (d.balanceCents <= 0 || extra <= 0) continue;
      const pay = Math.min(d.balanceCents, extra);
      d.balanceCents -= pay;
      extra -= pay;
    }

    const total = active.reduce((s, d) => s + d.balanceCents, 0);
    balances.push(total);
    if (total === 0) {
      return { weeklyBalances: balances, weeksToPayoff: week + 1, minimumShortfallWeeks };
    }
  }

  return { weeklyBalances: balances, weeksToPayoff: null, minimumShortfallWeeks };
}

export type CatchUpResult = {
  /** Minimum weekly cashflow (cents) that clears all debt within targetWeeks. */
  requiredWeeklyCashflowCents: number;
  /** How much MORE than the current pace that requires (>= 0). */
  extraWeeklyCashflowCents: number;
  /** Weeks-to-payoff at the current pace (null if it never clears in range). */
  currentWeeksToPayoff: number | null;
  /** True when the current pace already hits the target. */
  onTrack: boolean;
};

/**
 * Find the minimum weekly cashflow that clears all active debt within
 * `targetWeeks`, via binary search over `simulateDebtFree`. More cashflow means
 * fewer weeks (monotonic), so binary search is valid. Reuses the same avalanche
 * model as the debt-free projection, so the answer is consistent with the
 * dashboard's debt-free date — this is the "what would it take to get back on
 * the locked target" calc.
 */
export function weeklyCashflowToHitDebtFreeBy(
  debts: DebtRow[],
  currentWeeklyCashflowCents: number,
  targetWeeks: number,
): CatchUpResult {
  const activeBalanceCents = debts
    .filter((d) => d.status === "active" && d.balanceCents > 0)
    .reduce((s, d) => s + d.balanceCents, 0);

  const currentWeeksToPayoff = simulateDebtFree(
    debts,
    currentWeeklyCashflowCents,
  ).weeksToPayoff;

  // No debt, or a non-positive target window: nothing to chase.
  if (activeBalanceCents <= 0 || targetWeeks <= 0) {
    return {
      requiredWeeklyCashflowCents: Math.max(0, currentWeeklyCashflowCents),
      extraWeeklyCashflowCents: 0,
      currentWeeksToPayoff,
      onTrack: true,
    };
  }

  const hits = (cashflowCents: number): boolean => {
    const weeks = simulateDebtFree(
      debts,
      cashflowCents,
      targetWeeks + 1,
    ).weeksToPayoff;
    return weeks !== null && weeks <= targetWeeks;
  };

  // Paying the whole balance (plus an interest + minimums cushion) in one week
  // always clears within the window, so it's a safe upper bound.
  let hi = activeBalanceCents + Math.ceil(activeBalanceCents * 0.05) + 100_00;
  let lo = 0;
  // Binary search down to the nearest dollar.
  while (hi - lo > 100) {
    const mid = Math.floor((lo + hi) / 2);
    if (hits(mid)) hi = mid;
    else lo = mid;
  }

  return {
    requiredWeeklyCashflowCents: hi,
    extraWeeklyCashflowCents: Math.max(0, hi - currentWeeklyCashflowCents),
    currentWeeksToPayoff,
    onTrack:
      currentWeeksToPayoff !== null && currentWeeksToPayoff <= targetWeeks,
  };
}

/**
 * Translate an extra-weekly-cashflow gap into a whole number of shifts to pick
 * up (rounded up). Returns 0 when there's no gap or no per-shift figure.
 */
export function extraShiftsToCloseGap(
  extraWeeklyCashflowCents: number,
  avgNetPerShiftCents: number,
): number {
  if (extraWeeklyCashflowCents <= 0 || avgNetPerShiftCents <= 0) return 0;
  return Math.ceil(extraWeeklyCashflowCents / avgNetPerShiftCents);
}

/**
 * Simulate weekly investment balance growth toward $1M.
 * Contributions are expected to already be net of weekly tax set-aside.
 */
export function simulateMillionaire(
  startingBalanceCents: number,
  weeklyCashflowCents: number,
  targetCents = 100_000_000, // $1M in cents
  annualGrowthRate = 0.1,
  maxWeeks = 2_080, // 40 years
): {
  weeksToTarget: number | null;
  weeklyBalances: number[];
} {
  const weeklyGrowthRate = annualGrowthRate / 52;
  const balances: number[] = [];
  let bal = startingBalanceCents;

  for (let week = 0; week < maxWeeks; week++) {
    const investment = Math.round(bal * weeklyGrowthRate);
    const contribution = Math.max(0, weeklyCashflowCents);
    bal = Math.max(0, bal + investment + contribution);
    balances.push(bal);
    if (bal >= targetCents) {
      return { weeksToTarget: week + 1, weeklyBalances: balances };
    }
  }

  return { weeksToTarget: null, weeklyBalances: balances };
}

export type MillionaireDebtStep = {
  name: string;
  balanceCents: number;
  minimumPaymentWeeklyCents: number;
};

/**
 * Legacy ShiftlyCash millionaire model.
 * Starts at negative debt, adds post-tax weekly cashflow, compounds at 10% only
 * once positive, and increases weekly cashflow when linked debts are "freed".
 */
export function simulateLegacyMillionaire({
  startingBalanceCents,
  weeklyCashflowCents,
  debtsList,
  targetCents = 100_000_000,
  annualGrowthRate = 0.1,
  maxWeeks = 5_200,
}: {
  startingBalanceCents: number;
  weeklyCashflowCents: number;
  debtsList: MillionaireDebtStep[];
  targetCents?: number;
  annualGrowthRate?: number;
  maxWeeks?: number;
}): {
  weeksToTarget: number | null;
  weeklyBalances: number[];
  payoffEvents: Array<{ week: number; name: string; freedCents: number }>;
} {
  const weeklyGrowthRate = annualGrowthRate / 52;
  const balances: number[] = [];
  const payoffEvents: Array<{ week: number; name: string; freedCents: number }> = [];
  const debts = debtsList.map((debt) => ({ ...debt, paid: false }));
  let balance = startingBalanceCents;
  let weeklyCashflow = weeklyCashflowCents;
  let cumulativeCashflow = 0;

  for (let week = 0; week <= maxWeeks; week++) {
    balances.push(Math.round(balance));
    if (balance >= targetCents) {
      return { weeksToTarget: week, weeklyBalances: balances, payoffEvents };
    }

    if (balance > 0) {
      balance += Math.round(balance * weeklyGrowthRate);
    }
    balance += weeklyCashflow;
    cumulativeCashflow += weeklyCashflow;

    for (const debt of debts) {
      if (!debt.paid && cumulativeCashflow >= debt.balanceCents) {
        debt.paid = true;
        weeklyCashflow += debt.minimumPaymentWeeklyCents;
        payoffEvents.push({
          week: week + 1,
          name: debt.name,
          freedCents: debt.minimumPaymentWeeklyCents,
        });
      }
    }
  }

  return { weeksToTarget: null, weeklyBalances: balances, payoffEvents };
}

/**
 * Legacy linear net-worth projection from a caller-supplied starting balance.
 * No avalanche or per-debt interest accounting: this is the cashflow's raw
 * effect on net worth.
 */
export function legacyDebtPaydownTrajectory(
  weeklyCashflowCents: number,
  startingBalanceCents: number,
  maxWeeks: number,
): number[] {
  const series: number[] = [];
  let netWorth = startingBalanceCents;
  for (let w = 0; w < maxWeeks; w++) {
    series.push(netWorth);
    netWorth += weeklyCashflowCents;
  }
  return series;
}

/**
 * Legacy "invested at X%" comparison. Uses the same caller-supplied starting
 * balance and weekly contribution, but compounds once the balance is positive.
 */
export function legacyInvestedTrajectory(
  weeklyCashflowCents: number,
  startingBalanceCents: number,
  maxWeeks: number,
  annualGrowthRate = 0.1,
): number[] {
  const series: number[] = [];
  let bal = startingBalanceCents;
  const weeklyRate = annualGrowthRate / 52;
  for (let w = 0; w < maxWeeks; w++) {
    series.push(bal);
    if (bal > 0) bal += Math.round(bal * weeklyRate);
    bal += weeklyCashflowCents;
  }
  return series;
}
