"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  acceptMealPlanAction,
  generateMealPlanAction,
  reassembleMealPlanAction,
} from "@/app/(protected)/cal/mealPlanActions";
import { MealPlanAxiomBar } from "@/components/cal/MealPlanAxiomBar";
import { MealPlanCard } from "@/components/cal/MealPlanCard";
import type {
  CandidatePool,
  MealPlan,
  MealPlanAxioms,
  RemainingTargets,
  ValidationResult,
} from "@/lib/cal/mealPlan/types";

type MealPlanGeneratorProps = {
  date: string;
  targets: RemainingTargets;
};

type LoadingState = "generate" | "cycleMain" | "cycleFiller" | "accept" | null;

const CYCLE_EXHAUSTION_LIMIT = 3;
const DEFAULT_AXIOMS: MealPlanAxioms = {
  eatOut: true,
  requireDoorDash: true,
  allowNonDoorDashMain: false,
  carbMode: "indifferent",
  locationHint: "Naugatuck, CT",
};

export function MealPlanGenerator({ date, targets }: MealPlanGeneratorProps) {
  const router = useRouter();
  const [axioms, setAxioms] = useState<MealPlanAxioms>(DEFAULT_AXIOMS);
  const [pool, setPool] = useState<CandidatePool | null>(null);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [excludedMainIds, setExcludedMainIds] = useState<string[]>([]);
  const [excludedFillerIds, setExcludedFillerIds] = useState<string[]>([]);
  const [cyclesUsed, setCyclesUsed] = useState({ main: 0, filler: 0 });
  const [loading, setLoading] = useState<LoadingState>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [cyclesExhausted, setCyclesExhausted] = useState(false);

  const disabled = loading !== null;

  function updateAxioms(next: MealPlanAxioms) {
    setAxioms(next);
    setError(null);
    setStatus(null);
    resetPlanState();
  }

  async function generatePlan() {
    setLoading("generate");
    setError(null);
    setStatus(null);
    resetCycleState();

    try {
      const result = await generateMealPlanAction(axioms);
      setPool(result.pool);
      setPlan(result.plan);
      setValidation(result.validation);
      setCyclesExhausted(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate plan.");
      resetPlanState();
    } finally {
      setLoading(null);
    }
  }

  async function cycleMain() {
    if (!pool || !plan || cyclesUsed.main >= CYCLE_EXHAUSTION_LIMIT) {
      setCyclesExhausted(true);
      return;
    }

    const nextExcluded = [...excludedMainIds, plan.main.id];
    setLoading("cycleMain");
    setError(null);

    try {
      const result = await reassembleMealPlanAction(pool, {
        excludeMainIds: nextExcluded,
      });
      if (!result.plan) {
        setCyclesExhausted(true);
        setValidation(result.validation);
        return;
      }

      const nextCyclesUsed = { ...cyclesUsed, main: cyclesUsed.main + 1 };
      setExcludedMainIds(nextExcluded);
      setCyclesUsed(nextCyclesUsed);
      setPlan(result.plan);
      setValidation(result.validation);
      setCyclesExhausted(nextCyclesUsed.main >= CYCLE_EXHAUSTION_LIMIT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to cycle main.");
    } finally {
      setLoading(null);
    }
  }

  async function cycleFiller() {
    if (!pool || !plan || cyclesUsed.filler >= CYCLE_EXHAUSTION_LIMIT) {
      setCyclesExhausted(true);
      return;
    }

    const nextExcluded = [
      ...excludedFillerIds,
      ...plan.fillers.map((filler) => filler.id),
    ];
    setLoading("cycleFiller");
    setError(null);

    try {
      const result = await reassembleMealPlanAction(pool, {
        excludeFillerIds: nextExcluded,
        holdMainId: plan.main.id,
      });
      if (!result.plan) {
        setCyclesExhausted(true);
        setValidation(result.validation);
        return;
      }

      const nextCyclesUsed = { ...cyclesUsed, filler: cyclesUsed.filler + 1 };
      setExcludedFillerIds(nextExcluded);
      setCyclesUsed(nextCyclesUsed);
      setPlan(result.plan);
      setValidation(result.validation);
      setCyclesExhausted(nextCyclesUsed.filler >= CYCLE_EXHAUSTION_LIMIT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to cycle filler.");
    } finally {
      setLoading(null);
    }
  }

  async function acceptPlan() {
    if (!plan) return;

    setLoading("accept");
    setError(null);
    try {
      const result = await acceptMealPlanAction(plan, date);
      setStatus(`Logged ${result.loggedEntryIds.length} items.`);
      resetPlanState();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to log plan.");
    } finally {
      setLoading(null);
    }
  }

  function resetCycleState() {
    setExcludedMainIds([]);
    setExcludedFillerIds([]);
    setCyclesUsed({ main: 0, filler: 0 });
    setCyclesExhausted(false);
  }

  function resetPlanState() {
    setPool(null);
    setPlan(null);
    setValidation(null);
    resetCycleState();
  }

  return (
    <section className="rounded-lg border border-white/10 bg-black/40 p-3 text-white shadow-[0_20px_70px_rgba(0,0,0,0.26)] backdrop-blur-xl">
      <MealPlanAxiomBar
        axioms={axioms}
        disabled={disabled}
        onChange={updateAxioms}
      />

      <BenchmarkStrip targets={targets} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-emerald-300/50 bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          disabled={disabled}
          onClick={generatePlan}
          type="button"
        >
          {loading === "generate" ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Researching candidates...
            </>
          ) : (
            "Generate plan"
          )}
        </button>

        {loading && loading !== "generate" ? (
          <p className="text-xs font-semibold text-white/50">
            {loadingLabel(loading)}
          </p>
        ) : null}
      </div>

      {cyclesExhausted ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-2">
          <p className="text-xs font-semibold text-amber-100">
            Pool exhausted — Generate plan to refresh.
          </p>
          <button
            className="min-h-8 rounded-md border border-amber-300/40 bg-amber-300/20 px-3 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/30 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={generatePlan}
            type="button"
          >
            Generate plan
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs font-semibold text-rose-200">{error}</p>
      ) : null}
      {status ? (
        <p className="mt-2 text-xs font-semibold text-emerald-300">{status}</p>
      ) : null}

      {plan && validation ? (
        <div className="mt-3">
          <MealPlanCard
            disabled={disabled}
            onAccept={acceptPlan}
            onCycleFiller={cycleFiller}
            onCycleMain={cycleMain}
            plan={plan}
            validationResult={validation}
          />
        </div>
      ) : validation && !validation.ok ? (
        <FailurePanel validation={validation} />
      ) : null}
    </section>
  );
}

function BenchmarkStrip({ targets }: { targets: RemainingTargets }) {
  const metrics = [
    { label: "Cal", unit: "cal", value: targets.calories },
    { label: "Protein", unit: "g", value: targets.proteinG },
    { label: "Carbs", unit: "g", value: targets.carbsG },
    { label: "Fiber", unit: "g", value: targets.fiberG },
    { label: "Fat", unit: "g", value: targets.fatG },
    { label: "Sodium", unit: "mg", value: targets.sodiumMg },
    { label: "Sugar", unit: "g", value: targets.addedSugarG },
    { label: "Sat fat", unit: "g", value: targets.saturatedFatG },
  ];

  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {metrics.map((metric) => {
        const width = metric.value > 0 ? 100 : 0;
        return (
          <div
            className="rounded-md border border-white/10 bg-black/30 px-2 py-2"
            key={metric.label}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">
                {metric.label}
              </p>
              <p className="text-[10px] font-semibold text-white/65">
                {formatMetric(metric.value, metric.unit)} left
              </p>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <span
                className="block h-1.5 rounded-full bg-emerald-500"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FailurePanel({ validation }: { validation: ValidationResult }) {
  if (validation.ok) return null;

  return (
    <div className="mt-3 rounded-lg border border-amber-300/25 bg-black/30 p-3">
      <p className="text-xs font-semibold text-amber-300">couldn't close</p>
      <ul className="mt-2 space-y-1.5 text-xs font-semibold text-amber-100/90">
        {validation.gaps.map((gap) => (
          <li key={`${gap.metric}-${gap.direction}`}>{gap.remediation}</li>
        ))}
      </ul>
    </div>
  );
}

function loadingLabel(loading: Exclude<LoadingState, null>): string {
  if (loading === "cycleMain") return "Cycling main...";
  if (loading === "cycleFiller") return "Cycling filler...";
  return "Logging...";
}

function formatMetric(value: number, unit: string): string {
  return `${Math.max(0, Math.round(value)).toLocaleString()} ${unit}`;
}
