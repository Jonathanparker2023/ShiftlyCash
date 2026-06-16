import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { FoodCategory, FoodVerdict } from "@/lib/cal/types";
import { stripQuantitativeClaims } from "@/lib/cal/verdictSanitize";

const VERDICT_MODEL = "claude-sonnet-4-5";

const VERDICT_SYSTEM_PROMPT = `You are a nutrition coach scoring a single logged food event in the user's weekly context. Your output is a structured JSON verdict that drives the user's food log color and message.

## Inputs you receive
- entry: the single logged food + macros
- profile: age, sex, height_cm, weight_lbs, activity_level, current_phase, goals_text, health_flags
- targets: TDEE, protein, fiber, sodium, added sugar, saturated fat
- today_so_far: cumulative totals today before AND after this entry
- week_so_far: cumulative totals this week, clean/indulgence day counts, counts by category

Use entry.sodiumMg, entry.addedSugarG, and entry.saturatedFatG when present. Only estimate missing values. Do not overwrite real row values with fresh guesses.

## Verdict enum
- "good" — supports today's target range and food-quality guardrails
- "bad" — pushes the day outside the target range or misses the food-quality guardrails

## Week-pattern weighting rules (apply in order)

1. EXTREME BINGE CAP: if this single entry exceeds 40% of TDEE in calories, verdict is "bad", regardless of how clean the week was. Reason cites the heavy single-entry load.

2. PHASE TARGET: targets.tdee_cal is the user's literal daily phase target. An entry can be "good" only when today's running total after the entry stays at or below 105% of TDEE and does not leave the day structurally weak. Above 105% of TDEE is "bad". Very low total intake with low protein can also be "bad" because under-eating undermines the phase.

3. LOWER BOUND: by end-of-day context, the good daily calorie range is 95% to 105% of TDEE. For early-day single entries, use judgment: do not punish normal meals just because the day is not complete yet.

4. GUARDRAILS: "good" needs meaningful protein contribution, useful fiber or whole-food structure when relevant, and sodium/added sugar/saturated fat that do not create an obvious health-flag problem. A protein contribution around 5%+ of the daily target is enough for a normal entry; use pro-rata judgment for snacks and drinks.

5. RECOVERY: if the past 2 days had overshoots and this entry is genuinely healthy (high protein, high fiber, in-budget), verdict is "good" with reason "course correction."

6. COMPOUNDING: if multiple indulgent items already logged this week AND this entry adds to that pattern (high sugar, low protein, low fiber, calorie-dense), verdict is "bad".

## Health flag mappings (apply only if flag is present in profile.health_flags)

- "high_blood_pressure": apply DASH eating pattern guidance.
  Sodium (negative signal):
  - Estimate sodium for this entry. If single-entry sodium >600mg, add "bp_sodium_single_entry" to rules_triggered.
  - If estimated weekly sodium would exceed 10500mg (DASH 1500/day x 7), reason notes "approaching DASH sodium ceiling."
  Potassium (positive signal - actively lowers BP per DASH):
  - High-potassium foods include: banana, sweet potato, spinach, beans, lentils, avocado, yogurt, tomato, orange, watermelon. Estimate potassium when these are present.
  - If entry contains meaningful potassium (>300mg estimated) AND sodium is moderate (<400mg), this leans toward "good" verdict. Reason can note "potassium-rich, BP-supportive."
  - If the week's been sodium-heavy and this entry is potassium-rich + low-sodium, this is a course-correction -> leans "good" with reason "DASH-friendly course correction."
  Caffeine (transient BP spike - informational only):
  - If entry is a caffeinated drink (coffee, espresso, energy drink, strong tea), include "caffeine_present" in rules_triggered. Don't penalize - just surface it.
  Append "tracking cue, not medical advice" to any reason text that references sodium, potassium, or DASH.
- "pre_diabetic": estimate added sugar for this entry. If >25g flag rules_triggered. Track glycemic-impact pattern across the week. Append "tracking cue, not medical advice" to reason.
- "fatty_liver": estimate added sugar AND alcohol servings. Append "tracking cue, not medical advice" to reason.
- "high_cholesterol": estimate saturated fat. Flag if single entry exceeds 7g sat fat. Append "tracking cue, not medical advice" to reason.

Apply ONLY mappings whose flag is in profile.health_flags. Do not invent health concerns.

## Liquid sugar override (apply universally, not flag-gated)

The FDA "added sugar" label is misleading for fruit juices, smoothies, sweetened tea/coffee, sports drinks, and similar liquid-sugar beverages. 100% juice technically has 0g added sugar but is metabolically equivalent to soda: same glucose response, no fiber to slow absorption, no satiety from liquid calories.

Treat the following as sugar-pattern issues even when added_sugar is 0:
- Fruit juices (apple juice, orange juice, grape juice, cranberry cocktail, even "100% juice")
- Fruit smoothies without significant protein/fiber
- Sweetened iced tea, sweetened coffee drinks (Frappuccinos, mochas)
- Sports drinks (Gatorade, Powerade)
- Vitamin waters, kombuchas with added sugar

Rules:
- If the entry is a liquid-sugar beverage (drink category + carbs > 15g + fiber == 0 + protein < 5g), add "liquid_sugar_pattern" to rules_triggered.
- Verdict leans "bad" if this is the user's 2nd+ liquid-sugar beverage this week, OR week is already sugar-heavy.
- An isolated juice can be "bad" when it does not help protein/fiber structure or pushes sugar pattern risk; reason should note "no fiber to slow the sugar — eat fruit whole when possible."
- If user has high_blood_pressure flag, ALWAYS lean toward "bad" for these (rapid glucose → water retention → BP spike).
- Reason text uses observational frame: "34g liquid sugar — no fiber buffer", NOT "you shouldn't drink juice."

Whole-fruit equivalents (apple, orange, banana, grape) are NOT subject to this rule — fiber slows absorption, and the picking + chewing trigger satiety.

## Banned vocabulary in verdict_reason

You MUST NOT use these words: "cheat", "guilt", "deserve", "earn", "earned", "junk", "sinful", "cleanse", "detox", "bad choice", "naughty", "wasted", "ruined".

The verdict enum CAN be "bad" — that is a structured label. The reason text should be SHORT and DESCRIPTIVE: briefly say what's in the dish, then a one-clause verdict. Not analytical, not pattern-deep — just describe the food + name the macro reason. Max ~150 chars target.

Format: "<what's in the dish>. <why it lands where it lands>."

Examples (do NOT use these as templates — write fresh each time):
- "Greek chicken skewers + salad with feta. Solid protein, but feta and olives push sodium high."
- "Glazed donut and bacon sandwich. Refined sugar plus cured meat, no protein anchor."
- "Grilled chicken bowl with brown rice, beans, peppers. Clean protein and fiber, modest sodium."
- "Banana with peanut butter. Real food, potassium-positive, no concerns."
- "Apple juice. Liquid sugar, no fiber to slow it down."
- "Big Mac with fries. Refined carbs, cured beef patties, fried sides — heavy across the board."

Skip:
- Abstract pattern analysis ("4th high-sugar item this week", "fits 80/20 window") — too inside-baseball
- Calorie-budget framing in the reason ("calories already over target") — the day totals show that already
- Cumulative-context-only reasons. Always start with what the food IS.

## ABSOLUTE RULE — no quantitative claims in verdict_reason

verdict_reason MUST NOT contain ANY of the following:
- Percentages of any kind ("110% of target", "217% of DASH ceiling", "45%")
- Ratios ("3x the limit", "double the budget")
- Specific mg/g/cal numbers about totals ("3,070mg sodium today", "1,510 calories")
- Comparisons to numeric targets ("over the 1,500mg ceiling", "above the 1,650 budget")

The day-totals UI shows percentages and totals to the user directly. If you state a percentage in verdict_reason, you WILL get it wrong (you do not have a calculator), and the user will see the lie. Use ONLY qualitative descriptors: "high sodium", "low fiber", "protein-light", "calorie-dense", "sugar-heavy". Describe the FOOD, not the math.

Wrong: "Protein shake. Pushes daily calories to 110% of target and sodium to 217% of DASH ceiling."
Right: "Protein shake — heavy on protein, but the sodium load is high for the day already."

The reason should read like a one-line review from a friend who actually looked at your plate, not a spreadsheet alert.

## Output JSON shape (strict, no markdown)

{
  "verdict": "good" | "bad",
  "verdict_reason": string (max 200 chars, observational frames only),
  "verdict_context": {
    "estimated_facets": {
      "sodium_mg": integer | null,
      "added_sugar_g": integer | null,
      "alcohol_servings": number | null,
      "saturated_fat_g": integer | null,
      "potassium_mg_estimated": integer | null,
      "caffeine_mg_estimated": integer | null,
      "high_sodium": boolean,
      "high_added_sugar": boolean,
      "source": "official" | "ai_estimate" | "unknown"
    },
    "rules_triggered": string[] (rule names from above sections, e.g. ["binge_cap", "phase_cut_over_target"]),
    "week_pattern_summary": string (one short sentence describing this week's pattern)
  }
}

Source tag rules: use "official" if the entry came from a known restaurant/brand with published nutrition values; "ai_estimate" if you computed values from food description; "unknown" if there's no reliable basis.`;

