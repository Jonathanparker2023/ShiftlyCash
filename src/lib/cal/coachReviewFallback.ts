// Deterministic templated coach text used when the Anthropic call
// fails (API down, rate limit, key missing). NOT the primary path —
// the AI generator produces better voice. But shipping with a real
// fallback means a broken upstream never leaves the coach surface
// blank.
//
// Lives in its own file so it can be tested without "server-only".

import type {
  CoachObservations,
  CoachSignal,
  CoachSuggestion,
} from "@/lib/cal/coachReview";

// Priority order — first match wins for the headline phrase. Keep
// short and obvious. These mirror the signal vocabulary in
// coachReview.ts.
const SIGNAL_PHRASES: Array<{ signal: CoachSignal; phrase: string }> = [
  { signal: "bp_alert", phrase: "sodium's been heavy, BP cue" },
  { signal: "sodium_dash_streak", phrase: "third day running on sodium" },
  { signal: "sodium_high_today", phrase: "sodium load is high" },
  { signal: "liquid_sugar_today", phrase: "liquid sugar with no fiber buffer" },
  { signal: "sugar_high_today", phrase: "sugar's high today" },
  { signal: "sat_fat_high_today", phrase: "saturated fat ran high" },
  { signal: "fiber_week_short", phrase: "fiber's been quiet all week" },
  { signal: "fiber_low", phrase: "fiber's light" },
  { signal: "protein_short_streak", phrase: "protein's been thin a few days" },
  { signal: "protein_low", phrase: "protein's running short" },
  { signal: "calories_under", phrase: "intake's under today" },
  { signal: "calories_over", phrase: "calories ran past target" },
  { signal: "water_short", phrase: "water's been low" },
  { signal: "week_indulgence_heavy", phrase: "indulgence-heavy week" },
  { signal: "week_clean_streak", phrase: "clean stretch this week" },
  { signal: "week_surplus", phrase: "week's running over" },
  { signal: "week_deficit", phrase: "week's running under" },
];

// Fallback prose template. Format: "<food>. <headline>.<suggestion>."
export function buildFallbackBody(obs: CoachObservations): string {
  const food = formatFoodLead(obs.recentEntries);
  const headline = primarySignalPhrase(obs.signals);
  const tail = formatSuggestionTail(obs.suggestion);

  const parts = [food, headline].filter((part) => part.length > 0);
  return `${parts.join(" — ")}.${tail}`.replace(/\s+/g, " ").trim();
}

// Choose the most actionable signal to lead with. Safety signals
// (bp_alert, sodium streak) outrank macro shortages.
export function primarySignalPhrase(signals: CoachSignal[]): string {
  for (const { signal, phrase } of SIGNAL_PHRASES) {
    if (signals.includes(signal)) return phrase;
  }
  if (signals.includes("calories_on_track") && signals.includes("protein_on_track")) {
    return "macros are landing clean";
  }
  return "log noted";
}

function formatFoodLead(entries: string[]): string {
  if (entries.length === 0) return "Nothing logged yet";
  if (entries.length === 1) return entries[0];
  if (entries.length === 2) return `${entries[0]} + ${entries[1]}`;
  return `${entries[0]}, ${entries[1]}, +${entries.length - 2} more`;
}

function formatSuggestionTail(suggestion: CoachSuggestion): string {
  if (suggestion.kind === "none" || !suggestion.body.trim()) return "";
  return ` Try ${suggestion.body}.`;
}
