import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";

import type {
  CandidatePool,
  MealPlanAxioms,
  MealPlanCandidate,
  MealPlanMacroRange,
  MealPlanMacros,
  ProvenanceTier,
  ResearcherInput,
} from "./types";

const RESEARCHER_MODEL = "claude-sonnet-4-5";

const SYSTEM_PROMPT = `You are the candidate researcher for ShiftlyCal's meal-plan generator. Jon will eat a meal now. Your job is to return a STRUCTURED CANDIDATE POOL — never a finished plan, never an arithmetic claim of closure. A separate program assembles the final plan and certifies macro closure.

## Hard rules

1. Output JSON only. No markdown fences. No preamble. No commentary outside the JSON.
2. The model NEVER does arithmetic to "close" the targets. You propose candidates; downstream code optimizes.
3. Provenance tiers are not interchangeable:
   - "database" — items from input.savedFoods only. Use them verbatim. Do not invent database-tier items.
   - "published" — chain restaurants with FDA-required calorie labeling, or packaged grocery items with Nutrition Facts panels. Must include sourceUrl pointing to the brand/chain's own page or a verifiable nutrition source.
   - "inferred" — local restaurants without published nutrition, or restaurant items where macros are estimated from comparable recipes. Must include macroRange with realistic low/high bands (typically ±20% on calories, ±25% on macros). Single-point macros field is your best estimate.
4. macroRange is REQUIRED for tier="inferred" and FORBIDDEN for tier="published" or "database". If you cannot establish a defensible range for an inferred item, omit the item.
5. sourceUrl is REQUIRED for tier="published" and tier="inferred". null is permitted only for tier="database".
6. doordashUrl is required when axioms.eatOut and axioms.requireDoorDash. Allowed null for the main course IF axioms.allowNonDoorDashMain is true. Always null for fillers. The URL must point to a specific item, not the restaurant homepage. If you cannot find a live DoorDash item link, set the candidate's doordashUrl to null AND the candidate is ineligible when DoorDash is required.
7. If you cannot fulfill the request (no DoorDash mains in the area, location too vague, axioms over-constrained), return mains:[] fillers:[] and a one-sentence unfetchedReason explaining why.

## Carb mode bias (soft, not a filter)

- "high" — bias mains toward 60g+ carbs and include carb-dense fillers (rice, potatoes, fruit). Downstream code enforces the actual target.
- "low" — bias mains toward under 30g carbs and include low-carb fillers (veg, nuts, eggs, cheese). Downstream code enforces the cap.
- "indifferent" — no preference.

## Eat-out vs eat-in

- axioms.eatOut === true: mains should be restaurant items near axioms.locationHint. Use web search to find live menu items in the area.
- axioms.eatOut === false: mains should be home-prepared recipes or easy grocery assembly (e.g., "rotisserie chicken + baked sweet potato + steamed broccoli"). sourceUrl can be a recipe page.

## Counts

- mains: return 4 to 6 candidates, ordered by your best ranking against the user's remaining targets.
- fillers: return 8 to 12 candidates spanning protein, fiber, and carb-balancing options. Always include at least 3 fillers from input.savedFoods if any exist that could plausibly help close the day's macros.

## Banned vocabulary in notes

Do NOT use: cheat, guilt, deserve, earn, junk, sinful, cleanse, detox, naughty, ruined, splurge. Use observational frames. Example good note: "Grilled, salt-forward; close watch on sodium." Example bad note: "Splurge-worthy treat."

## Health flag mapping

If input.healthFlags includes "high_blood_pressure", down-rank items with sodium >1000mg per serving. If "pre_diabetic", down-rank items with added sugar >25g. If "fatty_liver", down-rank alcohol candidates. Do not invent flags not present in the input.

## Exact output shape (a single JSON object)

{
  "fetchedAt": "<ignored; downstream code stamps this>",
  "axioms": <echo input.axioms verbatim>,
  "unfetchedReason": null | "one-sentence reason",
  "mains": [
    {
      "id": "<any string; downstream code will overwrite>",
      "kind": "main",
      "name": "string, max 60 chars",
      "tier": "database" | "published" | "inferred",
      "sourceUrl": "https://..." | null,
      "doordashUrl": "https://www.doordash.com/store/..." | null,
      "macros": {
        "calories": int,
        "proteinG": int,
        "carbsG": int,
        "fiberG": int,
        "fatG": int,
        "sodiumMg": int | null,
        "addedSugarG": int | null,
        "saturatedFatG": int | null
      },
      "macroRange": null | {
        "calories": {"low": int, "high": int},
        "proteinG": {"low": int, "high": int},
        "carbsG": {"low": int, "high": int},
        "fiberG": {"low": int, "high": int},
        "fatG": {"low": int, "high": int},
        "sodiumMg": {"low": int|null, "high": int|null},
        "addedSugarG": {"low": int|null, "high": int|null},
        "saturatedFatG": {"low": int|null, "high": int|null}
      },
      "confidence": "high" | "medium" | "low",
      "notes": "string, max 140 chars, observational"
    }
  ],
  "fillers": [ ...same candidate shape, kind="filler" ]
}

Do not include any fields beyond those listed. Do not nest the response under a wrapper key. Do not return an array — return a single object.`;

