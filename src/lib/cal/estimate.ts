import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { FoodCategory } from "@/lib/cal/types";

const ESTIMATOR_MODEL = "claude-haiku-4-5";
const MAX_DESCRIPTION_LENGTH = 500;

export type FoodEstimate = {
  mealName: string;
  category: FoodCategory;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  reasoning: string;
  confidence: "high" | "medium" | "low";
};

export async function estimateFood(description: string): Promise<FoodEstimate> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Estimator unavailable: ANTHROPIC_API_KEY not set.");
  }

  const trimmed = description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  if (!trimmed) {
    throw new Error("Describe what you ate.");
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: ESTIMATOR_MODEL,
    max_tokens: 400,
    temperature: 0,
    system: `You are a nutrition estimator. Given a description of food, output a JSON estimate of calories and macros.

Rules:
- Use USDA FoodData Central values as your mental reference.
- For named restaurant items (McDonald's Big Mac, Chipotle bowl), use known published values.
- For homemade meals, use standard portions unless the user specifies (e.g., "large", "half").
- Account for cooking method: fried adds ~80-150 cal vs grilled.
- Composite meals: sum the parts.
- When uncertain, lean toward a conservative middle estimate, not the highest plausible value.
- Output JSON ONLY. No prose before or after. No markdown fence.

Category rules:
- "meal" - full meal (breakfast/lunch/dinner, sandwiches, bowls, plates)
- "healthy_snack" - fruit, nuts, yogurt, protein bars, vegetables
- "unhealthy_snack" - candy, chips, cookies, pastries, ice cream
- "drink" - coffee, juice, soda, smoothies, alcohol, milk
- "other" - anything else

Confidence rules:
- "high" - common named item or simple food with standard portion (e.g., "1 banana", "Big Mac")
- "medium" - composite meal with reasonable portion assumptions (e.g., "chicken pasta")
- "low" - vague input or unusual item (e.g., "Mom's stew", "some snacks")

JSON shape (all keys required, macros may be null if unknowable):
{
  "mealName": string (short, max 40 chars),
  "category": "meal" | "healthy_snack" | "unhealthy_snack" | "drink" | "other",
  "calories": integer,
  "proteinG": integer | null,
  "carbsG": integer | null,
  "fatG": integer | null,
  "reasoning": string (one short sentence explaining the estimate),
  "confidence": "high" | "medium" | "low"
}`,
    messages: [{ role: "user", content: trimmed }],
  });

  return parseEstimate(extractText(response.content));
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) {
    throw new Error("Estimator returned no text.");
  }

  const textBlock = content.find(
    (block): block is { type: string; text?: string } =>
      Boolean(block) &&
      typeof block === "object" &&
      "type" in block &&
      (block as { type?: unknown }).type === "text",
  );

  if (!textBlock?.text) {
    throw new Error("Estimator returned no text.");
  }

  return textBlock.text;
}

function parseEstimate(raw: string): FoodEstimate {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim());
  } catch {
    throw new Error("Estimator returned invalid JSON.");
  }

  if (typeof json !== "object" || json === null) {
    throw new Error("Estimator returned malformed response.");
  }

  const obj = json as Record<string, unknown>;
  const mealName = String(obj.mealName ?? "").slice(0, 40).trim();
  const category = parseCategory(obj.category);
  const calories = toInteger(obj.calories, "calories");
  if (calories === null || calories < 0) {
    throw new Error("Estimator returned invalid calories.");
  }

  return {
    mealName: mealName || "Estimated food",
    category,
    calories,
    proteinG: toOptionalInteger(obj.proteinG),
    carbsG: toOptionalInteger(obj.carbsG),
    fatG: toOptionalInteger(obj.fatG),
    reasoning: String(obj.reasoning ?? "").slice(0, 200),
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

function toInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Estimator returned invalid ${label}.`);
  return Math.round(n);
}

function toOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}
