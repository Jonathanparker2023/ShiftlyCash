import {
  extractExplicitNutritionOverrides,
  type ExplicitNutritionOverrides,
} from "@/lib/cal/manualNutrition";
import type { FoodCategory } from "@/lib/cal/types";

// ── Paste-to-log parser ──────────────────────────────────────────────
//
// Takes a pasted block of pre-calculated food lines (typically the
// output of the "Plan my day" handoff with GPT-5 or any other model that
// returned per-item macros) and turns each qualifying line into a food
// entry that can be inserted directly without an AI estimator call.
//
// One paste → many entries → zero API spend. Macros come back exactly
// as pasted, no re-estimation.

export type ParsedFoodLine = {
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

// Lines that should never be treated as food entries even if they
// happen to contain numbers.
const HEADER_HINTS = [
  /^what to eat\b/i,
  /^final totals?\b/i,
  /^macro summary\b/i,
  /^totals?:/i,
  /^breakfast\s*$/i,
  /^lunch\s*$/i,
  /^dinner\s*$/i,
  /^snack\s*$/i,
  /^plan\b/i,
  /^source(s)?:/i,
];

const TARGET_LINE_RE = /\/\s*\d+(?:\.\d+)?\s*(?:cal|g|mg)\b/i;
const VERDICT_MARK_RE = /[✅❌]/u;

const MACRO_HINT_RE =
  /\b(\d+(?:\.\d+)?)\s*(cal|kcal|calories?|g\b|gp?\b|gc\b|gf\b|gfi\b|mg)\b/i;

// Strip leading list / count markers. Covers:
//   • / - / * / – / — bullets
//   1. / 1) / 1: / 1, numbered prefixes
//   1   (digit followed by whitespace)
const LEADING_BULLET_RE =
  /^(?:[•\-*–—]|\d+\s*[).,:]|\d+\s+)\s*/;

export function parsePastedLog(input: string): ParsedFoodLine[] {
  const rawLines = input
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Pre-pass: join continuation lines that start with a number+unit
  // (e.g. "340 cal / 5g protein / ...") onto the previous food-name
  // line. Handles multi-line paste formats like
  //   "1 small Moose Trail cone
  //    340 cal / 5g protein / ..."
  // which would otherwise drop both lines (line 1 has no calories,
  // line 2 has no food name). Only merges when the previous line
  // doesn't already carry its own macros — otherwise two complete
  // food lines stay separate.
  const lines: string[] = [];
  for (const line of rawLines) {
    const macroMatch = MACRO_HINT_RE.exec(line);
    const startsWithMacro = macroMatch !== null && macroMatch.index <= 3;
    const prevLine = lines[lines.length - 1];
    const prevHasMacro = prevLine ? MACRO_HINT_RE.test(prevLine) : false;
    if (prevLine && startsWithMacro && !prevHasMacro) {
      lines[lines.length - 1] = `${prevLine} ${line}`;
    } else {
      lines.push(line);
    }
  }

  const results: ParsedFoodLine[] = [];

  for (const line of lines) {
    if (shouldSkipLine(line)) continue;

    const overrides = extractExplicitNutritionOverrides(line, {
      allowSingleField: true,
    });

    // Need at least calories — otherwise it's narrative, not a food line.
    if (overrides.calories === undefined || overrides.calories === null) {
      continue;
    }

    const mealName = extractMealName(line);
    if (!mealName) continue;

    results.push({
      mealName,
      category: inferCategory(mealName),
      calories: overrides.calories,
      proteinG: macroOrNull(overrides.proteinG),
      carbsG: macroOrNull(overrides.carbsG),
      fatG: macroOrNull(overrides.fatG),
      fiberG: macroOrNull(overrides.fiberG),
      sodiumMg: macroOrNull(overrides.sodiumMg),
      addedSugarG: macroOrNull(overrides.addedSugarG),
      saturatedFatG: macroOrNull(overrides.saturatedFatG),
    });
  }

  return results;
}

function shouldSkipLine(line: string): boolean {
  if (HEADER_HINTS.some((re) => re.test(line))) return true;
  if (TARGET_LINE_RE.test(line) && VERDICT_MARK_RE.test(line)) return true;
  // Lines that are just "Calories: ~X / 1650 ✅" totals
  if (/^\s*(calories|protein|carbs|fat|fiber|sodium|added sugar|saturated fat)\s*:/i.test(line)) {
    if (TARGET_LINE_RE.test(line) || VERDICT_MARK_RE.test(line)) return true;
  }
  return false;
}

function extractMealName(line: string): string {
  // Find where the first macro mention starts; the name is everything
  // before that, less leading bullets/counts and trailing separators.
  const macroMatch = MACRO_HINT_RE.exec(line);
  let head = macroMatch ? line.slice(0, macroMatch.index) : line;

  head = head.replace(LEADING_BULLET_RE, "");
  // Trim trailing separators like " — ", " - ", " : ", " · ", trailing comma
  head = head.replace(/[\s—–:·\-,]+$/u, "").trim();

  // If the head ends with a trailing parenthetical like "(2)" leave it,
  // but drop stray quote characters.
  head = head.replace(/^["'`]+|["'`]+$/g, "").trim();

  return head;
}

function inferCategory(name: string): FoodCategory {
  const lower = name.toLowerCase();
  if (/(shake|drink|coffee|latte|juice|soda|water|tea|smoothie|protein hit)/.test(lower)) {
    return "drink";
  }
  if (/(candy|chips|cookie|cookies|donut|ice cream|cake|chocolate|brownie|pastry|croissant)/.test(lower)) {
    return "unhealthy_snack";
  }
  if (/(yogurt|fruit|apple|banana|berries|nuts|almonds|veggies|veg|carrot|edamame|hummus)/.test(lower)) {
    return "healthy_snack";
  }
  if (/(bowl|plate|sandwich|burrito|wrap|salad|meal|breakfast|lunch|dinner|pizza|burger|steak|chicken|salmon|pasta|rice)/.test(lower)) {
    return "meal";
  }
  return "other";
}

function macroOrNull(
  value: ExplicitNutritionOverrides[keyof ExplicitNutritionOverrides],
): number | null {
  if (value === undefined || value === null) return null;
  return value;
}
