"use client";

import { useState } from "react";

import {
  acceptMealPlanAction,
  generateMealPlanAction,
} from "@/app/(protected)/cal/mealPlanActions";
import { MealPlanAxiomBar } from "@/components/cal/MealPlanAxiomBar";
import { MealPlanCard } from "@/components/cal/MealPlanCard";
import { assembleMealPlan } from "@/lib/cal/mealPlan/assembler";
import { validateMealPlan } from "@/lib/cal/mealPlan/validator";
import type {
  CandidatePool,
  MealPlan,
  MealPlanAxioms,
  MealPlanCandidate,
  MealPlanMacros,
  RemainingTargets,
  ValidationResult,
} from "@/lib/cal/mealPlan/types";

type MealPlanGeneratorProps = {
  targets: RemainingTargets;
};

type DevScenario = "success" | "failure";

const IS_DEV = process.env.NODE_ENV === "development";
const CYCLE_EXHAUSTION_LIMIT = 3;
const DEFAULT_AXIOMS: MealPlanAxioms = {
  eatOut: true,
  requireDoorDash: true,
  allowNonDoorDashMain: false,
  carbMode: "indifferent",
  locationHint: "Naugatuck, CT",
};

const MOCK_TARGETS: RemainingTargets = {
  calories: 1000,
  proteinG: 70,
  carbsG: 100,
  fiberG: 15,
  fatG: 35,
  sodiumMg: 1500,
  addedSugarG: 25,
  saturatedFatG: 12,
};

