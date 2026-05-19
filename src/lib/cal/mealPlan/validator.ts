import type {
  CandidatePool,
  MealPlan,
  MealPlanCandidate,
  RemainingTargets,
  ValidationGap,
  ValidationResult,
} from "./types";

type Metric = ValidationGap["metric"];
type Direction = ValidationGap["direction"];
type ToleranceBucket = "calories" | "macros" | "ceilings";

const METRICS: Metric[] = [
  "calories",
  "proteinG",
  "carbsG",
  "fiberG",
  "fatG",
  "sodiumMg",
  "addedSugarG",
  "saturatedFatG",
];

const TIER_TOLERANCE = {
  database: { calories: 0.03, macros: 0.05, ceilings: 0.05 },
  published: { calories: 0.1, macros: 0.15, ceilings: 0.1 },
  inferred: { calories: 0.2, macros: 0.3, ceilings: 0.25 },
} as const;

export function validateMealPlan(
  plan: MealPlan,
  remainingTargets: RemainingTargets,
  pool: CandidatePool,
): ValidationResult {
  const candidates = [plan.main, ...plan.fillers];
  const gaps = METRICS.flatMap((metric) => {
    const actual = plan.totals[metric];
    const target = remainingTargets[metric];
    const tolerance = toleranceFor(metric, candidates);

    if (passesMetric(metric, actual, target, tolerance, pool)) return [];

    const direction: Direction = actual < target ? "short" : "over";
    const gapAmount = Math.abs(actual - target);

    return [
      {
        metric,
        target,
        actual,
        deltaPct: deltaPct(actual, target),
        direction,
        remediation: suggestRemediation(
          metric,
          direction,
          gapAmount,
          plan,
          pool,
        ),
      },
    ];
  });

  if (gaps.length === 0) return { ok: true, plan };
  return { ok: false, bestAttempt: plan, gaps };
}

function toleranceFor(
  metric: Metric,
  candidates: MealPlanCandidate[],
): number {
  const bucket = toleranceBucket(metric);

  return candidates.reduce((total, candidate) => {
    const value = macroValue(candidate, metric);
    return total + value * TIER_TOLERANCE[candidate.tier][bucket];
  }, 0);
}

function toleranceBucket(metric: Metric): ToleranceBucket {
  if (metric === "calories") return "calories";
  if (
    metric === "sodiumMg" ||
    metric === "addedSugarG" ||
    metric === "saturatedFatG"
  ) {
    return "ceilings";
  }
  return "macros";
}

function passesMetric(
  metric: Metric,
  actual: number,
  target: number,
  tolerance: number,
  pool: CandidatePool,
): boolean {
  const mode = metricMode(metric, pool);

  if (mode === "floor") return actual >= target - tolerance;
  if (mode === "ceiling") return actual <= target + tolerance;
  return Math.abs(actual - target) <= tolerance;
}

function metricMode(
  metric: Metric,
  pool: CandidatePool,
): "centered" | "floor" | "ceiling" {
  if (metric === "proteinG" || metric === "fiberG") return "floor";
  if (
    metric === "sodiumMg" ||
    metric === "addedSugarG" ||
    metric === "saturatedFatG"
  ) {
    return "ceiling";
  }
  if (metric === "carbsG") {
    if (pool.axioms.carbMode === "high") return "floor";
    if (pool.axioms.carbMode === "low") return "ceiling";
  }
  return "centered";
}

function suggestRemediation(
  metric: Metric,
  direction: Direction,
  gapAmount: number,
  plan: MealPlan,
  pool: CandidatePool,
): string {
  if (direction === "short") {
    const filler = bestFillerForGap(metric, gapAmount, plan, pool.fillers);
    if (!filler) return fallbackRemediation(gapAmount, metric, direction);

    return `${label(metric)} short by ${formatAmount(
      gapAmount,
      metric,
    )} — add ${filler.name} (+${formatAmount(
      macroValue(filler, metric),
      metric,
    )}${additiveLabelSuffix(metric)}).`;
  }

  const suggestedMain = lowestAlternateMain(metric, plan.main, pool);
  if (!suggestedMain) return fallbackRemediation(gapAmount, metric, direction);

  return `${label(metric)} over by ${formatAmount(
    gapAmount,
    metric,
  )} — swap ${plan.main.name} for ${suggestedMain.name}.`;
}

