import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { CalTargets, FoodCategory, FoodEntry, FoodVerdict } from "@/lib/cal/types";
import { BANNED_REASON_WORDS } from "@/lib/cal/verdict";
import type { createAdminClient } from "@/lib/supabase/admin";

const DAY_VERDICT_MODEL = "claude-haiku-4-5";
const DAY_REASON_MAX_CHARS = 90;

const DAY_VERDICT_SYSTEM_PROMPT = `You write one short nutrition note for a finished logged day.

Rules:
- Return JSON only: {"reason":"..."}.
- The reason is one natural sentence or two short sentence fragments.
- Format: "<what they ate today overall>. <one-clause why>."
- Max 90 characters.
- Do not include calorie math or exact macro numbers.
- Do not sound like analytics, a dashboard, or a lecture.
- Do not change the rule verdict.
- Banned words: cheat, guilt, deserve, earn, earned, junk, sinful, cleanse, detox, bad choice, naughty, wasted, ruined.`;

type DayVerdictFoodEntryRow = {
  id: string;
  date: string;
  logged_time: string | null;
  meal_name: string;
  category: string | null;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sodium_mg: number | null;
  added_sugar_g: number | null;
  saturated_fat_g: number | null;
  saved_food_id: string | null;
  verdict: string | null;
  verdict_reason: string | null;
  verdict_source: string | null;
  verdict_error: string | null;
  verdict_context: FoodEntry["verdictContext"];
  is_projected_plan: boolean | null;
  created_at: string;
  updated_at: string;
};

type DayVerdictSettingsRow = {
  tdee_calories: number | null;
  protein_target_g: number | null;
  carbs_target_g: number | null;
  fat_target_g: number | null;
  fiber_target_g: number | null;
  sodium_target_mg: number | null;
  added_sugar_target_g: number | null;
  saturated_fat_target_g: number | null;
  water_target_oz: number | null;
  age: number | null;
  sex: string | null;
  height_cm: number | string | null;
  activity_level: string | null;
  current_phase: string | null;
  goals_text: string | null;
  health_flags: string[] | null;
};

export type DayFoodVerdictResult = {
  verdict: FoodVerdict;
  reason: string;
  calorieTotal: number;
  proteinTotal: number;
  withinCalorieTolerance: boolean;
  withinProteinTarget: boolean;
};

