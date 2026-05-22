import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type CoachObservations,
  deriveStyleSeed,
  hashObservations,
} from "@/lib/cal/coachReview";
import { buildFallbackBody } from "@/lib/cal/coachReviewFallback";
import { stripQuantitativeClaims } from "@/lib/cal/verdictSanitize";

const COACH_MODEL = "claude-sonnet-4-5";
// 200 chars is the verdict_reason cap; the coach line is the same
// shape. Anthropic max_tokens is in TOKENS — 100 covers ~75 words
// which is plenty for a single line.
const MAX_TOKENS = 120;
const TEMPERATURE = 0.7;
const COACH_TIMEOUT_MS = 12_000;

const COACH_SYSTEM_PROMPT = `You write ONE terse coach line about a user's nutrition pattern. Personality: dry, observational — like a friend who actually looked at the user's plate. Not chatty, not motivational, not preachy.

## Input shape

You receive a JSON object:
{
  "scope": "day" | "week",
  "recentEntries": string[],     // verbatim food names — copy them
  "signals": string[],           // categorical flags only, e.g. "sodium_high_today"
  "suggestion": { "kind": string, "body": string }, // code already chose this — you weave it in
  "styleSeed": "dry" | "wry" | "flat-coach" | "observational" | "deadpan"
}

The styleSeed nudges tone but doesn't change content. "dry" = matter-of-fact. "wry" = lightly amused. "flat-coach" = neutral observation. "observational" = describe what's happening. "deadpan" = understated.

## ABSOLUTE RULES — violating these is a bug

1. NO NUMBERS. No percentages, no mg, no calories, no grams, no ratios. The day-totals UI shows real numbers; if you state one, you will lie. Use qualitative words only ("high sodium", "light on fiber", "protein-heavy").

2. NAME THE FOOD. Reference at least one item from recentEntries by its actual name. Don't paraphrase ("a fast food meal" is wrong; use "Chick-fil-A Meal Deal").

3. ONE LINE. Max ~180 chars. Single sentence or em-dash chain. No multi-paragraph output.

4. SUGGESTION WEAVE. If suggestion.kind is NOT "none", incorporate suggestion.body verbatim or with light wrapping. Examples:
   - body = "a banana or some leafy greens" → "Throw in a banana or some leafy greens."
   - body = "beans, berries, or oats" → "Beans, berries, or oats next round."
   If suggestion.kind IS "none", do not invent advice.

5. NO MORALIZING. Banned words: cheat, guilt, deserve, earn, junk, sinful, cleanse, detox, naughty, bad choice, ruined.

6. NO MEDICAL ADVICE. Coaching frame ("sodium's heavy"), never diagnosis ("you have hypertension").

## Signal vocabulary (interpret, don't quote)

sodium_high_today: today's sodium is over the daily ceiling
sodium_dash_streak: 3+ consecutive days over the ceiling
bp_alert: BP-flag user with sodium running heavy
fiber_low / fiber_week_short: fiber's light today / all week
protein_low / protein_short_streak: protein's thin today / multiple days
liquid_sugar_today: had a juice or sweetened drink
sugar_high_today / sat_fat_high_today: sugar / sat fat over target
calories_under / calories_over / calories_on_track: TDEE position today
water_short: water intake's low
week_indulgence_heavy / week_clean_streak: week verdict pattern
week_deficit / week_surplus / week_balanced: week calorie average

## Output

Return JSON ONLY:
{ "body": string }

No prose, no preamble, no markdown fence. The body is the single coach line.

## Examples (DO NOT quote, use as style reference)

Input: { scope:"day", recentEntries:["Chick-fil-A Meal Deal","Triple Protein Shake"], signals:["sodium_high_today","bp_alert","fiber_low"], suggestion:{kind:"electrolytes",body:"a banana or some leafy greens"}, styleSeed:"dry" }
Output: { "body": "Chick-fil-A Deal plus a protein shake — sodium's heavy and fiber's thin. Throw in a banana or some leafy greens." }

Input: { scope:"week", recentEntries:["Greek Yogurt","Apple","Grilled Chicken Bowl"], signals:["week_clean_streak","protein_on_track"], suggestion:{kind:"none",body:""}, styleSeed:"observational" }
Output: { "body": "Greek yogurt, apple, grilled chicken bowl — week's been clean, protein landing." }
`;

// ── Cache read / write ───────────────────────────────────────────────

export type CoachReviewRow = {
  id: string;
  body: string;
  suggestion_kind: string | null;
  suggestion_text: string | null;
  created_at: string;
};

