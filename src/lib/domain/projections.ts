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

/**
 * Median of a numeric array. Returns 0 for an empty array.
 * Uses the legacy convention of averaging the two middle elements for an
 * even-length input.
 */
function medianOfNumbers(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
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
  const ypwiNetCents = Math.round(
    ytdEarningsCents + avgEarningsCents * weeksRemaining,
  );
  const ypgcCents = ytdCfCents + wpcCents * weeksRemaining;

  // Average paycheck split (NET) across the rolling window
  const avgAeNet =
    last.length > 0
      ? last.reduce((s, w) => s + w.abilityPaycheckCents, 0) / last.length
      : 0;
  const avgPeNet =
    last.length > 0
      ? last.reduce((s, w) => s + w.prestigePaycheckCents, 0) / last.length
      : 0;

  // YTD per-job (NET) — MEDIAN-based smoothing.
  //
  // Why median × ytdWeekCount instead of Σ:
  //   The tax engine projects an annual gross to feed bracket math. Summing
  //   actual realized per-job earnings lets one outlier week (huge grind, sick
  //   week, big bonus) inflate or deflate the projected gross, which cascades
  //   through fed/FICA/CT brackets and produces a noisy estTax that swings by
  //   hundreds of dollars on the strength of a single anomalous week.
  //
  //   Using the median of weekly per-job earnings × number of elapsed weeks
  //   produces a "typical-week × weeks-elapsed" YTD that's robust to outliers
  //   while still reflecting the user's steady-state earning shape. The
  //   forecast portion (rolling-window avg × weeksRemaining) stays unchanged,
  //   so genuine pattern shifts still propagate quickly through the rolling
  //   window — just smoother.
  //
  //   Legacy-imported weeks (1–13) get a 68/32 fallback split applied inside
  //   v_week_totals, so they show up in the medians on equal footing with
  //   measured weeks. Per spec: include every week in the data pool.
  //
  //   This only affects YPWI_gross (the tax engine input). YPWI_net (the
  //   displayed card value) keeps using realized YTD sums so the card honestly
  //   reports what the user actually earned.
  const medianAeNet = medianOfNumbers(closed.map((w) => w.abilityPaycheckCents));
  const medianPeNet = medianOfNumbers(closed.map((w) => w.prestigePaycheckCents));
  const ytdWeekCount = closed.length;
  const ytdAeNet = medianAeNet * ytdWeekCount;
  const ytdPeNet = medianPeNet * ytdWeekCount;

  // Gross-up using withholding rates
  const abilityNetMultiplier = 1 - input.withholding.ability;
  const prestigeNetMultiplier = 1 - input.withholding.prestige;
  const ytdAeGross = abilityNetMultiplier > 0 ? ytdAeNet / abilityNetMultiplier : 0;
  const ytdPeGross = prestigeNetMultiplier > 0 ? ytdPeNet / prestigeNetMultiplier : 0;
  const avgAeGross = abilityNetMultiplier > 0 ? avgAeNet / abilityNetMultiplier : 0;
  const avgPeGross = prestigeNetMultiplier > 0 ? avgPeNet / prestigeNetMultiplier : 0;

  // Yearly Projected Wage Income (gross)
  const ypwiGrossCents = Math.round(
    ytdAeGross + ytdPeGross + (avgAeGross + avgPeGross) * weeksRemaining,
  );

  // Total withheld over the year
  const withheldYrCents = Math.round(
    ytdAeGross * input.withholding.ability +
      ytdPeGross * input.withholding.prestige +
      (avgAeGross * input.withholding.ability +
        avgPeGross * input.withholding.prestige) *
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
 * Simulate weekly debt balance under avalanche payoff (highest APR first).
 * Returns array of weekly snapshots: total remaining debt at end of each week.
 * weeklyExtraCents = cashflow available beyond minimum payments.
 */
export function simulateDebtFree(
  debts: DebtRow[],
  weeklyCashflowCents: number,
  maxWeeks = 520, // 10 years
): {
  weeklyBalances: number[];
  weeksToPayoff: number | null;
} {
  const active = debts
    .filter((d) => d.status === "active" && d.balanceCents > 0)
    .map((d) => ({ ...d }))
    .sort((a, b) => b.aprBps - a.aprBps);

  if (active.length === 0) {
    return { weeklyBalances: [0], weeksToPayoff: 0 };
  }

  const balances: number[] = [];
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

    // Distribute payments: minimums first to all, then extra to highest APR
    let extra = Math.max(0, weeklyCashflowCents - totalMinWeekly);
    for (const d of active) {
      if (d.balanceCents <= 0) continue;
      const minWeekly = Math.round(d.minimumPaymentCents / 4.33);
      d.balanceCents = Math.max(0, d.balanceCents - minWeekly);
    }
    for (const d of active) {
      if (d.balanceCents <= 0 || extra <= 0) continue;
      const pay = Math.min(d.balanceCents, extra);
      d.balanceCents -= pay;
      extra -= pay;
    }

    const total = active.reduce((s, d) => s + d.balanceCents, 0);
    balances.push(total);
    if (total === 0) {
      return { weeklyBalances: balances, weeksToPayoff: week + 1 };
    }
  }

  return { weeklyBalances: balances, weeksToPayoff: null };
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
 * Legacy linear net-worth projection.
 * Start at -totalDebt, add weeklyCashflow each week. No avalanche, no per-debt
 * interest accounting - just the cashflow's raw effect on net worth.
 * Crosses zero when accumulated cashflow > total debt.
 */
export function legacyDebtPaydownTrajectory(
  weeklyCashflowCents: number,
  totalDebtCents: number,
  maxWeeks: number,
): number[] {
  const series: number[] = [];
  let netWorth = -totalDebtCents;
  for (let w = 0; w < maxWeeks; w++) {
    series.push(netWorth);
    netWorth += weeklyCashflowCents;
  }
  return series;
}

/**
 * Legacy "invested at X%" comparison. Same starting point (-totalDebt), same
 * weekly cashflow contribution, but once the balance goes positive it compounds
 * at the given annual rate.
 */
export function legacyInvestedTrajectory(
  weeklyCashflowCents: number,
  totalDebtCents: number,
  maxWeeks: number,
  annualGrowthRate = 0.1,
): number[] {
  const series: number[] = [];
  let bal = -totalDebtCents;
  const weeklyRate = annualGrowthRate / 52;
  for (let w = 0; w < maxWeeks; w++) {
    series.push(bal);
    if (bal > 0) bal += Math.round(bal * weeklyRate);
    bal += weeklyCashflowCents;
  }
  return series;
}
