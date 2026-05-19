"use server";

import { revalidatePath } from "next/cache";

import type {
  CandidatePool,
  MealPlan,
  MealPlanAxioms,
  ValidationResult,
} from "@/lib/cal/mealPlan/types";

export async function generateMealPlanAction(
  _axioms: MealPlanAxioms,
): Promise<{
  pool: CandidatePool;
  plan: MealPlan | null;
  validation: ValidationResult;
}> {
  throw new Error("Not implemented yet — Phase 6.");
}

export async function acceptMealPlanAction(
  _plan: MealPlan,
): Promise<{ ok: true; loggedEntryIds: string[] }> {
  revalidatePath("/cal");
  throw new Error("Not implemented yet — Phase 6.");
}
