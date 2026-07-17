export type GasAverageAllocation = {
  gasAmountCents: number;
  startDate: string | null;
  fillDate: string;
};

export type GasAverageSummary = {
  totalCents: number;
  firstDate: string;
  periodDays: number;
  dailyAverageCents: number;
};

export function calculateGasAverage(
  allocations: GasAverageAllocation[],
  todayIso: string,
): GasAverageSummary | null {
  if (allocations.length === 0) {
    return null;
  }

  const totalCents = allocations.reduce(
    (sum, allocation) => sum + Math.round(allocation.gasAmountCents),
    0,
  );
  const firstDate = allocations
    .map((allocation) => allocation.startDate ?? allocation.fillDate)
    .reduce((earliest, date) => (date < earliest ? date : earliest));
  const periodDays = inclusiveDateDiff(firstDate, todayIso);

  return {
    totalCents,
    firstDate,
    periodDays,
    dailyAverageCents: Math.round(totalCents / periodDays),
  };
}

function inclusiveDateDiff(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00.000Z`);
  const end = Date.parse(`${endIso}T00:00:00.000Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  return Number.isFinite(days) && days > 0 ? days : 1;
}
