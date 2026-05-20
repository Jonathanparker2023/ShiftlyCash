import type {
  AssembleOpts,
  CandidatePool,
  MealPlan,
  MealPlanCandidate,
  RemainingTargets,
} from "./types";

export type { AssembleOpts, RemainingTargets } from "./types";

const DEFAULT_MAX_FILLERS = 4;
const LOW_CARB_MAIN_CAP_G = 80;
const LOW_CARB_FILLER_CAP_G = 30;
const SCORE_EPSILON = 1e-12;
const CENTERED_TOLERANCE_PCT = 0.1;
const CALORIE_UNDERFILL_THRESHOLD = 0.8;
const CALORIE_UNDERFILL_WEIGHT = 1.5;
const INDIFFERENT_CARB_OVERSHOOT_WEIGHT = 0.35;

const WEIGHTS = {
  calories: 1.0,
  proteinG: 1.5,
  carbsG: 1.0,
  fiberG: 0.8,
  fatG: 0.5,
  sodiumMg: 0.8,
  addedSugarG: 1.0,
  saturatedFatG: 0.7,
} as const;

const TIER_RANK = {
  database: 3,
  published: 2,
  inferred: 1,
} as const;

export function assembleMealPlan(
  pool: CandidatePool,
  remainingTargets: RemainingTargets,
  opts: AssembleOpts = {},
): MealPlan | null {
  if (pool.unfetchedReason !== null) return null;

  const eligibleMains = filterMains(pool, opts);
  if (eligibleMains.length === 0) return null;

  const eligibleFillers = filterFillers(pool, opts);
  const maxFillers = normalizeMaxFillers(opts.maxFillers);

  let best: { plan: MealPlan; score: number } | null = null;
  const subsetCount = 1 << eligibleFillers.length;

  for (const main of eligibleMains) {
    for (let mask = 0; mask < subsetCount; mask++) {
      if (popcount(mask) > maxFillers) continue;

      const fillers = fillersFromMask(eligibleFillers, mask);
      const plan = buildMealPlan(main, fillers);
      const score = scoreMealPlan(plan, remainingTargets, pool.axioms.carbMode);

      if (
        best === null ||
        score < best.score - SCORE_EPSILON ||
        (Math.abs(score - best.score) <= SCORE_EPSILON &&
          isBetterTieBreak(plan, best.plan))
      ) {
        best = { plan, score };
      }
    }
  }

  return best?.plan ?? null;
}

function filterMains(
  pool: CandidatePool,
  opts: AssembleOpts,
): MealPlanCandidate[] {
  const excluded = new Set(opts.excludeMainIds ?? []);

  let mains = pool.mains.filter((main) => !excluded.has(main.id));

  if (
    pool.axioms.eatOut &&
    pool.axioms.requireDoorDash &&
    !pool.axioms.allowNonDoorDashMain
  ) {
    mains = mains.filter((main) => main.doordashUrl !== null);
  }

  if (pool.axioms.carbMode === "low") {
    mains = mains.filter((main) => main.macros.carbsG <= LOW_CARB_MAIN_CAP_G);
  }

  if (opts.holdMainId) {
    mains = mains.filter((main) => main.id === opts.holdMainId);
  }

  return mains;
}

function filterFillers(
  pool: CandidatePool,
  opts: AssembleOpts,
): MealPlanCandidate[] {
  const excluded = new Set(opts.excludeFillerIds ?? []);
  let fillers = pool.fillers.filter((filler) => !excluded.has(filler.id));

  if (pool.axioms.carbMode === "low") {
    fillers = fillers.filter(
      (filler) => filler.macros.carbsG <= LOW_CARB_FILLER_CAP_G,
    );
  }

  return fillers;
}

function normalizeMaxFillers(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_FILLERS;
  if (!Number.isFinite(value)) return DEFAULT_MAX_FILLERS;
  return Math.max(0, Math.floor(value));
}

function fillersFromMask(
  fillers: MealPlanCandidate[],
  mask: number,
): MealPlanCandidate[] {
  const selected: MealPlanCandidate[] = [];
  for (let index = 0; index < fillers.length; index++) {
    if ((mask & (1 << index)) !== 0) selected.push(fillers[index]);
  }
  return selected;
}

function buildMealPlan(
  main: MealPlanCandidate,
  fillers: MealPlanCandidate[],
): MealPlan {
  return {
    main,
    fillers,
    totals: sumTotals([main, ...fillers]),
  };
}