const AXIOM_KEYS = [
  "eatOut",
  "requireDoorDash",
  "allowNonDoorDashMain",
  "carbMode",
  "locationHint",
] as const;

const CANDIDATE_KEYS = [
  "id",
  "kind",
  "name",
  "sourceUrl",
  "doordashUrl",
  "tier",
  "macros",
  "macroRange",
  "confidence",
  "notes",
] as const;

const MACRO_KEYS = [
  "calories",
  "proteinG",
  "carbsG",
  "fiberG",
  "fatG",
  "sodiumMg",
  "addedSugarG",
  "saturatedFatG",
] as const;

const RANGE_VALUE_KEYS = ["low", "high"] as const;

export class MealPlanResearcherError extends Error {
  constructor(
    message: string,
    public readonly code: "missing_api_key" | "empty_response" | "invalid_json" | "malformed_response",
  ) {
    super(message);
    this.name = "MealPlanResearcherError";
  }
}

export async function fetchCandidatePool(
  input: ResearcherInput,
): Promise<CandidatePool> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new MealPlanResearcherError(
      "Meal plan researcher unavailable: ANTHROPIC_API_KEY not set.",
      "missing_api_key",
    );
  }

  const client = new Anthropic({ apiKey });
  const tools = input.axioms.eatOut
    ? [
        {
          type: "web_search_20250305" as const,
          name: "web_search" as const,
          max_uses: 2,
        },
      ]
    : [];
  const response = await client.messages.create({
    model: RESEARCHER_MODEL,
    max_tokens: 8000,
    temperature: 0.1,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools,
    messages: [{ role: "user", content: JSON.stringify(input) }],
  });

  const parsed = parseCandidatePoolResponse(extractFinalText(response.content));
  const mains = postProcessCandidates(parsed.mains, "main", input).slice(0, 6);
  const fillers = postProcessCandidates(parsed.fillers, "filler", input).slice(
    0,
    12,
  );

  return {
    fetchedAt: new Date().toISOString(),
    axioms: input.axioms,
    unfetchedReason: parsed.unfetchedReason,
    mains,
    fillers,
  };
}

function extractFinalText(content: Anthropic.Messages.ContentBlock[]): string {
  let lastText = "";
  for (const block of content) {
    if (block.type === "text") lastText = block.text;
  }
  if (!lastText) {
    throw new MealPlanResearcherError(
      "Meal plan researcher returned no text.",
      "empty_response",
    );
  }
  return lastText;
}

function parseCandidatePoolResponse(raw: string): CandidatePool {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    throw new MealPlanResearcherError(
      "Meal plan researcher returned invalid JSON.",
      "invalid_json",
    );
  }

  if (!isPlainObject(json)) fail("$");
  // fetchedAt and axioms are overwritten downstream from the request input,
  // so we accept any shape (or omission) the model returns for them. Only
  // unfetchedReason, mains, and fillers must be well-formed here.

  return {
    fetchedAt: typeof json.fetchedAt === "string" ? json.fetchedAt : "",
    axioms:
      isPlainObject(json.axioms) && allAxiomKeysPresent(json.axioms)
        ? parseAxioms(json.axioms, "$.axioms")
        : EMPTY_AXIOMS,
    unfetchedReason: assertNullableString(
      json.unfetchedReason,
      "$.unfetchedReason",
    ),
    mains: parseCandidateArray(json.mains, "$.mains", "main"),
    fillers: parseCandidateArray(json.fillers, "$.fillers", "filler"),
  };
}

