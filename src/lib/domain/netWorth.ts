export type NetWorthProjectionPoint = {
  week: number;
  principalCents: number;
  interestCents: number;
  totalCents: number;
};

export type NetWorthProjectionInput = {
  startingBalanceCents: number;
  weeklyContributionCents: number;
  annualReturnRate: number;
  horizonYears: number;
};

export type NetWorthProjection = {
  points: NetWorthProjectionPoint[];
  crossoverWeek: number | null;
};

export function buildNetWorthProjection({
  startingBalanceCents,
  weeklyContributionCents,
  annualReturnRate,
  horizonYears,
}: NetWorthProjectionInput): NetWorthProjection {
  const totalWeeks = Math.max(0, Math.round(horizonYears * 52));
  const contribution = Math.max(0, weeklyContributionCents);
  const weeklyRate = annualReturnRate / 52;
  const points: NetWorthProjectionPoint[] = [];
  let totalCents = startingBalanceCents;
  let crossoverWeek: number | null = null;

  for (let week = 0; week <= totalWeeks; week += 1) {
    const principalCents = startingBalanceCents + contribution * week;
    const interestCents = Math.max(0, Math.round(totalCents - principalCents));
    points.push({
      week,
      principalCents,
      interestCents,
      totalCents: Math.round(totalCents),
    });

    const contributedCents = contribution * week;
    if (
      crossoverWeek === null &&
      contributedCents > 0 &&
      interestCents >= contributedCents
    ) {
      crossoverWeek = week;
    }

    if (week === totalWeeks) {
      break;
    }

    if (totalCents > 0) {
      totalCents += Math.round(totalCents * weeklyRate);
    }
    totalCents += contribution;
  }

  return { points, crossoverWeek };
}

export function visibleNetWorthPoints(
  points: NetWorthProjectionPoint[],
  weekLimit: number,
): NetWorthProjectionPoint[] {
  return points.filter((point) => point.week <= weekLimit);
}