function sumTotals(candidates: MealPlanCandidate[]): MealPlan["totals"] {
  return candidates.reduce<MealPlan["totals"]>(
    (totals, candidate) => ({
      calories: totals.calories + candidate.macros.calories,
      proteinG: totals.proteinG + candidate.macros.proteinG,
      carbsG: totals.carbsG + candidate.macros.carbsG,
      fiberG: totals.fiberG + candidate.macros.fiberG,
      fatG: totals.fatG + candidate.macros.fatG,
      sodiumMg: totals.sodiumMg + (candidate.macros.sodiumMg ?? 0),
      addedSugarG:
        totals.addedSugarG + (candidate.macros.addedSugarG ?? 0),
      saturatedFatG:
        totals.saturatedFatG + (candidate.macros.saturatedFatG ?? 0),
    }),
    {
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fiberG: 0,
      fatG: 0,
      sodiumMg: 0,
      addedSugarG: 0,
      saturatedFatG: 0,
    },
  );
}

function scoreMealPlan(
  plan: MealPlan,
  targets: RemainingTargets,
  carbMode: CandidatePool["axioms"]["carbMode"],
): number {
  let score = 0;

  score += calorieScore(plan.totals.calories, targets.calories);
  score += floorScore(plan.totals.proteinG, targets.proteinG, WEIGHTS.proteinG);
  score += carbScore(plan.totals.carbsG, targets.carbsG, carbMode);
  score += floorScore(plan.totals.fiberG, targets.fiberG, WEIGHTS.fiberG);
  score += fatScore(plan.totals.fatG, targets.fatG);
  score += ceilingScore(plan.totals.sodiumMg, targets.sodiumMg, WEIGHTS.sodiumMg);
  score += ceilingScore(
    plan.totals.addedSugarG,
    targets.addedSugarG,
    WEIGHTS.addedSugarG,
  );
  score += ceilingScore(
    plan.totals.saturatedFatG,
    targets.saturatedFatG,
    WEIGHTS.saturatedFatG,
  );

  return score;
}

function calorieScore(actual: number, target: number): number {
  const weight =
    target > 0 && actual < target * CALORIE_UNDERFILL_THRESHOLD
      ? CALORIE_UNDERFILL_WEIGHT
      : WEIGHTS.calories;
  return centeredScore(actual, target, weight);
}

function carbScore(
  actual: number,
  target: number,
  carbMode: CandidatePool["axioms"]["carbMode"],
): number {
  const weight = carbMode === "indifferent" ? WEIGHTS.carbsG : 1.5;
  if (carbMode === "low") return ceilingScore(actual, target, weight);
  if (carbMode === "high") return floorScore(actual, target, weight);
  return asymmetricCenteredScore(actual, target, {
    underWeight: WEIGHTS.carbsG,
    overWeight: INDIFFERENT_CARB_OVERSHOOT_WEIGHT,
    tolerancePct: CENTERED_TOLERANCE_PCT,
  });
}

function fatScore(actual: number, target: number): number {
  return asymmetricCenteredScore(actual, target, {
    underWeight: 0,
    overWeight: WEIGHTS.fatG,
    tolerancePct: CENTERED_TOLERANCE_PCT,
  });
}

function centeredScore(actual: number, target: number, weight: number): number {
  if (target <= 0) return 0;
  const deviation = (actual - target) / target;
  return weight * deviation * deviation;
}

function asymmetricCenteredScore(
  actual: number,
  target: number,
  opts: { underWeight: number; overWeight: number; tolerancePct: number },
): number {
  if (target <= 0) return 0;
  const deviation = (actual - target) / target;
  const excessDeviation = Math.max(
    0,
    Math.abs(deviation) - opts.tolerancePct,
  );
  const weight = deviation < 0 ? opts.underWeight : opts.overWeight;
  return weight * excessDeviation * excessDeviation;
}

function floorScore(actual: number, target: number, weight: number): number {
  if (target <= 0) return 0;
  const deviation = Math.max(0, (target - actual) / target);
  return weight * deviation * deviation;
}

function ceilingScore(actual: number, target: number, weight: number): number {
  if (target <= 0) return 0;
  const deviation = Math.max(0, (actual - target) / target);
  return weight * deviation * deviation;
}

function isBetterTieBreak(candidate: MealPlan, incumbent: MealPlan): boolean {
  const candidateTier = TIER_RANK[candidate.main.tier];
  const incumbentTier = TIER_RANK[incumbent.main.tier];
  if (candidateTier !== incumbentTier) return candidateTier > incumbentTier;

  if (candidate.fillers.length !== incumbent.fillers.length) {
    return candidate.fillers.length < incumbent.fillers.length;
  }

  return candidate.totals.sodiumMg < incumbent.totals.sodiumMg;
}

function popcount(value: number): number {
  let count = 0;
  let current = value;
  while (current > 0) {
    current &= current - 1;
    count++;
  }
  return count;
}
