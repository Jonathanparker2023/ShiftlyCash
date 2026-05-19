"use client";

import { useState } from "react";

import type {
  MealPlan,
  MealPlanCandidate,
  ValidationResult,
} from "@/lib/cal/mealPlan/types";

type MealPlanCardProps = {
  cyclesExhausted?: boolean;
  disabled?: boolean;
  onAccept: (force?: boolean) => void;
  onCycleFiller: () => void;
  onCycleMain: () => void;
  plan: MealPlan;
  validationResult: ValidationResult;
};

export function MealPlanCard({
  cyclesExhausted = false,
  disabled = false,
  onAccept,
  onCycleFiller,
  onCycleMain,
  plan,
  validationResult,
}: MealPlanCardProps) {
  const [confirmAcceptAnyway, setConfirmAcceptAnyway] = useState(false);
  const isValid = validationResult.ok;

  return (
    <section
      className={`overflow-hidden rounded-lg border bg-black/40 text-white shadow-[0_24px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl ${
        isValid ? "border-emerald-300/25" : "border-amber-300/25"
      }`}
    >
      <div className={isValid ? "" : "opacity-90 saturate-75"}>
        <MainCourseRow candidate={plan.main} />
        <div className="border-t border-white/10 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
            Fillers
          </p>
          <div className="mt-2 space-y-1.5">
            {plan.fillers.length > 0 ? (
              plan.fillers.map((filler) => (
                <FillerRow filler={filler} key={filler.id} />
              ))
            ) : (
              <p className="text-xs font-semibold text-white/45">
                No filler needed.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
              Totals
            </p>
            <p className="mt-1 text-xs font-semibold text-white/75">
              {formatTotals(plan)}
            </p>
          </div>
          {isValid ? (
            <p className="text-xs font-semibold text-emerald-300">
              All benchmarks clear.
            </p>
          ) : (
            <p className="text-xs font-semibold text-amber-300">
              couldn't close
            </p>
          )}
        </div>
      </div>

      {!isValid ? (
        <div className="border-t border-white/10 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
            Gaps
          </p>
          <ul className="mt-2 space-y-1.5 text-xs font-semibold text-amber-100/90">
            {validationResult.gaps.map((gap) => (
              <li key={`${gap.metric}-${gap.direction}`}>
                {gap.remediation}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="border-t border-white/10 px-3 py-3">
        <div className="flex flex-wrap gap-2">
          <SecondaryButton disabled={disabled} onClick={onCycleMain}>
            Cycle main
          </SecondaryButton>
          <SecondaryButton disabled={disabled} onClick={onCycleFiller}>
            Cycle filler
          </SecondaryButton>
          {isValid ? (
            <button
              className="min-h-9 rounded-md border border-emerald-300/50 bg-emerald-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              onClick={() => onAccept(false)}
              type="button"
            >
              Accept & log
            </button>
          ) : (
            <SecondaryButton
              disabled={disabled}
              onClick={() => setConfirmAcceptAnyway(true)}
            >
              Accept anyway
            </SecondaryButton>
          )}
        </div>
        {cyclesExhausted ? (
          <p className="mt-2 text-xs font-semibold text-amber-200/80">
            Cycle pool is thin. Regenerate to broaden candidates.
          </p>
        ) : null}
        {!isValid && confirmAcceptAnyway ? (
          <div className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/10 p-3">
            <p className="text-xs font-semibold text-amber-100">
              Log this plan even though it misses some targets?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="min-h-8 rounded-md border border-amber-300/40 bg-amber-300/20 px-3 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/30 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                onClick={() => onAccept(true)}
                type="button"
              >
                Yes, log
              </button>
              <SecondaryButton
                disabled={disabled}
                onClick={() => setConfirmAcceptAnyway(false)}
              >
                Cancel
              </SecondaryButton>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function MainCourseRow({ candidate }: { candidate: MealPlanCandidate }) {
  return (
    <div className="px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
          Main
        </p>
        <div className="flex flex-wrap gap-1.5">
          <ExternalChip href={candidate.doordashUrl} label="DoorDash" />
          <ExternalChip href={candidate.sourceUrl} label="Source" />
        </div>
      </div>
      <h3 className="mt-1 text-base font-semibold leading-tight text-white">
        {candidate.name}
      </h3>
      <p className="mt-1 text-xs font-semibold text-white/70">
        {formatCandidateMacros(candidate)}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <TierBadge candidate={candidate} />
        <ConfidenceBadge candidate={candidate} />
      </div>
    </div>
  );
}

function FillerRow({ filler }: { filler: MealPlanCandidate }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-white/80">
          {filler.name}
        </p>
        <p className="text-[10px] font-semibold text-white/40">
          {filler.macros.calories} cal • {filler.macros.proteinG}p
        </p>
      </div>
      <TierBadge candidate={filler} compact />
    </div>
  );
}

function TierBadge({
  candidate,
  compact = false,
}: {
  candidate: MealPlanCandidate;
  compact?: boolean;
}) {
  const classes = {
    database: "bg-emerald-700/30 text-emerald-200",
    published: "bg-sky-700/30 text-sky-200",
    inferred: "bg-amber-700/30 text-amber-200",
  }[candidate.tier];
  const range =
    candidate.tier === "inferred" && candidate.macroRange
      ? ` (${candidate.macroRange.calories.low}-${candidate.macroRange.calories.high} cal)`
      : "";

  return (
    <span
      className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${classes}`}
    >
      {compact ? candidate.tier : `${candidate.tier}${range}`}
    </span>
  );
}

function ConfidenceBadge({ candidate }: { candidate: MealPlanCandidate }) {
  const classes = {
    high: "text-white/70",
    medium: "text-white/60",
    low: "text-white/50",
  }[candidate.confidence];

  return (
    <span
      className={`rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${classes}`}
    >
      {candidate.confidence}
    </span>
  );
}

function ExternalChip({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <button
      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/45 transition hover:border-white/20 hover:text-white/70"
      onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
      type="button"
    >
      {label} ↗
    </button>
  );
}

function SecondaryButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="min-h-9 rounded-md border border-white/15 bg-transparent px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function formatCandidateMacros(candidate: MealPlanCandidate): string {
  return `${candidate.macros.calories} cal • ${candidate.macros.proteinG}p • ${candidate.macros.carbsG}c • ${candidate.macros.fiberG}fi • ${candidate.macros.fatG}fa`;
}

function formatTotals(plan: MealPlan): string {
  return `${plan.totals.calories} cal • ${plan.totals.proteinG}p • ${plan.totals.carbsG}c • ${plan.totals.fiberG}fi • ${plan.totals.fatG}fa`;
}