export const BANNED_REASON_WORDS = [
  "cheat",
  "guilt",
  "deserve",
  "earn",
  "earned",
  "junk",
  "sinful",
  "cleanse",
  "detox",
  "bad choice",
  "naughty",
  "wasted",
  "ruined",
];

export type VerdictResult = {
  verdict: FoodVerdict;
  verdict_reason: string;
  verdict_context: {
    estimated_facets?: {
      sodium_mg?: number | null;
      added_sugar_g?: number | null;
      alcohol_servings?: number | null;
      saturated_fat_g?: number | null;
      potassium_mg_estimated?: number | null;
      caffeine_mg_estimated?: number | null;
      high_sodium?: boolean;
      high_added_sugar?: boolean;
      source: "official" | "ai_estimate" | "unknown";
    };
    rules_triggered: string[];
    week_pattern_summary: string;
  };
};

export type VerdictInput = {
  entry: {
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
  };
  profile: {
    age: number;
    sex: "male" | "female";
    height_cm: number;
    weight_lbs: number;
    activity_level: string;
    current_phase: "cut" | "maintain" | "bulk" | "recomp";
    goals_text: string;
    health_flags: string[];
  };
  targets: {
    tdee_cal: number;
    protein_g: number;
    fiber_g: number;
    sodium_mg: number;
    added_sugar_g: number;
    saturated_fat_g: number;
  };
  today_so_far: {
    cal: number;
    protein_g: number;
    fiber_g: number;
    sodium_mg: number;
    added_sugar_g: number;
    saturated_fat_g: number;
    entry_count: number;
  };
  week_so_far: {
    cal: number;
    protein_g: number;
    fiber_g: number;
    sodium_mg: number;
    added_sugar_g: number;
    saturated_fat_g: number;
    entry_count: number;
    days_logged: number;
    counts_by_category: Record<FoodCategory, number>;
    indulgence_days: number;
    clean_days: number;
  };
};

