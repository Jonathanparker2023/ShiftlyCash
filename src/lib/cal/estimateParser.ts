import type { FoodCategory } from "@/lib/cal/types";

export type EstimateComponent = {
  name: string;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  addedSugarG: number | null;
  saturatedFatG: number | null;
};

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
  components: EstimateComponent[];
};

type NullableMacroField =
  | "proteinG"
  | "carbsG"
  | "fatG"
  | "fiberG"
  | "sodiumMg"
  | "addedSugarG"
  | "saturatedFatG";

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
    // Sonnet occasionally prefixes JSON with prose ("Here's the
    // estimate:") despite the JSON-only instruction. Try extracting
    // the first balanced JSON value (array or object) and parsing
    // that before giving up.
    const extracted = extractFirstJsonValue(cleaned);
    if (extracted) {
      try {
        json = JSON.parse(extracted);
      } catch {
        console.warn(
          `[estimateParser] invalid JSON after extraction. Raw (first 500): ${raw.slice(0, 500)}`,
        );
        throw new Error("Estimator returned invalid JSON.");
      }
    } else {
      // Last-ditch recovery: response was probably truncated by
      // max_tokens mid-object. Close the array at the last complete
      // top-level item and parse just that. Loses the final
      // partially-emitted item but rescues every fully-emitted one.
      const repaired = repairTruncatedArray(cleaned);
      if (repaired) {
        try {
          json = JSON.parse(repaired);
          console.warn(
            `[estimateParser] recovered from truncated response. Raw (first 500): ${raw.slice(0, 500)}`,
          );
        } catch {
          console.warn(
            `[estimateParser] invalid JSON, no value found. Raw (first 500): ${raw.slice(0, 500)}`,
          );
          throw new Error("Estimator returned invalid JSON.");
        }
      } else {
        console.warn(
          `[estimateParser] invalid JSON, no value found. Raw (first 500): ${raw.slice(0, 500)}`,
        );
        throw new Error("Estimator returned invalid JSON.");
      }
    }
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

// If the response is a top-level array that was cut off mid-object,
// scan for the last fully-closed top-level item inside it and emit
// a valid array containing every complete item. Returns null if the
// shape isn't a recoverable array.
function repairTruncatedArray(text: string): string | null {
  const startIdx = text.indexOf("[");
  if (startIdx < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastCompleteTopLevelClose = -1;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
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
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      // A `}` that returns depth to 1 means we just closed a top-level
      // array element (depth 1 = inside the array, 0 = outside).
      if (ch === "}" && depth === 1) {
        lastCompleteTopLevelClose = i;
      }
    }
  }

  if (lastCompleteTopLevelClose < 0) return null;

  return `${text.slice(startIdx, lastCompleteTopLevelClose + 1)}]`;
}

// Scan `text` for the first balanced JSON array or object and return
// the substring. Counts brackets/braces to find the matching close,
// respecting strings and escapes. Returns null if no balanced value
// is found.
function extractFirstJsonValue(text: string): string | null {
  const startIdx = text.search(/[[{]/);
  if (startIdx < 0) return null;

  const open = text[startIdx];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
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
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }

  return null;
}

function parseEstimateItem(item: unknown): FoodEstimate {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new Error("Estimator returned malformed food estimate.");
  }

  const obj = item as Record<string, unknown>;
  const llmCalories = toInteger(obj.calories);
  if (llmCalories === null || llmCalories < 0) {
    throw new Error("Estimator returned invalid calories.");
  }

  const components = parseComponents(obj.components);

  const llmMacros = {
    proteinG: toOptionalInteger(obj.proteinG),
    carbsG: toOptionalInteger(obj.carbsG),
    fatG: toOptionalInteger(obj.fatG),
    fiberG: toOptionalInteger(obj.fiberG),
    sodiumMg: toOptionalInteger(obj.sodiumMg),
    addedSugarG: toOptionalInteger(obj.addedSugarG),
    saturatedFatG: toOptionalInteger(obj.saturatedFatG),
  };

  // When the LLM provides >= 2 components, code sums them instead of trusting
  // the LLM's top-level totals. The LLM is unreliable at arithmetic on
  // composite meals (e.g., yogurt + chia where it drops one component's
  // macros). Single-component or empty-component entries keep top-level
  // values unchanged.
  const useComponentSum = components.length >= 2;
  const summedCalories = useComponentSum ? sumCalories(components) : null;

  return {
    mealName: String(obj.mealName ?? "").slice(0, 40).trim() || "Estimated food",
    category: parseCategory(obj.category),
    calories:
      summedCalories !== null && summedCalories > 0
        ? summedCalories
        : llmCalories,
    proteinG: useComponentSum
      ? sumMacro(components, "proteinG")
      : llmMacros.proteinG,
    carbsG: useComponentSum
      ? sumMacro(components, "carbsG")
      : llmMacros.carbsG,
    fatG: useComponentSum ? sumMacro(components, "fatG") : llmMacros.fatG,
    fiberG: useComponentSum
      ? sumMacro(components, "fiberG")
      : llmMacros.fiberG,
    sodiumMg: useComponentSum
      ? sumMacro(components, "sodiumMg")
      : llmMacros.sodiumMg,
    addedSugarG: useComponentSum
      ? sumMacro(components, "addedSugarG")
      : llmMacros.addedSugarG,
    saturatedFatG: useComponentSum
      ? sumMacro(components, "saturatedFatG")
      : llmMacros.saturatedFatG,
    reasoning: String(obj.reasoning ?? "").slice(0, 300),
    confidence: parseConfidence(obj.confidence),
    components,
  };
}

function parseComponents(value: unknown): EstimateComponent[] {
  if (!Array.isArray(value)) return [];

  const components: EstimateComponent[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }

    const obj = entry as Record<string, unknown>;
    const calories = toInteger(obj.calories);
    if (calories === null || calories < 0) continue;

    const name = String(obj.name ?? "").slice(0, 60).trim();
    if (!name) continue;

    components.push({
      name,
      calories,
      proteinG: toOptionalInteger(obj.proteinG),
      carbsG: toOptionalInteger(obj.carbsG),
      fatG: toOptionalInteger(obj.fatG),
      fiberG: toOptionalInteger(obj.fiberG),
      sodiumMg: toOptionalInteger(obj.sodiumMg),
      addedSugarG: toOptionalInteger(obj.addedSugarG),
      saturatedFatG: toOptionalInteger(obj.saturatedFatG),
    });
  }

  return components;
}

function sumCalories(components: EstimateComponent[]): number {
  return components.reduce((total, component) => total + component.calories, 0);
}

function sumMacro(
  components: EstimateComponent[],
  field: NullableMacroField,
): number | null {
  let hasAnyValue = false;
  let total = 0;
  for (const component of components) {
    const value = component[field];
    if (value !== null && Number.isFinite(value)) {
      hasAnyValue = true;
      total += value;
    }
  }
  return hasAnyValue ? Math.round(total) : null;
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
