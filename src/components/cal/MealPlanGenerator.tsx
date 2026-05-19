"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  acceptMealPlanAction,
  archiveMealPlanPresetAction,
  generateMealPlanAction,
  listMealPlanPresetsAction,
  refitMealPlanPresetAction,
  renameMealPlanPresetAction,
  saveMealPlanPresetAction,
  useMealPlanPresetAction,
} from "@/app/(protected)/cal/mealPlanActions";
import { MealPlanAxiomBar } from "@/components/cal/MealPlanAxiomBar";
import { MealPlanCard } from "@/components/cal/MealPlanCard";
import { assembleMealPlan } from "@/lib/cal/mealPlan/assembler";
import type {
  AssembleOpts,
  CandidatePool,
  MealPlan,
  MealPlanAxioms,
  MealPlanPreset,
  RemainingTargets,
  ValidationResult,
} from "@/lib/cal/mealPlan/types";
import { validateMealPlan } from "@/lib/cal/mealPlan/validator";

type MealPlanGeneratorProps = {
  date: string;
  targets: RemainingTargets;
};

type LoadingState =
  | "generate"
  | "cycleMain"
  | "cycleFiller"
  | "accept"
  | "archivePreset"
  | "refitPreset"
  | "renamePreset"
  | "savePreset"
  | "usePreset"
  | null;

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
  const [presets, setPresets] = useState<MealPlanPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  const disabled = loading !== null;

  useEffect(() => {
    let cancelled = false;

    listMealPlanPresetsAction()
      .then((nextPresets) => {
        if (!cancelled) setPresets(nextPresets);
      })
      .catch(() => {
        if (!cancelled) setPresets([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
      setSelectedPresetId(null);
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
      const result = assembleAndValidateCachedPool(pool, targets, {
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
      const result = assembleAndValidateCachedPool(pool, targets, {
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

  async function savePreset() {
    if (!pool || !plan || !validation) return;
    if (!validation.ok) {
      setError("Only plans that clear every benchmark can be saved as presets.");
      return;
    }

    setLoading("savePreset");
    setError(null);
    try {
      const preset = await saveMealPlanPresetAction({
        axioms,
        pool,
        plan,
        validation,
      });
      setPresets((current) => [
        preset,
        ...current.filter((item) => item.id !== preset.id),
      ].slice(0, 12));
      setSelectedPresetId(preset.id);
      setStatus("Preset saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save preset.");
    } finally {
      setLoading(null);
    }
  }

  async function usePreset(presetId: string) {
    setLoading("usePreset");
    setError(null);
    setStatus(null);
    resetCycleState();

    try {
      const result = await useMealPlanPresetAction(presetId);
      setPresets((current) => [
        result.preset,
        ...current.filter((item) => item.id !== result.preset.id),
      ]);
      setAxioms(result.pool.axioms);
      setPool(result.pool);
      setPlan(result.plan);
      setValidation(result.validation);
      setSelectedPresetId(result.preset.id);
      setCyclesExhausted(false);
      setStatus("Preset loaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load preset.");
    } finally {
      setLoading(null);
    }
  }

  async function refitPreset(presetId: string) {
    setLoading("refitPreset");
    setError(null);
    setStatus(null);
    resetCycleState();

    try {
      const result = await refitMealPlanPresetAction(presetId);
      setPresets((current) => [
        result.preset,
        ...current.filter((item) => item.id !== result.preset.id),
      ]);
      setAxioms(result.pool.axioms);
      setPool(result.pool);
      setPlan(result.plan);
      setValidation(result.validation);
      setSelectedPresetId(result.preset.id);
      setCyclesExhausted(false);
      setStatus("Preset re-fit.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to re-fit preset.");
    } finally {
      setLoading(null);
    }
  }

  async function archivePreset(presetId: string) {
    setLoading("archivePreset");
    setError(null);

    try {
      const result = await archiveMealPlanPresetAction(presetId);
      setPresets((current) =>
        current.filter((preset) => preset.id !== result.id),
      );
      if (selectedPresetId === result.id) setSelectedPresetId(null);
      setStatus("Preset archived.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to archive preset.");
    } finally {
      setLoading(null);
    }
  }

  async function renamePreset(presetId: string, name: string) {
    setLoading("renamePreset");
    setError(null);

    try {
      const preset = await renameMealPlanPresetAction(presetId, name);
      setPresets((current) =>
        current.map((item) => (item.id === preset.id ? preset : item)),
      );
      setStatus("Preset renamed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rename preset.");
      throw err;
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
      <PresetReservoir
        disabled={disabled}
        loading={
          loading === "usePreset" ||
          loading === "refitPreset" ||
          loading === "archivePreset" ||
          loading === "renamePreset"
        }
        onArchive={archivePreset}
        onRefit={refitPreset}
        onRename={renamePreset}
        onUse={usePreset}
        presets={presets}
        selectedPresetId={selectedPresetId}
      />

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
            onSavePreset={validation.ok ? savePreset : undefined}
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

function PresetReservoir({
  disabled,
  loading,
  onArchive,
  onRefit,
  onRename,
  onUse,
  presets,
  selectedPresetId,
}: {
  disabled: boolean;
  loading: boolean;
  onArchive: (presetId: string) => void;
  onRefit: (presetId: string) => void;
  onRename: (presetId: string, name: string) => Promise<void>;
  onUse: (presetId: string) => void;
  presets: MealPlanPreset[];
  selectedPresetId: string | null;
}) {
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  if (presets.length === 0) return null;

  function beginRename(preset: MealPlanPreset) {
    setArchiveConfirmId(null);
    setEditingId(preset.id);
    setDraftName(preset.name);
  }

  async function saveRename(preset: MealPlanPreset) {
    const nextName = draftName.trim().slice(0, 80);
    if (!nextName) return;
    try {
      await onRename(preset.id, nextName);
      setEditingId(null);
      setDraftName("");
    } catch {
      // Parent action surfaces the error; keep edit mode open for correction.
    }
  }

  return (
    <div className="mt-3 rounded-md border border-white/10 bg-black/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
          Presets
        </p>
        <p className="text-[10px] font-semibold text-white/35">
          {loading ? "Loading..." : `${presets.length} saved`}
        </p>
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {presets.map((preset) => {
          const selected = preset.id === selectedPresetId;
          const ageDays = presetAgeDays(preset.createdAt);
          const stale = ageDays >= 30;
          const borderClass = selected
            ? "border-emerald-300/40 bg-emerald-400/10"
            : stale
              ? "border-amber-300/40 bg-amber-300/10 hover:bg-amber-300/15"
              : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]";
          const editing = editingId === preset.id;
          const confirmingArchive = archiveConfirmId === preset.id;

          return (
            <div
              className={`relative min-w-[220px] rounded-md border px-3 py-2 text-left transition ${borderClass} ${
                disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              }`}
              key={preset.id}
              onClick={() => {
                if (!disabled) onUse(preset.id);
              }}
              onKeyDown={(event) => {
                if (
                  !disabled &&
                  !editing &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  onUse(preset.id);
                }
              }}
              role="button"
              tabIndex={disabled ? -1 : 0}
            >
              <button
                className="absolute right-1.5 top-1.5 rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold text-white/40 transition hover:border-amber-300/40 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  setEditingId(null);
                  setArchiveConfirmId(preset.id);
                }}
                type="button"
              >
                x
              </button>

              <div className="pr-7">
                {editing ? (
                  <input
                    autoFocus
                    className="w-full rounded border border-white/15 bg-black/60 px-2 py-1 text-xs font-semibold text-white outline-none focus:border-emerald-300/50"
                    maxLength={80}
                    onChange={(event) => setDraftName(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveRename(preset);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingId(null);
                        setDraftName("");
                      }
                    }}
                    value={draftName}
                  />
                ) : (
                  <button
                    className="max-w-full truncate text-xs font-semibold text-white/80 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      beginRename(preset);
                    }}
                    title="Rename preset"
                    type="button"
                  >
                    {preset.name}
                  </button>
                )}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <p className="text-[10px] font-semibold text-white/40">
                  {presetAgeLabel(ageDays)}
                </p>
                {stale ? (
                  <span className="rounded-full bg-amber-300/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                    30d+
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[10px] font-semibold text-white/45">
                {formatPresetTotals(preset)}
              </p>
              <p className="mt-1 text-[10px] font-semibold text-white/35">
                used {preset.useCount}x
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  className="rounded-md border border-white/15 bg-transparent px-2 py-1 text-[10px] font-semibold text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRefit(preset.id);
                  }}
                  type="button"
                >
                  Re-fit
                </button>
                {confirmingArchive ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-md border border-amber-300/25 bg-amber-300/10 px-2 py-1"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="text-[10px] font-semibold text-amber-100">
                      Archive?
                    </span>
                    <button
                      className="text-[10px] font-semibold text-amber-100 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={disabled}
                      onClick={(event) => {
                        event.stopPropagation();
                        setArchiveConfirmId(null);
                        onArchive(preset.id);
                      }}
                      type="button"
                    >
                      Yes
                    </button>
                    <button
                      className="text-[10px] font-semibold text-white/50 underline-offset-2 hover:text-white hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={disabled}
                      onClick={(event) => {
                        event.stopPropagation();
                        setArchiveConfirmId(null);
                      }}
                      type="button"
                    >
                      Cancel
                    </button>
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
  if (loading === "archivePreset") return "Archiving preset...";
  if (loading === "refitPreset") return "Re-fitting preset...";
  if (loading === "renamePreset") return "Renaming preset...";
  if (loading === "savePreset") return "Saving preset...";
  if (loading === "usePreset") return "Loading preset...";
  return "Logging...";
}

function assembleAndValidateCachedPool(
  pool: CandidatePool,
  targets: RemainingTargets,
  opts: AssembleOpts,
): { plan: MealPlan | null; validation: ValidationResult } {
  const attempts =
    opts.maxFillers === undefined
      ? [opts, { ...opts, maxFillers: 6 }]
      : [opts];
  let bestFailure: { plan: MealPlan; validation: ValidationResult } | null =
    null;

  for (const attempt of attempts) {
    const nextPlan = assembleMealPlan(pool, targets, attempt);
    if (!nextPlan) continue;

    const nextValidation = validateMealPlan(nextPlan, targets, pool);
    if (nextValidation.ok) {
      return { plan: nextPlan, validation: nextValidation };
    }

    const failure = { plan: nextPlan, validation: nextValidation };
    if (
      !bestFailure ||
      isBetterCycleFailure(nextValidation, bestFailure.validation)
    ) {
      bestFailure = failure;
    }
  }

  return (
    bestFailure ?? {
      plan: null,
      validation: syntheticCycleFailure("Pool exhausted - Generate plan to refresh."),
    }
  );
}

function isBetterCycleFailure(
  candidate: ValidationResult,
  incumbent: ValidationResult,
): boolean {
  if (candidate.ok) return true;
  if (incumbent.ok) return false;

  if (candidate.gaps.length !== incumbent.gaps.length) {
    return candidate.gaps.length < incumbent.gaps.length;
  }

  return gapScore(candidate) < gapScore(incumbent);
}

function gapScore(validation: ValidationResult): number {
  if (validation.ok) return 0;
  return validation.gaps.reduce(
    (score, gap) => score + Math.abs(gap.deltaPct),
    0,
  );
}

function syntheticCycleFailure(remediation: string): ValidationResult {
  return {
    ok: false,
    bestAttempt: null,
    gaps: [
      {
        metric: "calories",
        target: 0,
        actual: 0,
        deltaPct: 0,
        direction: "short",
        remediation,
      },
    ],
  };
}

function formatMetric(value: number, unit: string): string {
  return `${Math.max(0, Math.round(value)).toLocaleString()} ${unit}`;
}

function formatPresetTotals(preset: MealPlanPreset): string {
  return `${preset.totals.calories} cal | ${preset.totals.proteinG}p | ${preset.totals.carbsG}c`;
}

function presetAgeDays(createdAt: string): number {
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return 0;
  const elapsedMs = Date.now() - createdMs;
  return Math.max(0, Math.floor(elapsedMs / 86_400_000));
}

function presetAgeLabel(ageDays: number): string {
  if (ageDays <= 0) return "saved today";
  if (ageDays === 1) return "saved 1d ago";
  return `saved ${ageDays}d ago`;
}
