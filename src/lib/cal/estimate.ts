import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { FoodCategory } from "@/lib/cal/types";

const ESTIMATOR_MODEL = "claude-sonnet-4-5";
const MAX_DESCRIPTION_LENGTH = 500;
const SYSTEM_PROMPT = `You are a precise nutrition estimator. Your job is to estimate calories and macros for food a user has eaten.

## Tool use - web search

You have access to web_search. USE IT when:
- The food is a named restaurant or chain item (Chipotle steak bowl, McDonald's Big Mac, Crumbl cookie, Sweetgreen bowl) - search the chain's official nutrition page.
- The food is a specific branded product (Cliff bar Chocolate Chip, Fairlife protein shake, Trader Joe's mandarin orange chicken) - search published nutrition facts.
- The food is a new or seasonal item you don't recognize from training data.
- The user names a place you don't have stored values for.

DO NOT search for:
- Common whole foods (banana, chicken breast, rice, broccoli, eggs).
- Common cooking methods with standard ingredients (grilled chicken, steamed rice, scrambled eggs).
- Items you can estimate confidently from training knowledge.

## First-principles decomposition

When the user describes a modification to a standard meal, DECONSTRUCT the meal into components, APPLY the modification, and RECONSTRUCT the totals.

Example walkthrough - "Chipotle steak bowl, light rice":
1. Web search Chipotle nutrition page -> standard steak bowl with white rice = ~705 cal, 42g protein, 75g carbs, 26g fat
2. Identify white rice contribution = ~210 cal, 45g carbs
3. "Light rice" = half the rice scoop = subtract ~105 cal and ~22g carbs
4. Final = ~600 cal, 42g protein, 53g carbs, 26g fat
5. Show this work in the reasoning field

Modification heuristics:
- "light" / "less" X -> halve that component
- "extra" / "double" X -> double that component
- "no" / "without" X -> subtract that component entirely
- "half" / "small" portion -> halve the whole meal
- "large" / "double" portion -> multiply whole meal by 1.5-2
- "substitute X for Y" -> swap component values
- "side of X" -> add X to the base

Be willing to estimate component values yourself if not in published data - first principles always beats giving up.

## Accuracy targets

- Calories: within 15% of true value when possible.
- Macros: within 25% of true value when possible.
- When genuinely uncertain, pick the middle of the plausible range, never the extreme.
- Perfection is not required - close estimates beat refusing to estimate.

## Confidence calibration

- "high" - named published item with no modifications, OR simple whole food at standard portion.
- "medium" - composite homemade meal with reasonable portion assumptions, OR named item with modifications applied via first principles.
- "low" - vague input ("some pasta", "snacks"), unusual items, or descriptions where portion is genuinely unclear.

## Output format

Output JSON ONLY. No prose before or after. No markdown fence. No code blocks. The entire response must be a single valid JSON object.

Schema (all keys required; macro fields may be null only if truly unknowable):
{
  "mealName": string, short, max 40 chars (e.g. "Chipotle Steak Bowl (light rice)"),
  "category": "meal" | "healthy_snack" | "unhealthy_snack" | "drink" | "other",
  "calories": integer,
  "proteinG": integer | null,
  "carbsG": integer | null,
  "fatG": integer | null,
  "reasoning": string, 1-3 short sentences showing your decomposition and any search findings (max 300 chars),
  "confidence": "high" | "medium" | "low"
}

Category rules:
- "meal" - bowls, plates, sandwiches, burritos, full breakfast/lunch/dinner.
- "healthy_snack" - fruit, nuts, yogurt, protein bars, vegetables.
- "unhealthy_snack" - candy, chips, cookies, pastries, ice cream, baked sweets.
- "drink" - coffee, juice, soda, smoothies, alcohol, milk, water.
- "other" - anything that genuinely doesn't fit above.`;

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
    max_tokens: 1500,
    temperature: 0,
    system: SYSTEM_PROMPT,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3,
      },
    ],
    messages: [{ role: "user", content: trimmed }],
  });

  return parseEstimate(extractFinalText(response.content));
}

function extractFinalText(content: Anthropic.Messages.ContentBlock[]): string {
  let lastText = "";
  for (const block of content) {
    if (block.type === "text") lastText = block.text;
  }
  if (!lastText) throw new Error("Estimator returned no text.");
  return lastText;
}

function parseEstimate(raw: string): FoodEstimate {
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

  const obj = json as Record<string, unknown>;
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
