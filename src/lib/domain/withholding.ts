export type WithholdingJobType = "ability" | "prestige";

type EstimateBiweeklyWithholdingInput = {
  jobType: WithholdingJobType;
  biweeklyGross: number;
};

type MarginalTaxForExtraHoursInput = {
  jobType: WithholdingJobType;
  currentBiweeklyGross: number;
  extraHours: number;
  hourlyRate: number;
};

type WithholdingKnot = {
  gross: number;
  tax: number;
};

const PRESTIGE_FLAT_WITHHOLDING_RATE = 0.18;
const MAX_EXTRAPOLATED_WITHHOLDING_RATE = 0.5;

const ABILITY_WITHHOLDING_KNOTS: readonly WithholdingKnot[] = [
  { gross: 171.5, tax: 13.98 },
  { gross: 1359.9, tax: 272.6 },
  { gross: 1594.74, tax: 362.27 },
  { gross: 1696.43, tax: 401.71 },
  { gross: 2174.18, tax: 551.59 },
  { gross: 2504.78, tax: 699.46 },
  { gross: 2548.34, tax: 715.88 },
  { gross: 2606.65, tax: 738.78 },
  { gross: 3173.1, tax: 954.94 },
  { gross: 3320.4, tax: 1010.4 },
  { gross: 3717.03, tax: 1162.62 },
] as const;

const MONOTONIC_ABILITY_KNOTS = enforceMonotonicKnots(ABILITY_WITHHOLDING_KNOTS);

export function estimateBiweeklyWithholding({
  jobType,
  biweeklyGross,
}: EstimateBiweeklyWithholdingInput): { tax: number; effectiveRate: number } {
  const gross = Math.max(0, biweeklyGross);

  if (gross <= 0) {
    return { tax: 0, effectiveRate: 0 };
  }

  if (jobType === "prestige") {
    // Prestige remains flat until Jon has enough Prestige paystub knots for its
    // own empirical curve. Ability and Prestige should not share calibration.
    const tax = gross * PRESTIGE_FLAT_WITHHOLDING_RATE;
    return { tax, effectiveRate: tax / gross };
  }

  const tax = estimateAbilityTax(gross);
  return { tax, effectiveRate: tax / gross };
}

export function marginalTaxForExtraHours({
  jobType,
  currentBiweeklyGross,
  extraHours,
  hourlyRate,
}: MarginalTaxForExtraHoursInput): {
  extraGross: number;
  extraTax: number;
  effectiveMarginalRate: number;
} {
  const extraGross = Math.max(0, extraHours * hourlyRate);

  if (extraGross <= 0) {
    return { extraGross: 0, extraTax: 0, effectiveMarginalRate: 0 };
  }

  const current = estimateBiweeklyWithholding({
    jobType,
    biweeklyGross: currentBiweeklyGross,
  });
  const next = estimateBiweeklyWithholding({
    jobType,
    biweeklyGross: currentBiweeklyGross + extraGross,
  });
  const extraTax = Math.max(0, next.tax - current.tax);

  return {
    extraGross,
    extraTax,
    effectiveMarginalRate: extraTax / extraGross,
  };
}

function estimateAbilityTax(gross: number): number {
  const first = MONOTONIC_ABILITY_KNOTS[0];
  const last = MONOTONIC_ABILITY_KNOTS[MONOTONIC_ABILITY_KNOTS.length - 1];

  if (gross <= first.gross) {
    return interpolate({ gross: 0, tax: 0 }, first, gross);
  }

  for (let index = 1; index < MONOTONIC_ABILITY_KNOTS.length; index += 1) {
    const left = MONOTONIC_ABILITY_KNOTS[index - 1];
    const right = MONOTONIC_ABILITY_KNOTS[index];

    if (gross <= right.gross) {
      return interpolate(left, right, gross);
    }
  }

  const previous = MONOTONIC_ABILITY_KNOTS[MONOTONIC_ABILITY_KNOTS.length - 2];
  const lastMarginalRate = segmentSlope(previous, last);
  const extrapolatedTax = last.tax + (gross - last.gross) * lastMarginalRate;

  return Math.min(extrapolatedTax, gross * MAX_EXTRAPOLATED_WITHHOLDING_RATE);
}

function interpolate(left: WithholdingKnot, right: WithholdingKnot, gross: number) {
  return left.tax + (gross - left.gross) * segmentSlope(left, right);
}

function segmentSlope(left: WithholdingKnot, right: WithholdingKnot): number {
  const grossDelta = right.gross - left.gross;

  if (grossDelta <= 0) {
    return 0;
  }

  return Math.max(0, (right.tax - left.tax) / grossDelta);
}

function enforceMonotonicKnots(
  knots: readonly WithholdingKnot[],
): readonly WithholdingKnot[] {
  // The real Ability paystub knots are already sorted and nondecreasing. This
  // clamp is the phase-1 monotonicity enforcement: if a future calibration row
  // has a small noisy tax dip, every later segment keeps a nonnegative slope
  // while preserving the trusted observed values whenever they are monotonic.
  let highestTax = 0;

  return knots.map((knot) => {
    highestTax = Math.max(highestTax, knot.tax);
    return { gross: knot.gross, tax: highestTax };
  });
}