const EMPTY_AXIOMS: MealPlanAxioms = {
  eatOut: false,
  requireDoorDash: false,
  allowNonDoorDashMain: false,
  carbMode: "indifferent",
  locationHint: null,
};

function allAxiomKeysPresent(obj: Record<string, unknown>): boolean {
  return AXIOM_KEYS.every((key) => key in obj);
}

function parseAxioms(value: unknown, path: string): MealPlanAxioms {
  if (!isPlainObject(value)) fail(path);
  requireExactKeys(value, AXIOM_KEYS, path);

  const carbMode = value.carbMode;
  if (
    carbMode !== "high" &&
    carbMode !== "low" &&
    carbMode !== "indifferent"
  ) {
    fail(`${path}.carbMode`);
  }

  return {
    eatOut: assertBoolean(value.eatOut, `${path}.eatOut`),
    requireDoorDash: assertBoolean(
      value.requireDoorDash,
      `${path}.requireDoorDash`,
    ),
    allowNonDoorDashMain: assertBoolean(
      value.allowNonDoorDashMain,
      `${path}.allowNonDoorDashMain`,
    ),
    carbMode,
    locationHint: assertNullableString(value.locationHint, `${path}.locationHint`),
  };
}

function parseCandidateArray(
  value: unknown,
  path: string,
  kind: MealPlanCandidate["kind"],
): MealPlanCandidate[] {
  if (!Array.isArray(value)) fail(path);
  return value.map((item, index) =>
    parseCandidate(item, `${path}[${index}]`, kind),
  );
}

function parseCandidate(
  value: unknown,
  path: string,
  kind: MealPlanCandidate["kind"],
): MealPlanCandidate {
  if (!isPlainObject(value)) fail(path);
  requireExactKeys(value, CANDIDATE_KEYS, path);

  const parsedKind = value.kind;
  if (parsedKind !== kind) fail(`${path}.kind`);

  return {
    id: assertString(value.id, `${path}.id`),
    kind,
    name: assertString(value.name, `${path}.name`),
    sourceUrl: assertNullableString(value.sourceUrl, `${path}.sourceUrl`),
    doordashUrl: assertNullableString(value.doordashUrl, `${path}.doordashUrl`),
    tier: parseTier(value.tier, `${path}.tier`),
    macros: parseMacros(value.macros, `${path}.macros`),
    macroRange: parseMacroRange(value.macroRange, `${path}.macroRange`),
    confidence: parseConfidence(value.confidence, `${path}.confidence`),
    notes: assertNullableString(value.notes, `${path}.notes`),
  };
}

function parseTier(value: unknown, path: string): ProvenanceTier {
  if (value === "database" || value === "published" || value === "inferred") {
    return value;
  }
  fail(path);
}

function parseConfidence(
  value: unknown,
  path: string,
): MealPlanCandidate["confidence"] {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  fail(path);
}

function parseMacros(value: unknown, path: string): MealPlanMacros {
  if (!isPlainObject(value)) fail(path);
  requireExactKeys(value, MACRO_KEYS, path);

  return {
    calories: assertNumber(value.calories, `${path}.calories`),
    proteinG: assertNumber(value.proteinG, `${path}.proteinG`),
    carbsG: assertNumber(value.carbsG, `${path}.carbsG`),
    fiberG: assertNumber(value.fiberG, `${path}.fiberG`),
    fatG: assertNumber(value.fatG, `${path}.fatG`),
    sodiumMg: assertNullableNumber(value.sodiumMg, `${path}.sodiumMg`),
    addedSugarG: assertNullableNumber(
      value.addedSugarG,
      `${path}.addedSugarG`,
    ),
    saturatedFatG: assertNullableNumber(
      value.saturatedFatG,
      `${path}.saturatedFatG`,
    ),
  };
}

