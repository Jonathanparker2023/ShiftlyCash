import type { FoodCategory } from "@/lib/cal/types";

export type FoodEstimate = {
  mealName: string;
  category: FoodCategory;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  addedSugarG: number | null;
  saturatedFatG: number | null;
  reasoning: string;
  confidence: "high" | "medium" | "low";
};

export function parseEstimateResponse(raw: string): FoodEstimate[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    throw new Error("Estimator returned invalid JSON.");
  }

  if (typeof json !== "object" || json === null) {
    throw new Error("Estimator returned malformed response.");
  }

  const items = Array.isArray(json) ? json : [json];
  if (items.length === 0) {
    throw new Error("Estimator returned no food estimates.");
  }

  return items.map(parseEstimateItem);
}

function parseEstimateItem(item: unknown): FoodEstimate {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new Error("Estimator returned malformed food estimate.");
  }

  const obj = item as Record<string, unknown>;
  const calories = toInteger(obj.calories);
  if (calories === null || calories < 0) {
    throw new Error("Estimator returned invalid calories.");
  }

  return {
    mealName: String(obj.mealName ?? "").slice(0, 40).trim() || "Estimated food",
    category: parseCategory(obj.category),
    calories,
    proteinG: toOptionalInteger(obj.proteinG),
    carbsG: toOptionalInteger(obj.carbsG),
    fatG: toOptionalInteger(obj.fatG),
    fiberG: toOptionalInteger(obj.fiberG),
    sodiumMg: toOptionalInteger(obj.sodiumMg),
    addedSugarG: toOptionalInteger(obj.addedSugarG),
    saturatedFatG: toOptionalInteger(obj.saturatedFatG),
    reasoning: String(obj.reasoning ?? "").slice(0, 300),
    confidence: parseConfidence(obj.confidence),
  };
}

function parseCategory(value: unknown): FoodCategory {
  const valid: FoodCategory[] = [
    "meal",
    "healthy_snack",
    "unhealthy_snack",
    "drink",
    "other",
  ];
  if (typeof value === "string" && valid.includes(value as FoodCategory)) {
    return value as FoodCategory;
  }
  return "meal";
}

function parseConfidence(value: unknown): "high" | "medium" | "low" {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function toInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function toOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}