export function MealPlanGenerator({ targets }: MealPlanGeneratorProps) {
  const [axioms, setAxioms] = useState<MealPlanAxioms>(DEFAULT_AXIOMS);
  const [candidatePool, setCandidatePool] = useState<CandidatePool | null>(null);
  const [currentPlan, setCurrentPlan] = useState<MealPlan | null>(null);
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [cyclesExhausted, setCyclesExhausted] = useState(false);
  const [excludedMainIds, setExcludedMainIds] = useState<string[]>([]);
  const [excludedFillerIds, setExcludedFillerIds] = useState<string[]>([]);
  const [devScenario, setDevScenario] = useState<DevScenario>("success");
  const [usesMockTargets, setUsesMockTargets] = useState(false);
  const activeTargets = usesMockTargets ? MOCK_TARGETS : targets;

  async function generatePlan() {
    setIsLoading(true);
    setStatus(null);
    setCyclesExhausted(false);
    setExcludedMainIds([]);
    setExcludedFillerIds([]);

    try {
      if (IS_DEV) {
        await new Promise((resolve) => window.setTimeout(resolve, 260));
        const result = buildMockResponse(axioms, devScenario);
        setUsesMockTargets(true);
        setCandidatePool(result.pool);
        setCurrentPlan(result.plan);
        setValidationResult(result.validation);
        return;
      }

      const result = await generateMealPlanAction(axioms);
      setUsesMockTargets(false);
      setCandidatePool(result.pool);
      setCurrentPlan(result.plan);
      setValidationResult(result.validation);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unable to generate plan.");
      setCandidatePool(null);
      setCurrentPlan(null);
      setValidationResult(null);
    } finally {
      setIsLoading(false);
    }
  }

  function cycleMain() {
    if (!candidatePool || !currentPlan) return;

    const nextExcluded = [...excludedMainIds, currentPlan.main.id];
    const nextPlan = assembleMealPlan(candidatePool, activeTargets, {
      excludeMainIds: nextExcluded,
    });
    if (!nextPlan) {
      setCyclesExhausted(true);
      return;
    }

    setExcludedMainIds(nextExcluded);
    setCurrentPlan(nextPlan);
    setValidationResult(validateMealPlan(nextPlan, activeTargets, candidatePool));
    setCyclesExhausted(
      nextExcluded.length >= CYCLE_EXHAUSTION_LIMIT ||
        viableMainCount(candidatePool) < 2,
    );
  }

  function cycleFiller() {
    if (!candidatePool || !currentPlan) return;

    const nextExcluded = [
      ...excludedFillerIds,
      ...currentPlan.fillers.map((filler) => filler.id),
    ];
    const nextPlan = assembleMealPlan(candidatePool, activeTargets, {
      excludeFillerIds: nextExcluded,
      holdMainId: currentPlan.main.id,
    });
    if (!nextPlan) {
      setCyclesExhausted(true);
      return;
    }

    setExcludedFillerIds(nextExcluded);
    setCurrentPlan(nextPlan);
    setValidationResult(validateMealPlan(nextPlan, activeTargets, candidatePool));
    setCyclesExhausted(
      nextExcluded.length >= CYCLE_EXHAUSTION_LIMIT ||
        candidatePool.fillers.length - nextExcluded.length < 2,
    );
  }

  async function acceptPlan(force = false) {
    if (!currentPlan) return;
    setStatus(null);
    setIsLoading(true);
    try {
      await acceptMealPlanAction(currentPlan);
      setStatus(force ? "Logged with open gaps." : "Logged.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unable to log plan.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-white/10 bg-black/40 p-3 text-white shadow-[0_20px_70px_rgba(0,0,0,0.26)] backdrop-blur-xl">
      <MealPlanAxiomBar
        axioms={axioms}
        disabled={isLoading}
        onChange={setAxioms}
      />

      <BenchmarkStrip targets={activeTargets} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-emerald-300/50 bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          disabled={isLoading}
          onClick={generatePlan}
          type="button"
        >
          {isLoading ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Researching candidates...
            </>
          ) : (
            "Generate plan"
          )}
        </button>

        {IS_DEV ? (
          <div className="flex rounded-full border border-white/10 bg-black/30 p-1">
            {(["success", "failure"] as const).map((scenario) => (
              <button
                className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                  devScenario === scenario
                    ? "bg-white/15 text-white"
                    : "text-white/45"
                }`}
                disabled={isLoading}
                key={scenario}
                onClick={() => setDevScenario(scenario)}
                type="button"
              >
                Mock {scenario}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {status ? (
        <p className="mt-2 text-xs font-semibold text-white/60">{status}</p>
      ) : null}

      {currentPlan && validationResult ? (
        <div className="mt-3">
          <MealPlanCard
            cyclesExhausted={cyclesExhausted}
            disabled={isLoading}
            onAccept={acceptPlan}
            onCycleFiller={cycleFiller}
            onCycleMain={cycleMain}
            plan={currentPlan}
            validationResult={validationResult}
          />
        </div>
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

function buildMockResponse(
  axioms: MealPlanAxioms,
  scenario: DevScenario,
): {
  pool: CandidatePool;
  plan: MealPlan;
  validation: ValidationResult;
} {
  return scenario === "success"
    ? buildSuccessMock(axioms)
    : buildFailureMock(axioms);
}

function buildSuccessMock(axioms: MealPlanAxioms) {
  const chicken = candidate("mock-main-chicken", "main", "Grilled Chicken Bowl", {
    calories: 700,
    proteinG: 50,
    carbsG: 75,
    fiberG: 12,
    fatG: 25,
    sodiumMg: 850,
    addedSugarG: 2,
    saturatedFatG: 4,
  }, "https://www.doordash.com/store/mock-chicken-bowl", "https://example.com/chicken");
  const burrito = candidate("mock-main-burrito", "main", "Steak Burrito Bowl", {
    calories: 930,
    proteinG: 42,
    carbsG: 98,
    fiberG: 10,
    fatG: 36,
    sodiumMg: 1250,
    addedSugarG: 3,
    saturatedFatG: 9,
  }, "https://www.doordash.com/store/mock-burrito", "https://example.com/burrito");
  const yogurt = candidate("mock-filler-yogurt", "filler", "Greek Yogurt", {
    calories: 120,
    proteinG: 20,
    carbsG: 8,
    fiberG: 0,
    fatG: 10,
    sodiumMg: 60,
    addedSugarG: 4,
    saturatedFatG: 0,
  });
  const banana = candidate("mock-filler-banana", "filler", "Banana", {
    calories: 105,
    proteinG: 1,
    carbsG: 27,
    fiberG: 3,
    fatG: 0,
    sodiumMg: 1,
    addedSugarG: 0,
    saturatedFatG: 0,
  });
  const apple = candidate("mock-filler-apple", "filler", "Apple", {
    calories: 95,
    proteinG: 0,
    carbsG: 25,
    fiberG: 4,
    fatG: 0,
    sodiumMg: 1,
    addedSugarG: 0,
    saturatedFatG: 0,
  });
  const pool = poolFrom(axioms, [chicken, burrito], [yogurt, banana, apple]);
  const plan = assembleMealPlan(pool, MOCK_TARGETS) ?? makePlan(chicken, [yogurt, banana]);

  return {
    pool,
    plan,
    validation: validateMealPlan(plan, MOCK_TARGETS, pool),
  };
}

function buildFailureMock(axioms: MealPlanAxioms) {
  const salty = candidate("mock-main-salty", "main", "Salt-Forward Bowl", {
    calories: 1000,
    proteinG: 35,
    carbsG: 100,
    fiberG: 15,
    fatG: 35,
    sodiumMg: 2200,
    addedSugarG: 5,
    saturatedFatG: 5,
  }, "https://www.doordash.com/store/mock-salty", "https://example.com/salty");
  const lower = candidate("mock-main-lower", "main", "Lower Sodium Bowl", {
    calories: 1000,
    proteinG: 70,
    carbsG: 100,
    fiberG: 15,
    fatG: 35,
    sodiumMg: 600,
    addedSugarG: 5,
    saturatedFatG: 5,
  }, "https://www.doordash.com/store/mock-lower", "https://example.com/lower");
  const shake = candidate("mock-filler-shake", "filler", "Protein Shake", {
    calories: 180,
    proteinG: 40,
    carbsG: 6,
    fiberG: 0,
    fatG: 3,
    sodiumMg: 160,
    addedSugarG: 1,
    saturatedFatG: 1,
  });
  const pool = poolFrom(axioms, [salty, lower], [shake]);
  const plan = makePlan(salty, []);

  return {
    pool,
    plan,
    validation: validateMealPlan(plan, MOCK_TARGETS, pool),
  };
}

function poolFrom(
  axioms: MealPlanAxioms,
  mains: MealPlanCandidate[],
  fillers: MealPlanCandidate[],
): CandidatePool {
  return {
    fetchedAt: new Date().toISOString(),
    axioms,
    unfetchedReason: null,
    mains,
    fillers,
  };
}

function candidate(
  id: string,
  kind: MealPlanCandidate["kind"],
  name: string,
  macros: MealPlanMacros,
  doordashUrl: string | null = null,
  sourceUrl: string | null = null,
): MealPlanCandidate {
  return {
    id,
    kind,
    name,
    sourceUrl,
    doordashUrl: kind === "main" ? doordashUrl : null,
    tier: "published",
    macros,
    macroRange: null,
    confidence: "high",
    notes: null,
  };
}

function makePlan(
  main: MealPlanCandidate,
  fillers: MealPlanCandidate[],
): MealPlan {
  return {
    main,
    fillers,
    totals: [main, ...fillers].reduce<MealPlan["totals"]>(
      (totals, item) => ({
        calories: totals.calories + item.macros.calories,
        proteinG: totals.proteinG + item.macros.proteinG,
        carbsG: totals.carbsG + item.macros.carbsG,
        fiberG: totals.fiberG + item.macros.fiberG,
        fatG: totals.fatG + item.macros.fatG,
        sodiumMg: totals.sodiumMg + (item.macros.sodiumMg ?? 0),
        addedSugarG: totals.addedSugarG + (item.macros.addedSugarG ?? 0),
        saturatedFatG:
          totals.saturatedFatG + (item.macros.saturatedFatG ?? 0),
      }),
      {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fiberG: 0,
        fatG: 0,
        sodiumMg: 0,
        addedSugarG: 0,
        saturatedFatG: 0,
      },
    ),
  };
}

function viableMainCount(pool: CandidatePool): number {
  return pool.mains.filter((main) => {
    if (
      pool.axioms.eatOut &&
      pool.axioms.requireDoorDash &&
      !pool.axioms.allowNonDoorDashMain &&
      main.doordashUrl === null
    ) {
      return false;
    }
    if (pool.axioms.carbMode === "low" && main.macros.carbsG > 80) {
      return false;
    }
    return true;
  }).length;
}

function formatMetric(value: number, unit: string): string {
  return `${Math.max(0, Math.round(value)).toLocaleString()} ${unit}`;
}
