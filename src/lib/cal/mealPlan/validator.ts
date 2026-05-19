import type { CalTargets, CalTotals } from "../types";
import type { MealPlan, ValidationResult } from "./types";

export function validateMealPlan(
  _plan: MealPlan | null,
  _targets: CalTargets,
  _currentTotals: CalTotals,
): ValidationResult {
  throw new Error("Meal plan validator is not implemented yet.");
}
