import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { FoodCategory, FoodVerdict } from "@/lib/cal/types";

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
- "good" — aligns with phase goals AND clean week pattern OR a course-correction after a bad streak
- "fine" — neutral, expected, or an in-budget indulgence on a clean-week 80/20 window
- "bad" — hurting the week. Either the food itself crosses a hard cap, OR cumulative pattern is harmful

## Week-pattern weighting rules (apply in order)

1. EXTREME BINGE CAP: if this single entry exceeds 40% of TDEE in calories, verdict is at most "fine" (never "good"), regardless of how clean the week was. Reason cites the binge cap. This prevents "I was clean all week, so a 3000-cal binge is fine" rationalization.

2. PHASE TARGET: targets.tdee_cal is the user's literal daily phase target. If phase is cut, calories above the daily cut target push toward "bad"; calories within ±15% of target are "fine"; well below target with low protein could be "bad" because under-eating undermines the cut. If bulk, below the daily bulk target pushes toward "bad". Maintain has ±100 tolerance.

3. 80/20 WINDOW: if 80%+ of the week's logged days were clean (calories within or below TDEE), and this entry is a moderate indulgence (<40% TDEE), verdict can be "fine" with reason citing the week pattern.

4. RECOVERY: if the past 2 days had indulgent overshoots and this entry is genuinely healthy (high protein, high fiber, in-budget), verdict is "good" with reason "recovery / course correction."

5. COMPOUNDING: if multiple indulgent items already logged this week AND this entry adds to that pattern (high sugar, low protein, low fiber, calorie-dense), verdict is "bad" with reason "compounding pattern this week."

6. PROTEIN FLOOR: if today's protein is well below daily floor (less than 60% of target) and this entry is low-protein (under 10g), the verdict softens to "fine" only if the food otherwise serves a need (fiber, micronutrients). Otherwise "bad."

## Health flag mappings (apply only if flag is present in profile.health_flags)

- "high_blood_pressure": estimate sodium for this entry. If estimated single-entry sodium >600mg, flag in rules_triggered. If estimated weekly sodium would exceed 10500mg (DASH 1500/day × 7), reason notes "DASH ceiling reached." Append "tracking cue, not medical advice" to reason.
- "pre_diabetic": estimate added sugar for this entry. If >25g flag rules_triggered. Track glycemic-impact pattern across the week. Append "tracking cue, not medical advice" to reason.
- "fatty_liver": estimate added sugar AND alcohol servings. Append "tracking cue, not medical advice" to reason.
- "high_cholesterol": estimate saturated fat. Flag if single entry exceeds 7g sat fat. Append "tracking cue, not medical advice" to reason.

Apply ONLY mappings whose flag is in profile.health_flags. Do not invent health concerns.

## Banned vocabulary in verdict_reason

You MUST NOT use these words: "cheat", "guilt", "deserve", "earn", "earned", "junk", "sinful", "cleanse", "detox", "bad choice", "naughty", "wasted", "ruined".

The verdict enum CAN be "bad" — that is a structured label. But the reason text uses observational frames only:
- "4th high-sugar item this week"
- "calories already over Wednesday target"
- "fits weekly pattern, in line with 80/20 window"
- "high sodium estimate — heads up for BP flag"

## Output JSON shape (strict, no markdown)

{
  "verdict": "good" | "fine" | "bad",
  "verdict_reason": string (max 200 chars, observational frames only),
  "verdict_context": {
    "estimated_facets": {
      "sodium_mg": integer | null,
      "added_sugar_g": integer | null,
      "alcohol_servings": number | null,
      "saturated_fat_g": integer | null,
      "high_sodium": boolean,
      "high_added_sugar": boolean,
      "source": "official" | "ai_estimate" | "unknown"
    },
    "rules_triggered": string[] (rule names from above sections, e.g. ["binge_cap", "phase_cut_over_target"]),
    "week_pattern_summary": string (one short sentence describing this week's pattern)
  }
}

Source tag rules: use "official" if the entry came from a known restaurant/brand with published nutrition values; "ai_estimate" if you computed values from food description; "unknown" if there's no reliable basis.`;

const BANNED_REASON_WORDS = [
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
  if (value === "good" || value === "fine" || value === "bad") return value;
  throw new Error("Verdict scorer returned invalid verdict.");
}

function sanitizeReason(value: string): string {
  let sanitized = value.slice(0, 200).trim();
  for (const banned of BANNED_REASON_WORDS) {
    sanitized = sanitized.replace(new RegExp(escapeRegExp(banned), "gi"), "pattern");
  }
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
