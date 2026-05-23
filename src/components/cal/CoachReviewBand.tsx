"use client";

import { useEffect, useRef, useState } from "react";

import {
  generateFocusedDayCoachReviewAction,
  generateWeeklyCoachReviewAction,
  type CoachReviewActionResult,
} from "@/app/(protected)/cal/coachReviewActions";
import { AppPanel } from "@/components/shell";

// ── Weekly coach band ────────────────────────────────────────────────
//
// Slim glass band that lives near the top of the day section, above
// the focused-day column. Renders one terse pattern-line about the
// current week. Cached server-side by observation hash; visible swap
// only when entries change.

export function WeeklyCoachBand({
  initialBody = null,
  weekStartIso,
  weekEntriesSignature,
}: {
  initialBody?: string | null;
  weekStartIso: string;
  // Anything that should trigger a re-fetch — typically a stringified
  // hash of (entry ids + verdicts + totals) so we re-call when the
  // week's data shifts.
  weekEntriesSignature: string;
}) {
  const initialSignature = useRef(`${weekStartIso}:${weekEntriesSignature}`);
  const [state, setState] = useState<FetchState>(() =>
    initialBody?.trim()
      ? { status: "ready", body: initialBody, source: "ai" }
      : { status: "loading" },
  );

  useEffect(() => {
    if (
      initialBody?.trim() &&
      initialSignature.current === `${weekStartIso}:${weekEntriesSignature}`
    ) {
      return;
    }

    let cancelled = false;

    generateWeeklyCoachReviewAction()
      .then((result) => {
        if (cancelled) return;
        setState(stateFromResult(result));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "hidden",
          reason: err instanceof Error ? err.message : "unknown error",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [initialBody, weekStartIso, weekEntriesSignature]);

  if (state.status === "hidden") return null;

  return (
    <AppPanel
      className="mt-4 px-4 py-3 text-[var(--text-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
      elevated
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary-text)]">
          Coach read — week
        </p>
        {state.status === "loading" ? (
          <span className="h-3 w-3 animate-pulse rounded-full bg-[var(--accent-primary-fill)]" />
        ) : null}
      </div>
      <p className="mt-1 text-sm font-medium leading-snug">
        {state.status === "loading" ? (
          <SkeletonLine />
        ) : (
          state.body
        )}
      </p>
    </AppPanel>
  );
}

// ── Focused-day strip ────────────────────────────────────────────────
//
// Darker compact band placed directly under FocusedDayHeader, above
// the entry list. Refreshes when the focused-day's entries/totals
// change. Stays hidden when there are no entries.

export function FocusedDayCoachStrip({
  initialBody = null,
  focusedDate,
  daySignature,
}: {
  initialBody?: string | null;
  focusedDate: string;
  daySignature: string;
}) {
  const initialSignature = useRef(`${focusedDate}:${daySignature}`);
  const [state, setState] = useState<FetchState>(() =>
    initialBody?.trim()
      ? { status: "ready", body: initialBody, source: "ai" }
      : { status: "loading" },
  );

  useEffect(() => {
    if (
      initialBody?.trim() &&
      initialSignature.current === `${focusedDate}:${daySignature}`
    ) {
      return;
    }

    let cancelled = false;

    generateFocusedDayCoachReviewAction(focusedDate)
      .then((result) => {
        if (cancelled) return;
        setState(stateFromResult(result));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "hidden",
          reason: err instanceof Error ? err.message : "unknown error",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [initialBody, focusedDate, daySignature]);

  if (state.status === "hidden") return null;

  return (
    <AppPanel className="mt-3 px-3 py-2 text-[var(--text-secondary)]" elevated>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          Coach read
        </p>
        {state.status === "loading" ? (
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--surface-hover)]" />
        ) : null}
      </div>
      <p className="mt-1 text-xs font-medium leading-snug">
        {state.status === "loading" ? (
          <SkeletonLine />
        ) : (
          state.body
        )}
      </p>
    </AppPanel>
  );
}

// ── Shared helpers ───────────────────────────────────────────────────

type FetchState =
  | { status: "loading" }
  | { status: "ready"; body: string; source: "ai" | "fallback" }
  | { status: "hidden"; reason: string };

function stateFromResult(result: CoachReviewActionResult): FetchState {
  if (result.ok) {
    return {
      status: "ready",
      body: result.review.body,
      source: result.review.source,
    };
  }
  return { status: "hidden", reason: result.reason };
}

function SkeletonLine() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3/4 animate-pulse rounded bg-[var(--surface-elevated)]"
    />
  );
}
