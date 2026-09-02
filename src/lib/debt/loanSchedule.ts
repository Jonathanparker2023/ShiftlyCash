const DAY_MS = 86_400_000;

export type LoanLifecycleStatus = "active" | "payoff_pending" | "paid";

export type LoanScheduleInput = {
  loanStartDate: string;
  firstPaymentDate: string;
  paymentDay: number;
  contractualPaymentCents: number;
  lifecycleStatus: LoanLifecycleStatus;
};

export type LoanPaymentForecast = {
  date: string;
  amountCents: number;
};

export type LoanAccrualSnapshot = {
  accruedCents: number;
  cycleStartDate: string;
  cycleEndDate: string;
  cycleDays: number;
  elapsedDays: number;
};

/**
 * Cash dates and analytic accrual deliberately share date math but never a
 * total. The half-open cycle [start, next payment) gives every date exactly one
 * owner and prevents a due date from being counted in both adjacent cycles.
 */
export function buildLoanPaymentForecast(
  loan: LoanScheduleInput,
  fromDate: string,
  count = 12,
): LoanPaymentForecast[] {
  if (loan.lifecycleStatus !== "active" || count <= 0) return [];

  let paymentDate = loan.firstPaymentDate;
  while (paymentDate < fromDate) {
    paymentDate = nextMonthlyDate(paymentDate, loan.paymentDay);
  }

  return Array.from({ length: count }, () => {
    const payment = {
      date: paymentDate,
      amountCents: loan.contractualPaymentCents,
    };
    paymentDate = nextMonthlyDate(paymentDate, loan.paymentDay);
    return payment;
  });
}

export function accruedTowardNextPayment(
  loan: LoanScheduleInput,
  asOfDate: string,
): LoanAccrualSnapshot | null {
  if (loan.lifecycleStatus !== "active") return null;

  assertIsoDate(loan.loanStartDate);
  assertIsoDate(loan.firstPaymentDate);
  assertIsoDate(asOfDate);

  if (asOfDate < loan.loanStartDate) {
    return {
      accruedCents: 0,
      cycleStartDate: loan.loanStartDate,
      cycleEndDate: loan.firstPaymentDate,
      cycleDays: daysBetween(loan.loanStartDate, loan.firstPaymentDate),
      elapsedDays: 0,
    };
  }

  let cycleStart = loan.loanStartDate;
  let cycleEnd = loan.firstPaymentDate;

  while (asOfDate >= cycleEnd) {
    cycleStart = cycleEnd;
    cycleEnd = nextMonthlyDate(cycleEnd, loan.paymentDay);
  }

  const cycleDays = daysBetween(cycleStart, cycleEnd);
  const elapsedDays = Math.min(
    cycleDays,
    daysBetween(cycleStart, addDays(asOfDate, 1)),
  );

  return {
    accruedCents: Math.round(
      (loan.contractualPaymentCents * elapsedDays) / cycleDays,
    ),
    cycleStartDate: cycleStart,
    cycleEndDate: cycleEnd,
    cycleDays,
    elapsedDays,
  };
}

export function classifyPostedLoanPayment(input: {
  paymentCents: number;
  principalCents: number;
  interestCents: number;
  feeCents?: number;
}) {
  const feeCents = input.feeCents ?? 0;
  if (
    input.paymentCents < 0 ||
    input.principalCents < 0 ||
    input.interestCents < 0 ||
    feeCents < 0 ||
    input.principalCents + input.interestCents + feeCents !== input.paymentCents
  ) {
    throw new Error("Loan payment split must equal the posted cash payment.");
  }

  return {
    cashOutflowCents: input.paymentCents,
    liabilityReductionCents: input.principalCents,
    economicCostCents: input.interestCents + feeCents,
  };
}

function nextMonthlyDate(dateIso: string, paymentDay: number): string {
  const date = parseIsoDate(dateIso);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = month % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return toIsoDate(
    new Date(Date.UTC(targetYear, targetMonth, Math.min(paymentDay, lastDay))),
  );
}

function daysBetween(startIso: string, endIso: string): number {
  return Math.round(
    (parseIsoDate(endIso).getTime() - parseIsoDate(startIso).getTime()) /
      DAY_MS,
  );
}

function addDays(dateIso: string, days: number): string {
  const date = parseIsoDate(dateIso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function parseIsoDate(dateIso: string): Date {
  assertIsoDate(dateIso);
  return new Date(`${dateIso}T00:00:00.000Z`);
}

function assertIsoDate(dateIso: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    throw new Error(`Invalid ISO date: ${dateIso}`);
  }
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