function bestFillerForGap(
  metric: Metric,
  gapAmount: number,
  plan: MealPlan,
  fillers: MealPlanCandidate[],
): MealPlanCandidate | null {
  const usedIds = new Set(plan.fillers.map((filler) => filler.id));
  const closingFillers = fillers
    .map((filler) => ({ filler, value: macroValue(filler, metric) }))
    .filter(({ filler, value }) => !usedIds.has(filler.id) && value > 0)
    .filter(({ value }) => value >= gapAmount);

  if (closingFillers.length === 0) {
    const helpfulFillers = fillers
      .map((filler) => ({ filler, value: macroValue(filler, metric) }))
      .filter(({ filler, value }) => !usedIds.has(filler.id) && value > 0);

    if (helpfulFillers.length === 0) return null;

    helpfulFillers.sort((left, right) => right.value - left.value);
    return helpfulFillers[0].filler;
  }

  closingFillers.sort((left, right) => {
    const leftMiss = Math.abs(left.value - gapAmount);
    const rightMiss = Math.abs(right.value - gapAmount);
    return leftMiss - rightMiss;
  });

  return closingFillers[0].filler;
}

function lowestAlternateMain(
  metric: Metric,
  currentMain: MealPlanCandidate,
  pool: CandidatePool,
): MealPlanCandidate | null {
  const currentValue = macroValue(currentMain, metric);
  const alternates = pool.mains
    .filter((main) => main.id !== currentMain.id)
    .filter((main) => isEligibleSuggestedMain(main, pool))
    .filter((main) => macroValue(main, metric) < currentValue);

  if (alternates.length === 0) return null;

  return alternates.reduce((lowest, main) =>
    macroValue(main, metric) < macroValue(lowest, metric) ? main : lowest,
  );
}

function isEligibleSuggestedMain(
  main: MealPlanCandidate,
  pool: CandidatePool,
): boolean {
  if (
    pool.axioms.eatOut &&
    pool.axioms.requireDoorDash &&
    !pool.axioms.allowNonDoorDashMain &&
    main.doordashUrl === null
  ) {
    return false;
  }

  if (pool.axioms.carbMode === "low" && main.macros.carbsG > 80) {
    return false;
  }

  return true;
}

function fallbackRemediation(
  gapAmount: number,
  metric: Metric,
  direction: Direction,
): string {
  return `${label(metric)} ${direction === "short" ? "short" : "over"} by ${formatAmount(
    gapAmount,
    metric,
  )} — no candidate in the pool would close this. Try a different axiom (allow non-DoorDash main, broaden location) or regenerate.`;
}

function macroValue(candidate: MealPlanCandidate, metric: Metric): number {
  return candidate.macros[metric] ?? 0;
}

function deltaPct(actual: number, target: number): number {
  if (target === 0) {
    if (actual === 0) return 0;
    return actual > 0 ? 100 : -100;
  }
  return ((actual - target) / target) * 100;
}

function label(metric: Metric): string {
  switch (metric) {
    case "calories":
      return "Calories";
    case "proteinG":
      return "Protein";
    case "carbsG":
      return "Carbs";
    case "fiberG":
      return "Fiber";
    case "fatG":
      return "Fat";
    case "sodiumMg":
      return "Sodium";
    case "addedSugarG":
      return "Added sugar";
    case "saturatedFatG":
      return "Saturated fat";
  }
}

function shortLabel(metric: Metric): string {
  switch (metric) {
    case "calories":
      return "cal";
    case "sodiumMg":
      return "sodium";
    case "addedSugarG":
      return "added sugar";
    case "saturatedFatG":
      return "saturated fat";
    default:
      return label(metric).toLowerCase();
  }
}

function additiveLabelSuffix(metric: Metric): string {
  if (metric === "calories") return "";
  return ` ${shortLabel(metric)}`;
}

function formatAmount(amount: number, metric: Metric): string {
  const rounded = Math.round(amount);
  if (metric === "calories") return `${rounded} cal`;
  if (metric === "sodiumMg") return `${rounded}mg`;
  return `${rounded}g`;
}