export async function upsertDayFoodVerdict(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  date: string,
): Promise<void> {
  const [settingsRes, entriesRes] = await Promise.all([
    supabase
      .from("settings")
      .select(
        "tdee_calories,protein_target_g,carbs_target_g,fat_target_g,fiber_target_g,sodium_target_mg,added_sugar_target_g,saturated_fat_target_g,water_target_oz,age,sex,height_cm,activity_level,current_phase,goals_text,health_flags",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("food_entries")
      .select(
        "id,date,logged_time,meal_name,category,calories,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,added_sugar_g,saturated_fat_g,saved_food_id,verdict,verdict_reason,verdict_source,verdict_error,verdict_context,is_projected_plan,created_at,updated_at",
      )
      .eq("user_id", userId)
      .eq("date", date)
      .eq("is_projected_plan", false)
      .order("logged_time", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (settingsRes.error) throw new Error(settingsRes.error.message);
  if (entriesRes.error) throw new Error(entriesRes.error.message);

  const entries = ((entriesRes.data ?? []) as DayVerdictFoodEntryRow[]).map(
    mapFoodEntry,
  );

  if (entries.length === 0) {
    const { error } = await supabase
      .from("day_food_verdicts")
      .delete()
      .eq("user_id", userId)
      .eq("date", date);

    if (error) throw new Error(error.message);
    return;
  }

  const result = await computeDayFoodVerdict({
    userId,
    date,
    entries,
    targets: mapTargets((settingsRes.data ?? null) as DayVerdictSettingsRow | null),
  });

  const { error } = await supabase.from("day_food_verdicts").upsert(
    {
      user_id: userId,
      date,
      verdict: result.verdict,
      reason: result.reason,
      calorie_total: result.calorieTotal,
      protein_total: result.proteinTotal,
      within_calorie_tolerance: result.withinCalorieTolerance,
      within_protein_target: result.withinProteinTarget,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,date" },
  );

  if (error) throw new Error(error.message);
}

export async function computeDayFoodVerdict(input: {
  userId: string;
  date: string;
  entries: FoodEntry[];
  targets: CalTargets;
}): Promise<DayFoodVerdictResult> {
  const calorieTotal = input.entries.reduce(
    (sum, entry) => sum + entry.calories,
    0,
  );
  const proteinTotal = input.entries.reduce(
    (sum, entry) => sum + (entry.proteinG ?? 0),
    0,
  );
  const tdee = input.targets.tdeeCalories;
  const proteinTarget = input.targets.proteinTargetG;
  const withinCalorieTolerance =
    tdee !== null &&
    tdee > 0 &&
    calorieTotal >= tdee * 0.9 &&
    calorieTotal <= tdee * 1.1;
  const withinProteinTarget =
    proteinTarget !== null &&
    proteinTarget > 0 &&
    proteinTotal >= proteinTarget * 0.9;
  const verdict: FoodVerdict =
    withinCalorieTolerance && withinProteinTarget ? "good" : "bad";

  const reason = await buildDayReason(input, {
    verdict,
    calorieTotal,
    proteinTotal,
    withinCalorieTolerance,
    withinProteinTarget,
  });

  return {
    verdict,
    reason,
    calorieTotal: Math.round(calorieTotal),
    proteinTotal: Math.round(proteinTotal),
    withinCalorieTolerance,
    withinProteinTarget,
  };
}

async function buildDayReason(
  input: {
    userId: string;
    date: string;
    entries: FoodEntry[];
    targets: CalTargets;
  },
  result: Omit<DayFoodVerdictResult, "reason">,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackReason(input.entries, result);

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: DAY_VERDICT_MODEL,
      max_tokens: 120,
      temperature: 0.2,
      system: DAY_VERDICT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            date: input.date,
            rule_verdict: result.verdict,
            targets: {
              tdee_cal: input.targets.tdeeCalories,
              protein_g: input.targets.proteinTargetG,
            },
            rule_checks: {
              within_calorie_tolerance: result.withinCalorieTolerance,
              within_protein_target: result.withinProteinTarget,
            },
            entries: input.entries.map((entry) => ({
              name: entry.mealName || categoryLabel(entry.category),
              category: entry.category,
              calories: entry.calories,
              protein_g: entry.proteinG,
              fiber_g: entry.fiberG,
              sodium_mg: entry.sodiumMg,
              added_sugar_g: entry.addedSugarG,
              saturated_fat_g: entry.saturatedFatG,
            })),
          }),
        },
      ],
    });

    return parseReason(extractFinalText(response.content)) || fallbackReason(input.entries, result);
  } catch {
    return fallbackReason(input.entries, result);
  }
}

function parseReason(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as { reason?: unknown };
    return sanitizeDayReason(String(parsed.reason ?? ""));
  } catch {
    return sanitizeDayReason(cleaned);
  }
}

function fallbackReason(
  entries: FoodEntry[],
  result: Omit<DayFoodVerdictResult, "reason">,
): string {
  const names = entries
    .slice(0, 2)
    .map((entry) => entry.mealName.trim() || categoryLabel(entry.category))
    .filter(Boolean)
    .join(" and ");
  const plate = names || "Food logged";
  const why =
    result.verdict === "good"
      ? "day landed in range"
      : result.withinCalorieTolerance
        ? "protein missed the mark"
        : "day landed outside range";

  return sanitizeDayReason(`${plate}. ${why}.`);
}

