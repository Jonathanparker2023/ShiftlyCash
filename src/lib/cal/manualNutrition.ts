export type ExplicitNutritionOverrides = {
  calories?: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  fiberG?: number | null;
  sodiumMg?: number | null;
  addedSugarG?: number | null;
  saturatedFatG?: number | null;
};

type NutritionField = keyof ExplicitNutritionOverrides;

type FieldPattern = {
  field: NutritionField;
  prefix: RegExp;
  suffix: RegExp;
};

const FIELD_PATTERNS: FieldPattern[] = [
  {
    field: "calories",
    prefix: /\b(?:calories|calorie|cals|cal)\b\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
    suffix: /(\d+(?:\.\d+)?)\s*(?:calories|calorie|cals|cal)\b/i,
  },
  {
    field: "proteinG",
    prefix: /\bprotein\b(?:\s*g(?:rams?)?)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*g?\b/i,
    suffix: /(\d+(?:\.\d+)?)\s*g\s*protein\b/i,
  },
  {
    field: "carbsG",
    prefix: /\b(?:carbs|carbohydrates)\b(?:\s*g(?:rams?)?)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*g?\b/i,
    suffix: /(\d+(?:\.\d+)?)\s*g\s*(?:carbs|carbohydrates)\b/i,
  },
  {
    field: "fatG",
    prefix: /(?:^|[,;\n])\s*\bfat\b(?:\s*g(?:rams?)?)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*g?\b/i,
    suffix: /(\d+(?:\.\d+)?)\s*g\s*fat\b/i,
  },
  {
    field: "fiberG",
    prefix: /\bfiber\b(?:\s*g(?:rams?)?)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*g?\b/i,
    suffix: /(\d+(?:\.\d+)?)\s*g\s*fiber\b/i,
  },
  {
    field: "sodiumMg",
    prefix: /\bsodium\b(?:\s*mg)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mg?\b/i,
    suffix: /(\d+(?:\.\d+)?)\s*mg\s*sodium\b/i,
  },
  {
    field: "addedSugarG",
    prefix: /\badded\s+sugar\b(?:\s*g(?:rams?)?)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*g?\b/i,
    suffix: /(\d+(?:\.\d+)?)\s*g\s*added\s+sugar\b/i,
  },
  {
    field: "saturatedFatG",
    prefix: /\b(?:saturated\s+fat|sat\.?\s+fat)\b(?:\s*g(?:rams?)?)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*g?\b/i,
    suffix: /(\d+(?:\.\d+)?)\s*g\s*(?:saturated\s+fat|sat\.?\s+fat)\b/i,
  },
];

export function extractExplicitNutritionOverrides(
  description: string,
): ExplicitNutritionOverrides {
  const normalized = description.trim();
  if (!normalized) {
    return {};
  }

  const candidateTexts =
    lineCount(normalized) > 1 && !hasTotalCue(normalized)
      ? [normalized]
      : buildCandidates(normalized);
  const candidates = candidateTexts
    .map((text) => ({ text, overrides: extractFromText(text), score: 0 }))
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate.text, candidate.overrides),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.overrides ?? {};
}

export function applyExplicitNutritionOverrides<
  T extends ExplicitNutritionOverrides,
>(estimate: T, description: string): T {
  const overrides = extractExplicitNutritionOverrides(description);

  if (Object.keys(overrides).length === 0) {
    return estimate;
  }

  return { ...estimate, ...overrides };
}

function buildCandidates(description: string): string[] {
  const lines = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lineGroups = lines.flatMap((line, index) => {
    const previous = lines[index - 1];
    const next = lines[index + 1];
    return [
      line,
      previous ? `${previous}\n${line}` : "",
      next ? `${line}\n${next}` : "",
    ].filter(Boolean);
  });

  return Array.from(new Set([...lineGroups, description]));
}

function extractFromText(text: string): ExplicitNutritionOverrides {
  const overrides: ExplicitNutritionOverrides = {};

  for (const pattern of FIELD_PATTERNS) {
    const value = findValue(text, pattern);
    if (value !== null) {
      overrides[pattern.field] = value;
    }
  }

  return overrides;
}

function findValue(text: string, pattern: FieldPattern): number | null {
  const matches = [
    ...matchValues(text, pattern.prefix),
    ...matchValues(text, pattern.suffix),
  ].sort((left, right) => left.index - right.index);
  const rawValue = matches[matches.length - 1]?.value;
  if (rawValue === undefined) {
    return null;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round(value);
}

function matchValues(
  text: string,
  pattern: RegExp,
): Array<{ index: number; value: string }> {
  return [...text.matchAll(new RegExp(pattern.source, "gi"))]
    .map((match) => ({ index: match.index ?? 0, value: match[1] ?? "" }))
    .filter((match) => match.value);
}

function scoreCandidate(
  text: string,
  overrides: ExplicitNutritionOverrides,
): number {
  const fieldCount = Object.keys(overrides).length;
  if (fieldCount === 0) {
    return 0;
  }

  const lower = text.toLowerCase();
  const totalCue = hasTotalCue(lower);

  if (fieldCount === 1 && !totalCue) {
    return 0;
  }

  if (!totalCue && hasRepeatedFieldValues(text)) {
    return 0;
  }

  return fieldCount + (totalCue ? 10 : 0);
}

function hasTotalCue(text: string): boolean {
  return /\b(total|totals|for logging|macro summary|nutrition facts|calculated)\b/i.test(
    text,
  );
}

function lineCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim()).length;
}

function hasRepeatedFieldValues(text: string): boolean {
  return FIELD_PATTERNS.some((pattern) => {
    const matches = [
      ...text.matchAll(new RegExp(pattern.prefix.source, "gi")),
      ...text.matchAll(new RegExp(pattern.suffix.source, "gi")),
    ];

    return matches.length > 1;
  });
}