function parseMacroRange(
  value: unknown,
  path: string,
): MealPlanMacroRange | null {
  if (value === null) return null;
  if (!isPlainObject(value)) fail(path);
  requireExactKeys(value, MACRO_KEYS, path);

  return {
    calories: parseNumberRange(value.calories, `${path}.calories`),
    proteinG: parseNumberRange(value.proteinG, `${path}.proteinG`),
    carbsG: parseNumberRange(value.carbsG, `${path}.carbsG`),
    fiberG: parseNumberRange(value.fiberG, `${path}.fiberG`),
    fatG: parseNumberRange(value.fatG, `${path}.fatG`),
    sodiumMg: parseNullableNumberRange(value.sodiumMg, `${path}.sodiumMg`),
    addedSugarG: parseNullableNumberRange(
      value.addedSugarG,
      `${path}.addedSugarG`,
    ),
    saturatedFatG: parseNullableNumberRange(
      value.saturatedFatG,
      `${path}.saturatedFatG`,
    ),
  };
}

function parseNumberRange(value: unknown, path: string) {
  if (!isPlainObject(value)) fail(path);
  requireExactKeys(value, RANGE_VALUE_KEYS, path);
  return {
    low: assertNumber(value.low, `${path}.low`),
    high: assertNumber(value.high, `${path}.high`),
  };
}

function parseNullableNumberRange(value: unknown, path: string) {
  if (!isPlainObject(value)) fail(path);
  requireExactKeys(value, RANGE_VALUE_KEYS, path);
  return {
    low: assertNullableNumber(value.low, `${path}.low`),
    high: assertNullableNumber(value.high, `${path}.high`),
  };
}

function postProcessCandidates(
  candidates: MealPlanCandidate[],
  kind: MealPlanCandidate["kind"],
  input: ResearcherInput,
): MealPlanCandidate[] {
  return candidates.map((candidate) => {
    let next = normalizeDatabaseClaim(candidate, input);

    if (next.tier === "inferred" && next.macroRange === null) {
      throw new Error(
        `Meal plan researcher returned inferred candidate without macroRange: ${next.name}.`,
      );
    }

    if (next.tier === "published" || next.tier === "database") {
      next = { ...next, macroRange: null };
    }

    return {
      ...next,
      id: stableCandidateId({
        kind,
        name: next.name,
        tier: next.tier,
        sourceUrl: next.sourceUrl,
      }),
    };
  });
}

function normalizeDatabaseClaim(
  candidate: MealPlanCandidate,
  input: ResearcherInput,
): MealPlanCandidate {
  if (candidate.tier !== "database") return candidate;

  const savedMatch = input.savedFoods.find(
    (savedFood) =>
      savedFood.name.trim().toLowerCase() ===
        candidate.name.trim().toLowerCase() &&
      macrosEqual(savedFood.macros, candidate.macros),
  );

  if (savedMatch) return candidate;

  return {
    ...candidate,
    tier: "published",
    notes: appendNote(candidate.notes, "Promoted from claimed database tier"),
  };
}

function stableCandidateId(input: {
  kind: MealPlanCandidate["kind"];
  name: string;
  tier: ProvenanceTier;
  sourceUrl: string | null;
}) {
  return createHash("sha1")
    .update(`${input.kind}|${input.name}|${input.tier}|${input.sourceUrl ?? ""}`)
    .digest("hex")
    .slice(0, 12);
}

function macrosEqual(left: MealPlanMacros, right: MealPlanMacros) {
  return MACRO_KEYS.every((key) => left[key] === right[key]);
}

function appendNote(notes: string | null, addition: string) {
  const trimmed = notes?.trim();
  return trimmed ? `${trimmed} ${addition}` : addition;
}

function requireExactKeys<T extends readonly string[]>(
  obj: Record<string, unknown>,
  keys: T,
  path: string,
) {
  const allowed = new Set<string>(keys);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) fail(`${path}.${key}`);
  }
  for (const key of keys) {
    if (!(key in obj)) fail(`${path}.${key}`);
  }
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path);
  return value;
}

function assertNullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") fail(path);
  return value;
}

function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path);
  return value;
}

function assertNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path);
  return value;
}

function assertNullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path);
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string): never {
  throw new MealPlanResearcherError(
    `Meal plan researcher returned malformed response at ${path}.`,
    "malformed_response",
  );
}