function sanitizeDayReason(value: string): string {
  let sanitized = value.replace(/\s+/g, " ").trim();
  for (const banned of BANNED_REASON_WORDS) {
    sanitized = sanitized.replace(new RegExp(escapeRegExp(banned), "gi"), "pattern");
  }
  sanitized = sanitized.replace(/[*_`#[\]{}]/g, "").trim();
  if (sanitized.length > DAY_REASON_MAX_CHARS) {
    sanitized = `${sanitized.slice(0, DAY_REASON_MAX_CHARS - 1).trimEnd()}.`;
  }
  return sanitized || "Food logged. Day verdict generated.";
}

function extractFinalText(content: Anthropic.Messages.ContentBlock[]): string {
  let lastText = "";
  for (const block of content) {
    if (block.type === "text") lastText = block.text;
  }
  return lastText;
}

function mapFoodEntry(row: DayVerdictFoodEntryRow): FoodEntry {
  return {
    id: row.id,
    date: row.date,
    loggedTime: row.logged_time,
    mealName: row.meal_name,
    category: mapCategory(row.category),
    calories: Number(row.calories),
    proteinG: nullableNumber(row.protein_g),
    carbsG: nullableNumber(row.carbs_g),
    fatG: nullableNumber(row.fat_g),
    fiberG: nullableNumber(row.fiber_g),
    sodiumMg: nullableNumber(row.sodium_mg),
    addedSugarG: nullableNumber(row.added_sugar_g),
    saturatedFatG: nullableNumber(row.saturated_fat_g),
    savedFoodId: row.saved_food_id,
    verdict: row.verdict === "good" ? "good" : row.verdict === "bad" ? "bad" : null,
    verdictReason: row.verdict_reason,
    verdictSource:
      row.verdict_source === "ai" ||
      row.verdict_source === "manual_override" ||
      row.verdict_source === "unscored"
        ? row.verdict_source
        : "pending",
    verdictError: row.verdict_error,
    verdictContext: row.verdict_context ?? null,
    isProjectedPlan: row.is_projected_plan === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTargets(row: DayVerdictSettingsRow | null): CalTargets {
  return {
    tdeeCalories: row?.tdee_calories ?? null,
    proteinTargetG: row?.protein_target_g ?? null,
    carbsTargetG: row?.carbs_target_g ?? 120,
    fatTargetG: row?.fat_target_g ?? null,
    fiberTargetG: row?.fiber_target_g ?? null,
    sodiumTargetMg: row?.sodium_target_mg ?? 2300,
    addedSugarTargetG: row?.added_sugar_target_g ?? 36,
    saturatedFatTargetG: row?.saturated_fat_target_g ?? 20,
    waterTargetOz: row?.water_target_oz ?? 100,
    age: row?.age ?? null,
    sex: row?.sex === "female" ? "female" : row?.sex === "male" ? "male" : null,
    heightCm:
      row?.height_cm === null || row?.height_cm === undefined
        ? null
        : Number(row.height_cm),
    activityLevel: row?.activity_level ?? null,
    currentPhase:
      row?.current_phase === "maintain" ||
      row?.current_phase === "bulk" ||
      row?.current_phase === "recomp"
        ? row.current_phase
        : row?.current_phase === "cut"
          ? "cut"
          : null,
    goalsText: row?.goals_text ?? null,
    healthFlags: Array.isArray(row?.health_flags) ? row.health_flags : [],
  };
}

function mapCategory(value: string | null): FoodCategory {
  switch (value) {
    case "healthy_snack":
    case "unhealthy_snack":
    case "drink":
    case "other":
      return value;
    case "meal":
    default:
      return "meal";
  }
}

function categoryLabel(category: FoodCategory): string {
  switch (category) {
    case "meal":
      return "meal";
    case "healthy_snack":
      return "healthy snack";
    case "unhealthy_snack":
      return "snack";
    case "drink":
      return "drink";
    case "other":
      return "food";
  }
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
