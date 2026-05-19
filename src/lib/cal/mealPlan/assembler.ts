import type { CandidatePool, MealPlan, MealPlanCandidate } from "./types";

export function assembleMealPlan(
  _pool: CandidatePool,
  _lockedMain?: MealPlanCandidate,
): MealPlan | null {
  throw new Error("Meal plan assembler is not implemented yet.");
}
