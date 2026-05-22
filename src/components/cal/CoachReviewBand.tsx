"use client";

import { useEffect, useRef, useState } from "react";

import {
  generateFocusedDayCoachReviewAction,
  generateWeeklyCoachReviewAction,
  type CoachReviewActionResult,
} from "@/app/(protected)/cal/coachReviewActions";

// ── Weekly coach band ────────────────────────────────────────────────
//
// Slim glass band that lives near the top of the day section, above
// the focused-day column. Renders one terse pattern-line about the
// current week. Cached server-side by observation hash; visible swap
// only when entries change.

export function WeeklyCoachBand({
  weekStartIso,
  weekEntriesSignature,
}: {
  weekStartIso: string;
  // Anything that should trigger a re-fetch — typically a stringified
  // hash of (entry ids + verdicts + totals) so we re-call when the
  // week's data shifts.
  weekEntriesSignature: string;
}) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setState({ status: "loading" });

    generateWeeklyCoachReviewAction()
      .then((result) => {
        if (seqRef.current !== seq) return;
        setState(stateFromResult(result));
      })
      .catch((err: unknown) => {
        if (seqRef.current !== seq) return;
        setState({
          status: "hidden",
          reason: err instanceof Error ? err.message : "unknown error",
        });
      });
  }, [weekStartIso, weekEntriesSignature]);

  if (state.status === "hidden") return null;

  return (
    <div className="mt-4 rounded-lg border border-emerald-300/15 bg-emerald-500/[0.04] px-4 py-3 text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/70">
          Coach read — week
        </p>
        {state.status === "loading" ? (
          <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-400/40" />
        ) : null}
      </div>
      <p className="mt-1 text-sm font-medium leading-snug">
        {state.status === "loading" ? (
          <SkeletonLine />
        ) : (
          state.body
        )}
      </p>
    </div>
  );
}

// ── Focused-day strip ────────────────────────────────────────────────
//
// Darker compact band placed directly under FocusedDayHeader, above
// the entry list. Refreshes when the focused-day's entries/totals
// change. Stays hidden when there are no entries.

export function FocusedDayCoachStrip({
  focusedDate,
  daySignature,
}: {
  focusedDate: string;
  daySignature: string;
}) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setState({ status: "loading" });

    generateFocusedDayCoachReviewAction(focusedDate)
      .then((result) => {
        if (seqRef.current !== seq) return;
        setState(stateFromResult(result));
      })
      .catch((err: unknown) => {
        if (seqRef.current !== seq) return;
        setState({
          status: "hidden",
          reason: err instanceof Error ? err.message : "unknown error",
        });
      });
  }, [focusedDate, daySignature]);

  if (state.status === "hidden") return null;

  return (
    <div className="mt-3 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white/80 backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
          Coach read
        </p>
        {state.status === "loading" ? (
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/25" />
        ) : null}
      </div>
      <p className="mt-1 text-xs font-medium leading-snug">
        {state.status === "loading" ? (
          <SkeletonLine />
        ) : (
          state.body
        )}
      </p>
    </div>
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
      className="inline-block h-3 w-3/4 animate-pulse rounded bg-white/15"
    />
  );
}
