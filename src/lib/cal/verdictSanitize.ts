// LLMs hallucinate arithmetic. If a verdict_reason contains a
// percentage or specific milligram/gram/calorie totals about budgets,
// the number is almost certainly wrong. Strip those substrings rather
// than display a confident lie. The day-totals UI already shows real
// percentages and totals computed in code.
//
// Lives in its own file (not verdict.ts) so it can be tested without
// dragging in the "server-only" boundary.

export function stripQuantitativeClaims(reason: string): string {
  let cleaned = reason;

  // "Pushes daily calories to 110% of target ..." or any sentence/clause
  // containing a percentage — drop the whole containing clause up to the
  // next sentence-ish boundary.
  cleaned = cleaned.replace(
    /[^.;,]*\b\d{1,4}\s*%[^.;]*[.;]?/g,
    "",
  );

  // "over 1,500mg sodium" / "hits 1200 cal" / "exceeds 1650 calories" —
  // strip numeric+unit claims that compare to budgets/totals but leave
  // raw macro descriptors about the entry itself.
  cleaned = cleaned.replace(
    /\b(?:over|above|past|exceeds?|hits?|reaches?|pushes?\s+to)\s+\d[\d,]*\s*(?:cal|mg|g)\b[^.;]*[.;]?/gi,
    "",
  );

  // "1200 cal of the daily budget" / "1500mg of the target" — strip
  // numeric+unit claims framed as budget/ceiling/limit references.
  cleaned = cleaned.replace(
    /\b\d[\d,]*\s*(?:cal|mg|g)\s+of\s+\w+\s*(?:target|budget|ceiling|limit)[^.;]*[.;]?/gi,
    "",
  );

  // Clean up doubled spaces / dangling punctuation left by the strips
  cleaned = cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .replace(/^[\s.,;]+/, "")
    .trim();

  return cleaned;
}