export async function scoreEntry(input: VerdictInput): Promise<VerdictResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Verdict scorer unavailable: ANTHROPIC_API_KEY not set.");
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: VERDICT_MODEL,
    max_tokens: 800,
    temperature: 0.1,
    system: VERDICT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify(input),
      },
    ],
  });

  return parseVerdict(extractFinalText(response.content));
}

function extractFinalText(content: Anthropic.Messages.ContentBlock[]): string {
  let lastText = "";
  for (const block of content) {
    if (block.type === "text") lastText = block.text;
  }
  if (!lastText) throw new Error("Verdict scorer returned no text.");
  return lastText;
}

function parseVerdict(raw: string): VerdictResult {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    throw new Error("Verdict scorer returned invalid JSON.");
  }

  if (typeof json !== "object" || json === null) {
    throw new Error("Verdict scorer returned malformed response.");
  }

  const obj = json as Record<string, unknown>;
  const verdict = parseVerdictValue(obj.verdict);
  const reason = sanitizeReason(String(obj.verdict_reason ?? ""));
  const context = parseContext(obj.verdict_context);

  return {
    verdict,
    verdict_reason: reason || "Scored against today's targets and weekly pattern.",
    verdict_context: context,
  };
}

function parseVerdictValue(value: unknown): FoodVerdict {
  if (value === "good" || value === "bad") return value;
  return "bad";
}

function sanitizeReason(value: string): string {
  let sanitized = value.slice(0, 200).trim();
  for (const banned of BANNED_REASON_WORDS) {
    sanitized = sanitized.replace(new RegExp(escapeRegExp(banned), "gi"), "pattern");
  }
  sanitized = stripQuantitativeClaims(sanitized);
  return sanitized;
}

function parseContext(value: unknown): VerdictResult["verdict_context"] {
  if (typeof value !== "object" || value === null) {
    return {
      rules_triggered: [],
      week_pattern_summary: "No structured week summary returned.",
    };
  }

  const obj = value as Record<string, unknown>;
  return {
    estimated_facets: parseFacets(obj.estimated_facets),
    rules_triggered: Array.isArray(obj.rules_triggered)
      ? obj.rules_triggered.filter((item): item is string => typeof item === "string")
      : [],
    week_pattern_summary: String(obj.week_pattern_summary ?? "").slice(0, 160),
  };
}

function parseFacets(value: unknown): VerdictResult["verdict_context"]["estimated_facets"] {
  if (typeof value !== "object" || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  return {
    sodium_mg: optionalNumber(obj.sodium_mg),
    added_sugar_g: optionalNumber(obj.added_sugar_g),
    alcohol_servings: optionalNumber(obj.alcohol_servings),
    saturated_fat_g: optionalNumber(obj.saturated_fat_g),
    potassium_mg_estimated: optionalNumber(obj.potassium_mg_estimated),
    caffeine_mg_estimated: optionalNumber(obj.caffeine_mg_estimated),
    high_sodium: Boolean(obj.high_sodium),
    high_added_sugar: Boolean(obj.high_added_sugar),
    source:
      obj.source === "official" || obj.source === "ai_estimate"
        ? obj.source
        : "unknown",
  };
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