export async function readCachedReview(
  supabase: SupabaseClient,
  userId: string,
  scope: "day" | "week",
  periodKey: string,
  observationsHash: string,
): Promise<CoachReviewRow | null> {
  const { data, error } = await supabase
    .from("cal_coach_reviews")
    .select("id,body,suggestion_kind,suggestion_text,created_at")
    .eq("user_id", userId)
    .eq("scope", scope)
    .eq("period_key", periodKey)
    .eq("observations_hash", observationsHash)
    .maybeSingle();
  if (error) {
    console.warn(`[coach/cache] read failed: ${error.message}`);
    return null;
  }
  return (data as CoachReviewRow | null) ?? null;
}

export async function writeCachedReview(
  supabase: SupabaseClient,
  userId: string,
  obs: CoachObservations,
  observationsHash: string,
  styleSeed: string,
  body: string,
): Promise<void> {
  const { error } = await supabase.from("cal_coach_reviews").insert({
    user_id: userId,
    scope: obs.scope,
    period_key: obs.periodKey,
    observations_hash: observationsHash,
    style_seed: styleSeed,
    body,
    suggestion_kind:
      obs.suggestion.kind === "none" ? null : obs.suggestion.kind,
    suggestion_text:
      obs.suggestion.kind === "none" ? null : obs.suggestion.body,
  });
  if (error && error.code !== "23505") {
    // 23505 = concurrent firing already wrote this hash. Safe to ignore.
    console.warn(`[coach/cache] write failed: ${error.message}`);
  }
}

// ── Anthropic call ───────────────────────────────────────────────────

export async function callAnthropicCoach(
  obs: CoachObservations,
  styleSeed: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const client = new Anthropic({ apiKey });
  const promptPayload = JSON.stringify({
    scope: obs.scope,
    recentEntries: obs.recentEntries,
    signals: obs.signals,
    suggestion: obs.suggestion,
    styleSeed,
  });

  const response = await client.messages.create(
    {
      model: COACH_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: COACH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: promptPayload }],
    },
    { timeout: COACH_TIMEOUT_MS },
  );

  const text = extractText(response.content).trim();
  return parseCoachBody(text);
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  for (const block of content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

function parseCoachBody(raw: string): string {
  // Strip markdown fences and any leading prose before the JSON.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  // Find the first balanced JSON object.
  const start = cleaned.indexOf("{");
  if (start < 0) {
    throw new Error("Coach generator returned no JSON object");
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("Coach generator JSON not balanced");

  const parsed = JSON.parse(cleaned.slice(start, end)) as { body?: unknown };
  if (typeof parsed.body !== "string" || !parsed.body.trim()) {
    throw new Error("Coach generator missing body");
  }
  return parsed.body.trim();
}

// ── Orchestration ────────────────────────────────────────────────────

export type GenerateCoachReviewResult = {
  body: string;
  suggestionKind: string | null;
  suggestionText: string | null;
  cached: boolean;
  source: "ai" | "fallback";
};

export async function generateCoachReviewForObservations(
  supabase: SupabaseClient,
  userId: string,
  obs: CoachObservations,
): Promise<GenerateCoachReviewResult> {
  const observationsHash = hashObservations(obs);
  const styleSeed = deriveStyleSeed(observationsHash, obs.periodKey);

  // Cache hit — fast path.
  const cached = await readCachedReview(
    supabase,
    userId,
    obs.scope,
    obs.periodKey,
    observationsHash,
  );
  if (cached) {
    return {
      body: cached.body,
      suggestionKind: cached.suggestion_kind,
      suggestionText: cached.suggestion_text,
      cached: true,
      source: "ai",
    };
  }

  // Cache miss — try Anthropic, fall back to deterministic template.
  let body: string;
  let source: "ai" | "fallback" = "ai";
  try {
    const raw = await callAnthropicCoach(obs, styleSeed);
    body = stripQuantitativeClaims(raw).slice(0, 240);
    if (!body.trim()) throw new Error("Empty body after sanitize");
  } catch (err) {
    console.warn(
      `[coach/generate] AI failed (falling back): ${err instanceof Error ? err.message : err}`,
    );
    body = buildFallbackBody(obs);
    source = "fallback";
  }

  await writeCachedReview(supabase, userId, obs, observationsHash, styleSeed, body);

  return {
    body,
    suggestionKind: obs.suggestion.kind === "none" ? null : obs.suggestion.kind,
    suggestionText: obs.suggestion.kind === "none" ? null : obs.suggestion.body,
    cached: false,
    source,
  };
}
