"use server";

import { requireUser } from "@/lib/auth";
import {
  buildDayObservations,
  buildWeekObservations,
  hashObservations,
} from "@/lib/cal/coachReview";
import {
  generateCoachReviewForObservations,
  peekCoachReview,
  type CoachReviewPeekResult,
  type GenerateCoachReviewResult,
} from "@/lib/cal/coachReviewGenerator";
import { getShiftlyCalData } from "@/lib/cal/data";

export type CoachReviewActionResult =
  | { ok: true; review: GenerateCoachReviewResult }
  | { ok: false; reason: string };

export type CoachReviewPeekActionResult =
  | ({ ok: true } & CoachReviewPeekResult)
  | { ok: false; reason: string };

/**
 * Daily coach line for the focused-day strip. Triggered by the
 * focused-day view on first render and re-fetched when the entry
 * set / verdict state changes (the observations_hash invalidates
 * automatically).
 *
 * Returns the kill-switched response when ENABLE_CAL_COACH != "1"
 * so production stays cheap during dev/iteration.
 */
export async function generateFocusedDayCoachReviewAction(
  date?: string,
): Promise<CoachReviewActionResult> {
  if (process.env.ENABLE_CAL_COACH !== "1") {
    return { ok: false, reason: "Coach reviews disabled in env" };
  }

  const { supabase, user } = await requireUser();
  const data = await getShiftlyCalData();
  const targetDate = date ?? data.todayIso;
  const day =
    data.currentWeek.days.find((d) => d.date === targetDate) ??
    data.currentWeek.days.find((d) => d.date === data.todayIso);
  if (!day) return { ok: false, reason: "No matching day in current week" };

  const obs = buildDayObservations(day, data.targets, data.currentWeek.days);

  // Empty days don't need a coach line.
  if (obs.recentEntries.length === 0) {
    return { ok: false, reason: "No entries on focused day" };
  }

  const review = await generateCoachReviewForObservations(
    supabase,
    user.id,
    obs,
  );
  return { ok: true, review };
}

export async function peekFocusedDayCoachReviewAction(
  date?: string,
): Promise<CoachReviewPeekActionResult> {
  if (process.env.ENABLE_CAL_COACH !== "1") {
    return { ok: false, reason: "Coach reviews disabled in env" };
  }

  const { supabase, user } = await requireUser();
  const data = await getShiftlyCalData();
  const targetDate = date ?? data.todayIso;
  const day =
    data.currentWeek.days.find((d) => d.date === targetDate) ??
    data.currentWeek.days.find((d) => d.date === data.todayIso);
  if (!day) return { ok: false, reason: "No matching day in current week" };

  const obs = buildDayObservations(day, data.targets, data.currentWeek.days);
  if (obs.recentEntries.length === 0) {
    return { ok: false, reason: "No entries on focused day" };
  }

  const review = await peekCoachReview(
    supabase,
    user.id,
    obs.scope,
    obs.periodKey,
    hashObservations(obs),
  );

  if (!review) {
    return { ok: false, reason: "No cached coach review" };
  }

  return { ok: true, ...review };
}

/**
 * Weekly coach band. Refreshes when the week's observation hash
 * changes (any entry mutation across the week shifts the hash) or
 * when the user crosses the date boundary into a new period key.
 */
export async function generateWeeklyCoachReviewAction(): Promise<CoachReviewActionResult> {
  if (process.env.ENABLE_CAL_COACH !== "1") {
    return { ok: false, reason: "Coach reviews disabled in env" };
  }

  const { supabase, user } = await requireUser();
  const data = await getShiftlyCalData();
  const week = data.currentWeek;

  const obs = buildWeekObservations(week, data.targets);
  if (obs.recentEntries.length === 0) {
    return { ok: false, reason: "Week has no logged entries yet" };
  }

  const review = await generateCoachReviewForObservations(
    supabase,
    user.id,
    obs,
  );
  return { ok: true, review };
}

export async function peekWeeklyCoachReviewAction(): Promise<CoachReviewPeekActionResult> {
  if (process.env.ENABLE_CAL_COACH !== "1") {
    return { ok: false, reason: "Coach reviews disabled in env" };
  }

  const { supabase, user } = await requireUser();
  const data = await getShiftlyCalData();
  const week = data.currentWeek;

  const obs = buildWeekObservations(week, data.targets);
  if (obs.recentEntries.length === 0) {
    return { ok: false, reason: "Week has no logged entries yet" };
  }

  const review = await peekCoachReview(
    supabase,
    user.id,
    obs.scope,
    obs.periodKey,
    hashObservations(obs),
  );

  if (!review) {
    return { ok: false, reason: "No cached coach review" };
  }

  return { ok: true, ...review };
}
