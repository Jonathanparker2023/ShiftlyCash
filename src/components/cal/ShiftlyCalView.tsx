"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";

import { AiFoodEstimator } from "@/components/cal/AiFoodEstimator";
import {
  FocusedDayCoachStrip,
  WeeklyCoachBand,
} from "@/components/cal/CoachReviewBand";
import { PasteAndLogButton } from "@/components/cal/PasteAndLogButton";
import { PlanMyDayButton } from "@/components/cal/PlanMyDayButton";
import {
  archiveSavedFoodAction,
  createFoodEntryAction,
  createSavedFoodAction,
  deleteFoodEntryAction,
  logWaterAction,
  logWeightAction,
  overrideVerdictAction,
  regenerateVerdictAction,
  updateFoodEntryAction,
} from "@/app/(protected)/cal/actions";
import {
  categoryLabel,
  magnitudeColorClass,
  verdictBarClass,
} from "@/lib/cal/color";
import {
  type MagnitudeTone,
} from "@/lib/cal/projection";
import { addDaysIso } from "@/lib/dashboard/dates";
import type {
  CalDay,
  CalTargets,
  CalTotals,
  FoodCategory,
  FoodEntry,
  FoodVerdict,
  SavedFood,
  ShiftlyCalData,
} from "@/lib/cal/types";

type UpdateFoodEntryPatch = {
  mealName?: string | null;
  category?: FoodCategory | string | null;
  loggedTime?: string | null;
  calories: number | string;
  proteinG?: number | string | null;
  carbsG?: number | string | null;
  fatG?: number | string | null;
  fiberG?: number | string | null;
  sodiumMg?: number | string | null;
  addedSugarG?: number | string | null;
  saturatedFatG?: number | string | null;
};

type InitialCoachReview = {
  body: string;
  suggestionKind: string | null;
  suggestionText: string | null;
};

const FOOD_CATEGORY_OPTIONS: Array<{ value: FoodCategory; label: string }> = [
  { value: "meal", label: "Meal" },
  { value: "healthy_snack", label: "Healthy snack" },
  { value: "unhealthy_snack", label: "Unhealthy snack" },
  { value: "drink", label: "Drink" },
  { value: "other", label: "Other" },
];

export function ShiftlyCalView({
  initialData,
  initialDayReview = null,
  initialWeekReview = null,
  weekStartIso,
}: {
  initialData: ShiftlyCalData;
  initialDayReview?: InitialCoachReview | null;
  initialWeekReview?: InitialCoachReview | null;
  weekStartIso: string;
}) {
  const router = useRouter();
  const todayIndex = Math.max(
    0,
    initialData.currentWeek.days.findIndex(
      (day) => day.date === initialData.todayIso,
    ),
  );
  const [focusedDayIndex, setFocusedDayIndex] = useState(todayIndex);
  const [weightValue, setWeightValue] = useState(
    initialData.currentWeek.days[todayIndex]?.weight?.weightLbs.toString() ?? "",
  );
  const [loggedFoodId, setLoggedFoodId] = useState<string | null>(null);
  const [pendingScrollEntryId, setPendingScrollEntryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();
  const focusedDay =
    initialData.currentWeek.days[focusedDayIndex] ?? initialData.currentWeek.days[0];
  const prevWeekIso = addDaysIso(weekStartIso, -7);
  const nextWeekIso = addDaysIso(weekStartIso, 7);
  const isCurrentWeek = initialData.currentWeek.days.some(
    (day) => day.date === initialData.todayIso,
  );
  const hasRecentPendingVerdicts = useMemo(
    () =>
      focusedDay.entries.some(
        (entry) =>
          entry.verdictSource === "pending" &&
          nowMs - new Date(entry.updatedAt).getTime() < 60_000,
    ),
    [focusedDay.entries, nowMs],
  );
  const planDay = useMemo(
    () =>
      initialData.currentWeek.days.find(
        (day) => day.date === initialData.todayIso,
      ) ?? focusedDay,
    [focusedDay, initialData.currentWeek.days, initialData.todayIso],
  );

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!hasRecentPendingVerdicts) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, 4000);
    return () => window.clearInterval(id);
  }, [hasRecentPendingVerdicts, router]);

  useEffect(() => {
    if (!pendingScrollEntryId) return;
    const hasEntry = focusedDay.entries.some(
      (entry) => entry.id === pendingScrollEntryId,
    );
    if (!hasEntry) return;

    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-food-entry-id="${pendingScrollEntryId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      setPendingScrollEntryId(null);
    });
  }, [focusedDay.entries, pendingScrollEntryId]);

  // Coach-review signatures. Re-fetch when the underlying data
  // composition shifts. Cheap to recompute, cheap to send up to the
  // server actions (which dedup via observation hash anyway).
  const focusedDaySignature = useMemo(() => {
    const ids = focusedDay.entries
      .map((entry) => `${entry.id}:${entry.verdict ?? "_"}`)
      .sort()
      .join("|");
    return `${focusedDay.totals.calories}|${focusedDay.totals.sodiumMg}|${ids}`;
  }, [focusedDay.entries, focusedDay.totals]);

  const weekSignature = useMemo(() => {
    const dayKeys = initialData.currentWeek.days
      .map((day) => `${day.date}:${day.entries.length}:${day.totals.calories}`)
      .join("|");
    return dayKeys;
  }, [initialData.currentWeek.days]);

  function instantLog(food: SavedFood) {
    setError(null);
    startTransition(async () => {
      try {
        await createFoodEntryAction({
          date: focusedDay.date,
          loggedTime: currentTimeInput(),
          mealName: food.name,
          category: food.category,
          calories: food.calories.toString(),
          proteinG: food.proteinG?.toString() ?? "",
          carbsG: food.carbsG?.toString() ?? "",
          fatG: food.fatG?.toString() ?? "",
          fiberG: food.fiberG?.toString() ?? "",
          sodiumMg: food.sodiumMg?.toString() ?? "",
          addedSugarG: food.addedSugarG?.toString() ?? "",
          saturatedFatG: food.saturatedFatG?.toString() ?? "",
          savedFoodId: food.id,
        });
        setLoggedFoodId(food.id);
        window.setTimeout(() => setLoggedFoodId(null), 1500);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to log.");
      }
    });
  }

  function logFromEstimate(input: {
    mealName: string;
    category: FoodCategory;
    loggedTime: string;
    calories: string;
    proteinG: string;
    carbsG: string;
    fatG: string;
    fiberG: string;
    sodiumMg: string;
    addedSugarG: string;
    saturatedFatG: string;
  }) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createFoodEntryAction({
          date: focusedDay.date,
          loggedTime: input.loggedTime,
          mealName: input.mealName,
          category: input.category,
          calories: input.calories,
          proteinG: input.proteinG,
          carbsG: input.carbsG,
          fatG: input.fatG,
          fiberG: input.fiberG,
          sodiumMg: input.sodiumMg,
          addedSugarG: input.addedSugarG,
          saturatedFatG: input.saturatedFatG,
          savedFoodId: null,
        });
        setPendingScrollEntryId(result.id);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Unable to log estimated food.",
        );
      }
    });
  }

  function submitWeight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        await logWeightAction({
          date: focusedDay.date,
          weightLbs: weightValue,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to log weight.");
      }
    });
  }

  function deleteEntry(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await deleteFoodEntryAction({ id });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to delete entry.");
      }
    });
  }

  async function saveEntryAsTemplate(entry: FoodEntry): Promise<boolean> {
    setError(null);
    try {
      await createSavedFoodAction({
        name: entry.mealName || categoryLabel(entry.category),
        category: entry.category,
        calories: entry.calories,
        proteinG: entry.proteinG ?? "",
        carbsG: entry.carbsG ?? "",
        fatG: entry.fatG ?? "",
        fiberG: entry.fiberG ?? "",
        sodiumMg: entry.sodiumMg ?? "",
        addedSugarG: entry.addedSugarG ?? "",
        saturatedFatG: entry.saturatedFatG ?? "",
      });
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save food.");
      return false;
    }
  }

  function deleteSavedFood(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await archiveSavedFoodAction({ id });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to delete saved food.");
      }
    });
  }

  async function updateEntry(id: string, patch: UpdateFoodEntryPatch): Promise<boolean> {
    setError(null);
    try {
      await updateFoodEntryAction({ id, ...patch });
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update entry.");
      return false;
    }
  }

  function logWater(amountOz: number) {
    setError(null);
    startTransition(async () => {
      try {
        await logWaterAction({ date: focusedDay.date, amountOz });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to log water.");
      }
    });
  }

  async function regenerateVerdict(id: string): Promise<boolean> {
    setError(null);
    try {
      await regenerateVerdictAction({ id });
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to regenerate verdict.");
      return false;
    }
  }

  async function overrideVerdict(
    id: string,
    verdict: FoodVerdict,
    verdictReason: string,
  ): Promise<boolean> {
    setError(null);
    try {
      await overrideVerdictAction({ id, verdict, verdictReason });
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to override verdict.");
      return false;
    }
  }

  function focusDay(index: number) {
    setFocusedDayIndex(index);
    setWeightValue(
      initialData.currentWeek.days[index]?.weight?.weightLbs.toString() ?? "",
    );
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
        <div className="h-2 bg-[var(--surface-elevated)]" />
        <div className="p-3 sm:p-4">
          <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(520px,1.05fr)] lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                ShiftlyCal
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Link
                  className="rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--surface-hover)]"
                  href={`/cal?week=${prevWeekIso}`}
                >
                  Prev
                </Link>
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] drop-shadow-sm sm:text-3xl">
                  {formatWeekRange(
                    initialData.currentWeek.weekStartIso,
                    initialData.currentWeek.weekEndIso,
                  )}
                </h2>
                {isCurrentWeek ? (
                  <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-1 text-sm font-semibold text-[var(--text-muted)]">
                    Next
                  </span>
                ) : (
                  <Link
                    className="rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--surface-hover)]"
                    href={`/cal?week=${nextWeekIso}`}
                  >
                    Next
                  </Link>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <p className="inline-flex rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)] shadow-sm">
                  Energy balance tracker
                </p>
                <Link
                  className="inline-flex rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--surface-hover)]"
                  href={`/cal/trends?week=${weekStartIso}`}
                >
                  Trends
                </Link>
              </div>
            </div>
            <MetricStrip
              projection={initialData.projection}
              targets={initialData.targets}
            />
          </div>

          <WeeklyCoachBand
            initialBody={initialWeekReview?.body ?? null}
            key={weekSignature}
            weekStartIso={weekStartIso}
            weekEntriesSignature={weekSignature}
          />

          <div className="mt-4 pb-2">
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {initialData.currentWeek.days.map((day, index) => (
                <WeekStripCell
                  day={day}
                  isFocused={index === focusedDayIndex}
                  key={day.date}
                  onClick={() => focusDay(index)}
                />
              ))}
            </div>
          </div>

          {error ? (
            <p className="mt-4 rounded-md border border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] px-3 py-2 text-sm font-medium text-[var(--accent-negative-text)]">
              {error}
            </p>
          ) : null}

          <section className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
            {/* Mobile-only quick log bar — first thing the user sees under
                the calendar. Big Log food button + a discreet collapsed
                dropdown for saved foods (presets). The big SavedFoodsList
                card is hidden on mobile and only the dropdown shows. xl
                gets the full desktop layout below. */}
            <div className="mb-4 space-y-2 xl:hidden">
              <AiFoodEstimator
                disabled={isPending}
                onConfirm={logFromEstimate}
              />
              <MobileSavedFoodsDropdown
                disabled={isPending}
                loggedFoodId={loggedFoodId}
                onDelete={deleteSavedFood}
                onInstantLog={instantLog}
                savedFoods={initialData.savedFoods}
              />
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.08fr)_minmax(260px,0.72fr)]">
              {/* Left column. On mobile this stacks LAST so the planning
                  handoff and weight panel are
                  at the bottom of the view, below the focused day and
                  today's entries. xl restores natural column position. */}
              <div className="order-last space-y-4 xl:order-none">
                <div className="hidden xl:block">
                  <SavedFoodsList
                    disabled={isPending}
                    loggedFoodId={loggedFoodId}
                    onDelete={deleteSavedFood}
                    onInstantLog={instantLog}
                    savedFoods={initialData.savedFoods}
                  />
                </div>
                <PlanMyDayButton
                  bannedFoods={initialData.targets.bannedFoods}
                  targets={initialData.targets}
                  totals={planDay.totals}
                />
                <PasteAndLogButton
                  date={focusedDay.date}
                  disabled={isPending}
                  onLogged={() => router.refresh()}
                />
                <WeightPanel
                  day={focusedDay}
                  disabled={isPending}
                  onSubmit={submitWeight}
                  setWeightValue={setWeightValue}
                  todayIso={initialData.todayIso}
                  weightValue={weightValue}
                />
              </div>

              <div>
                <FocusedDayHeader
                  day={focusedDay}
                  dayTotals={focusedDay.totals}
                  targets={initialData.targets}
                />
                <FocusedDayCoachStrip
                  key={`${focusedDay.date}:${focusedDaySignature}`}
                  focusedDate={focusedDay.date}
                  daySignature={focusedDaySignature}
                  initialBody={
                    focusedDay.date === initialData.todayIso
                      ? initialDayReview?.body ?? null
                      : null
                  }
                />
                <div className="mt-4 space-y-3 hidden xl:block">
                  <AiFoodEstimator
                    disabled={isPending}
                    onConfirm={logFromEstimate}
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {focusedDay.entries.length > 0 ? (
                    focusedDay.entries.map((entry) => (
                      <div data-food-entry-id={entry.id} key={entry.id}>
                        <FoodEntryRow
                          disabled={isPending}
                          entry={entry}
                          nowMs={nowMs}
                          onDelete={deleteEntry}
                          onOverrideVerdict={overrideVerdict}
                          onRegenerateVerdict={regenerateVerdict}
                          onSaveAsTemplate={saveEntryAsTemplate}
                          onUpdate={updateEntry}
                        />
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] p-6 text-center text-sm text-[var(--text-secondary)]">
                      No food logged for this day.
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <DayTotalsPanel
                  day={focusedDay}
                  targets={initialData.targets}
                />
                <WaterPanel
                  day={focusedDay}
                  disabled={isPending}
                  onLog={logWater}
                  targetOz={initialData.targets.waterTargetOz}
                />
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function MetricStrip({
  projection,
  targets,
}: {
  projection: ShiftlyCalData["projection"];
  targets: CalTargets;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <TopMetric
        label="Weekly delta"
        note={targets.tdeeCalories === null ? "Set TDEE for projections." : null}
        value={
          targets.tdeeCalories === null
            ? "--"
            : formatSignedCalories(projection.weeklyDeficitCalories)
        }
      />
      <TopMetric
        label="Estimated weight change"
        note={targets.tdeeCalories === null ? "Estimate locked." : null}
        value={
          targets.tdeeCalories === null
            ? "--"
            : `${formatSignedNumber(projection.projectedWeightDeltaLbs, 2)} lbs`
        }
      />
    </div>
  );
}

function TopMetric({
  accent,
  label,
  note,
  tone = "neutral",
  value,
}: {
  accent?: "green" | "blue" | "amber" | "negative";
  label: string;
  note?: string | null;
  tone?: MagnitudeTone;
  value: string;
}) {
  const accentClass =
    accent === "green"
      ? "before:bg-[var(--accent-primary)]"
      : accent === "blue"
        ? "before:bg-[var(--accent-primary)]"
        : accent === "amber"
          ? "before:bg-[var(--accent-warning)]"
          : accent === "negative"
            ? "before:bg-[var(--accent-negative)]"
            : "before:bg-[var(--border-strong)]";

  return (
    <div
      className={`relative overflow-hidden rounded-md border-2 border-[var(--border-strong)] bg-[var(--surface-elevated)] px-2.5 py-3 text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_24px_rgba(8,15,28,0.12)] before:absolute before:inset-x-0 before:top-0 before:h-1 sm:px-4 ${accentClass}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        {label}
      </p>
      <p className={`mt-1 text-3xl font-bold tracking-tight ${magnitudeColorClass(tone)}`}>
        {value}
      </p>
      {note ? <p className="mt-2 text-xs text-[var(--text-tertiary)]">{note}</p> : null}
    </div>
  );
}

function WeekStripCell({
  day,
  isFocused,
  onClick,
}: {
  day: CalDay;
  isFocused: boolean;
  onClick: () => void;
}) {
  const verdict = day.dayVerdict?.verdict ?? null;
  const date = new Date(`${day.date}T00:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(date);

  const toneBorder =
    verdict === "good"
      ? "border-[var(--accent-primary-border)]"
      : verdict === "bad"
        ? "border-[var(--accent-negative-border)]"
        : "border-[var(--border-strong)]";
  const toneBorderFocused =
    verdict === "good"
      ? "border-[var(--accent-primary-border)]"
      : verdict === "bad"
        ? "border-[var(--accent-negative-border)]"
        : "border-[var(--border-strong)]";
  const toneBg =
    verdict === "good"
      ? "bg-[var(--accent-primary-fill)]"
      : verdict === "bad"
        ? "bg-[var(--accent-negative-fill)]"
        : "bg-[var(--surface-elevated)]";
  const toneGlow =
    verdict === "good"
      ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
      : verdict === "bad"
        ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
        : "shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]";
  const toneGlowFocused =
    verdict === "good"
      ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]"
      : verdict === "bad"
        ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]"
        : "shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]";
  const calorieTextClass =
    verdict === "good"
      ? "text-[var(--accent-primary-text)]"
      : verdict === "bad"
        ? "text-[var(--accent-negative-text)]"
        : "text-[var(--text-secondary)]";
  const hasEntries = day.entries.length > 0;
  const selectedStyle = isFocused
    ? {
        borderColor: "var(--accent-primary)",
        boxShadow:
          "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 1px var(--accent-primary), 0 0 24px -6px rgba(10, 129, 86, 0.45)",
      }
    : undefined;
  const hoverGlowClass =
    !isFocused && hasEntries
      ? "hover:border-[var(--border-default)] hover:shadow-[0_0_16px_-6px_rgba(10,129,86,0.30)]"
      : "";

  return (
    <button
      className={`min-w-0 rounded-md px-1.5 py-2 text-left text-[var(--text-primary)] transition-colors duration-150 focus:outline-none sm:p-3 ${
        isFocused
          ? `border-[3px] ${toneBorderFocused} ${toneBg} ${toneGlowFocused}`
          : `border-2 ${toneBorder} ${toneBg} ${toneGlow} ${hoverGlowClass}`
      }`}
      onClick={onClick}
      style={selectedStyle}
      type="button"
    >
      <p className="whitespace-nowrap text-[8px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)] sm:text-[10px] sm:tracking-[0.14em]">
        {weekday}
      </p>
      <p className="mt-1 text-base font-semibold text-[var(--text-primary)] sm:text-lg">
        {date.getUTCDate()}
      </p>
      <p
        className={`mt-2 truncate text-xs font-semibold sm:mt-4 sm:text-sm ${calorieTextClass}`}
      >
        {day.totals.calories.toLocaleString()}
      </p>
    </button>
  );
}

function FocusedDayHeader({
  day,
  dayTotals,
  targets,
}: {
  day: CalDay;
  dayTotals: CalTotals;
  targets: CalTargets;
}) {
  const date = new Date(`${day.date}T00:00:00.000Z`);
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  const remaining =
    targets.tdeeCalories === null ? null : targets.tdeeCalories - dayTotals.calories;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          Focused day
        </p>
        <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{label}</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-1 text-sm font-semibold text-[var(--text-secondary)]">
          {day.entries.length} entries
        </span>
        {remaining !== null ? <RemainingBadge remaining={remaining} /> : null}
      </div>
    </div>
  );
}

function RemainingBadge({ remaining }: { remaining: number }) {
  if (remaining > 0) {
    return (
      <span className="rounded-full border border-[var(--accent-primary-border)] bg-[var(--surface-elevated)] px-3 py-1 text-sm font-semibold text-[var(--accent-primary-text)]">
        {remaining.toLocaleString()} cal left
      </span>
    );
  }

  if (remaining < 0) {
    return (
      <span className="rounded-full border border-[var(--accent-negative-border)] bg-[var(--surface-elevated)] px-3 py-1 text-sm font-semibold text-[var(--accent-negative-text)]">
        {Math.abs(remaining).toLocaleString()} cal over
      </span>
    );
  }

  return (
    <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-sm font-semibold text-[var(--text-primary)]">
      Right on target
    </span>
  );
}

function FoodEntryRow({
  disabled,
  entry,
  nowMs,
  onDelete,
  onOverrideVerdict,
  onRegenerateVerdict,
  onSaveAsTemplate,
  onUpdate,
}: {
  disabled: boolean;
  entry: FoodEntry;
  nowMs: number;
  onDelete: (id: string) => void;
  onOverrideVerdict: (
    id: string,
    verdict: FoodVerdict,
    verdictReason: string,
  ) => Promise<boolean>;
  onRegenerateVerdict: (id: string) => Promise<boolean>;
  onSaveAsTemplate: (entry: FoodEntry) => Promise<boolean>;
  onUpdate: (id: string, patch: UpdateFoodEntryPatch) => Promise<boolean>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTemplating, setIsTemplating] = useState(false);
  const [templateStatus, setTemplateStatus] = useState<"idle" | "saved">("idle");

  async function saveAsTemplate() {
    setIsTemplating(true);
    const ok = await onSaveAsTemplate(entry);
    setIsTemplating(false);
    if (ok) {
      setTemplateStatus("saved");
      window.setTimeout(() => setTemplateStatus("idle"), 2000);
    }
  }
  const [isVerdictSaving, setIsVerdictSaving] = useState(false);
  const [overrideValue, setOverrideValue] = useState<FoodVerdict>(
    entry.verdict ?? "bad",
  );
  const [overrideReason, setOverrideReason] = useState(entry.verdictReason ?? "");
  const [editForm, setEditForm] = useState({
    mealName: entry.mealName,
    category: entry.category,
    loggedTime: entry.loggedTime ?? currentTimeInput(),
    calories: entry.calories.toString(),
    proteinG: entry.proteinG?.toString() ?? "",
    carbsG: entry.carbsG?.toString() ?? "",
    fatG: entry.fatG?.toString() ?? "",
    fiberG: entry.fiberG?.toString() ?? "",
    sodiumMg: entry.sodiumMg?.toString() ?? "",
    addedSugarG: entry.addedSugarG?.toString() ?? "",
    saturatedFatG: entry.saturatedFatG?.toString() ?? "",
  });

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    const ok = await onUpdate(entry.id, editForm);
    setIsSaving(false);
    if (ok) setIsEditing(false);
  }

  async function submitOverride() {
    setIsVerdictSaving(true);
    const ok = await onOverrideVerdict(entry.id, overrideValue, overrideReason);
    setIsVerdictSaving(false);
    if (ok) setIsEditing(false);
  }

  async function regenerateVerdict() {
    setIsVerdictSaving(true);
    const ok = await onRegenerateVerdict(entry.id);
    setIsVerdictSaving(false);
    if (ok) setIsEditing(false);
  }

  const title = entry.mealName || categoryLabel(entry.category);
  const verdictStatus = verdictStatusText(entry);
  const isStuck =
    entry.verdictSource === "pending" &&
    nowMs - new Date(entry.updatedAt).getTime() > 60_000;
  const rowClass = isStuck
    ? "rounded-md border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3 text-sm text-[var(--text-primary)]"
    : verdictBarClass(entry);

  if (isEditing) {
    return (
      <form className={rowClass} onSubmit={submitEdit}>
        <button
          className="mb-3 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3 text-left transition hover:bg-[var(--surface-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
          onClick={() => setIsEditing(false)}
          type="button"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm italic text-[var(--text-secondary)]">
              {entry.verdictReason
                ? `${entry.verdictReason}${
                    entry.verdictSource === "manual_override" ? " (your override)" : ""
                  }`
                : verdictStatus}
            </p>
            <span aria-hidden="true" className="shrink-0 text-xs text-[var(--text-tertiary)]">
              tap to close
            </span>
          </div>
          {entry.verdictSource === "unscored" && entry.verdictError ? (
            <p className="mt-2 rounded-md border border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] px-2 py-1 text-xs font-semibold text-[var(--accent-negative-text)]">
              Scoring failed: {entry.verdictError}
            </p>
          ) : null}
          <span className="mt-2 inline-flex rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-0.5 text-xs font-semibold text-[var(--text-tertiary)]">
            {categoryLabel(entry.category)}
          </span>
        </button>
        <div className="grid gap-2 sm:grid-cols-2">
          <TextInput
            label="Meal"
            onChange={(value) => setEditForm({ ...editForm, mealName: value })}
            value={editForm.mealName}
          />
          <CategorySelect
            label="Category"
            onChange={(category) => setEditForm({ ...editForm, category })}
            value={editForm.category}
          />
          <TextInput
            label="Time"
            onChange={(value) => setEditForm({ ...editForm, loggedTime: value })}
            type="time"
            value={editForm.loggedTime}
          />
          <NumberInput
            label="Calories"
            onChange={(value) => setEditForm({ ...editForm, calories: value })}
            required
            value={editForm.calories}
          />
          <NumberInput
            label="Protein"
            onChange={(value) => setEditForm({ ...editForm, proteinG: value })}
            suffix="g"
            value={editForm.proteinG}
          />
          <NumberInput
            label="Carbs"
            onChange={(value) => setEditForm({ ...editForm, carbsG: value })}
            suffix="g"
            value={editForm.carbsG}
          />
          <NumberInput
            label="Fat"
            onChange={(value) => setEditForm({ ...editForm, fatG: value })}
            suffix="g"
            value={editForm.fatG}
          />
          <NumberInput
            label="Fiber"
            onChange={(value) => setEditForm({ ...editForm, fiberG: value })}
            suffix="g"
            value={editForm.fiberG}
          />
          <NumberInput
            label="Sodium"
            onChange={(value) => setEditForm({ ...editForm, sodiumMg: value })}
            suffix="mg"
            value={editForm.sodiumMg}
          />
          <NumberInput
            label="Added sugar"
            onChange={(value) => setEditForm({ ...editForm, addedSugarG: value })}
            suffix="g"
            value={editForm.addedSugarG}
          />
          <NumberInput
            label="Sat fat"
            onChange={(value) => setEditForm({ ...editForm, saturatedFatG: value })}
            suffix="g"
            value={editForm.saturatedFatG}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="rounded border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || isSaving || !editForm.calories.trim()}
            type="submit"
          >
            Save
          </button>
          <button
            className="rounded border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || isSaving}
            onClick={() => setIsEditing(false)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || isSaving || isVerdictSaving}
            onClick={regenerateVerdict}
            type="button"
          >
            Regenerate verdict
          </button>
        </div>
        <div className="mt-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3">
          <p className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">
            Lock verdict override
          </p>
          <div className="grid gap-2 sm:grid-cols-[120px_1fr_auto]">
            <select
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              disabled={disabled || isVerdictSaving}
              onChange={(event) => setOverrideValue(event.target.value as FoodVerdict)}
              value={overrideValue}
            >
              <option value="good">Good</option>
              <option value="bad">Bad</option>
            </select>
            <input
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              disabled={disabled || isVerdictSaving}
              onChange={(event) => setOverrideReason(event.target.value)}
              placeholder="Reason"
              value={overrideReason}
            />
            <button
              className="rounded border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled || isVerdictSaving}
              onClick={submitOverride}
              type="button"
            >
              Lock override
            </button>
          </div>
        </div>
        <div className="mt-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3">
          <p className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">
            Forgot something?
          </p>
          <AiFoodEstimator
            buttonLabel="AI add food"
            confirmLabel="Add to entry"
            disabled={disabled || isSaving}
            onConfirm={(addition) =>
              setEditForm((current) => mergeEstimateIntoEntry(current, addition))
            }
          />
        </div>
      </form>
    );
  }

  if (!isExpanded) {
    return (
      <button
        className={`${rowClass} flex w-full items-center justify-between gap-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]`}
        onClick={() => setIsExpanded(true)}
        type="button"
      >
        <span className="min-w-0 truncate font-semibold">{title}</span>
        {entry.isProjectedPlan ? (
          <span className="shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            Plan
          </span>
        ) : null}
        {entry.verdictSource === "manual_override" ? (
          <span className="shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            Override
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-right font-semibold opacity-90">
          {entry.calories.toLocaleString()} cal
        </span>
        {isStuck ? (
          <span className="shrink-0 rounded border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-1 text-xs font-semibold text-[var(--text-primary)]">
            Scoring stuck - retry
          </span>
        ) : null}
        <span aria-hidden="true" className="shrink-0 text-xs opacity-70">
          &gt;
        </span>
      </button>
    );
  }

  return (
    <div className={`${rowClass} transition-colors`}>
      <button
        className="flex w-full items-center justify-between gap-3 text-left focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
        onClick={() => setIsExpanded(false)}
        type="button"
        aria-label={`Collapse ${title}`}
      >
        <span className="min-w-0 truncate font-semibold">{title}</span>
        {entry.isProjectedPlan ? (
          <span className="shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            Plan
          </span>
        ) : null}
        <span className="text-right font-semibold opacity-90">
          {entry.calories.toLocaleString()} cal
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs opacity-70">
          ^
        </span>
      </button>
      <div className="mt-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] p-2 text-xs text-[var(--text-secondary)]">
        <p className="line-clamp-2 italic">{entry.verdictReason ?? verdictStatus}</p>
        {entry.verdictSource === "unscored" && entry.verdictError ? (
          <p className="mt-2 rounded-md border border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] px-2 py-1 font-semibold text-[var(--accent-negative-text)]">
            Scoring failed: {entry.verdictError}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-0.5 font-semibold text-[var(--text-secondary)]">
            {categoryLabel(entry.category)}
          </span>
          {entry.isProjectedPlan ? (
            <span className="rounded-full border border-[var(--accent-primary-border)] bg-[var(--accent-primary-fill)] px-2 py-0.5 font-semibold text-[var(--accent-primary-text)]">
              Projected plan
            </span>
          ) : null}
          {entry.verdictSource === "manual_override" ? (
            <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-0.5 font-semibold text-[var(--text-secondary)]">
              Override
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs opacity-85 transition-colors">
        <span>{formatMacrosInline(entry) || "No macros logged"}</span>
        <div className="flex items-center gap-2">
          <button
            className="rounded px-1 py-0.5 font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
            onClick={() => setIsExpanded(false)}
            type="button"
          >
            Close
          </button>
          {entry.verdictSource === "unscored" || isStuck ? (
            <button
              className="rounded border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-1 font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled || isVerdictSaving}
              onClick={regenerateVerdict}
              type="button"
            >
              {isStuck ? "Scoring stuck - retry" : "Retry scoring"}
            </button>
          ) : null}
          <button
            className="rounded px-1 py-0.5 font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              setIsEditing(true);
            }}
            type="button"
          >
            Edit
          </button>
          <button
            className="rounded px-1 py-0.5 font-semibold text-[var(--accent-primary-text)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || isTemplating}
            onClick={(event) => {
              event.stopPropagation();
              void saveAsTemplate();
            }}
            type="button"
          >
            {templateStatus === "saved" ? "Saved" : isTemplating ? "Saving..." : "Save"}
          </button>
          <button
            className="rounded px-1 py-0.5 font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              if (window.confirm(`Delete "${entry.mealName || categoryLabel(entry.category)}"?`)) {
                onDelete(entry.id);
              }
            }}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function DayTotalsPanel({
  day,
  targets,
}: {
  day: CalDay;
  targets: CalTargets;
}) {
  const secondaryMetrics: DayMetricConfig[] = [
    {
      kind: "goal",
      label: "Protein",
      target: targets.proteinTargetG,
      unit: "g",
      value: day.totals.proteinG,
    },
    {
      kind: "limit",
      label: "Carbs",
      target: targets.carbsTargetG,
      unit: "g",
      value: day.totals.carbsG,
    },
    {
      kind: "limit",
      label: "Fat",
      target: targets.fatTargetG,
      unit: "g",
      value: day.totals.fatG,
    },
    {
      kind: "goal",
      label: "Fiber",
      target: targets.fiberTargetG,
      unit: "g",
      value: day.totals.fiberG,
    },
    {
      kind: "limit",
      label: "Sodium",
      target: targets.sodiumTargetMg,
      unit: "mg",
      value: day.totals.sodiumMg,
    },
    {
      kind: "limit",
      label: "Added sugar",
      target: targets.addedSugarTargetG,
      unit: "g",
      value: day.totals.addedSugarG,
    },
    {
      kind: "limit",
      label: "Sat fat",
      target: targets.saturatedFatTargetG,
      unit: "g",
      value: day.totals.saturatedFatG,
    },
  ];

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        Day totals
      </p>
      <div className="mt-3 space-y-3">
        <DayTotalHero
          kind="limit"
          label="Calories"
          target={targets.tdeeCalories}
          unit="cal"
          value={day.totals.calories}
        />
        <div className="grid grid-cols-2 gap-2">
          {secondaryMetrics.map((metric) => (
            <DayTotalMetric key={metric.label} {...metric} />
          ))}
        </div>
      </div>
    </div>
  );
}

type MetricKind = "limit" | "goal";

type DayMetricConfig = {
  kind: MetricKind;
  label: string;
  target: number | null;
  unit: string;
  value: number;
};

function DayTotalHero({
  kind,
  label,
  target,
  unit,
  value,
}: DayMetricConfig) {
  const state = metricState(value, target, kind, unit);
  const fillClass = metricFillClass(state.tone);
  const textClass = metricTextClass(state.tone);

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          {label}
        </p>
        <p className={`text-3xl font-bold tracking-tight ${textClass}`}>
          {formatTargetProgress(value, target, unit)}
        </p>
      </div>
      {target !== null ? (
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]">
          <div
            className={`h-2.5 rounded-full transition-colors ${fillClass}`}
            style={{ width: `${state.barPct}%` }}
          />
        </div>
      ) : null}
      <p className={`mt-2 text-sm font-semibold ${textClass}`}>
        {state.note}
      </p>
    </div>
  );
}

function DayTotalMetric({
  kind,
  label,
  target,
  unit,
  value,
}: DayMetricConfig) {
  const state = metricState(value, target, kind, unit);
  const fillClass = metricFillClass(state.tone);
  const textClass = metricTextClass(state.tone);
  const shouldStackValue = unit === "mg" && target !== null;

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">{label}</p>
        {shouldStackValue ? (
          <p className={`text-right font-bold leading-none tracking-tight ${textClass}`}>
            <span className="block text-base">{value.toLocaleString()}</span>
            <span className="mt-1 block text-[10px] font-semibold leading-none text-[var(--text-tertiary)]">
              /{target.toLocaleString()} {unit}
            </span>
          </p>
        ) : (
          <p className={`text-lg font-bold tracking-tight ${textClass}`}>
            {formatTargetProgress(value, target, unit)}
          </p>
        )}
      </div>
      {target !== null ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]">
          <div
            className={`h-1.5 rounded-full transition-colors ${fillClass}`}
            style={{ width: `${state.barPct}%` }}
          />
        </div>
      ) : null}
      <p className={`mt-1 text-xs font-semibold ${textClass}`}>{state.note}</p>
    </div>
  );
}

function WaterPanel({
  day,
  disabled,
  onLog,
  targetOz,
}: {
  day: CalDay;
  disabled: boolean;
  onLog: (amountOz: number) => void;
  targetOz: number | null;
}) {
  const state = metricState(day.waterOz, targetOz, "goal", "oz");
  const textClass = metricTextClass(state.tone);
  const fillClass = metricFillClass(state.tone);

  return (
    <section className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm font-bold ${textClass}`}>Water</p>
        <p className={`text-sm font-bold ${textClass}`}>
          {formatTargetProgress(day.waterOz, targetOz, "oz")}
        </p>
      </div>
      {targetOz !== null ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]">
          <div
            className={`h-1.5 rounded-full transition-colors ${fillClass}`}
            style={{ width: `${state.barPct}%` }}
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {[8, 10, 12, 16].map((amount) => (
          <button
            className="rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            key={amount}
            onClick={() => onLog(amount)}
            type="button"
          >
            +{amount}
          </button>
        ))}
      </div>
    </section>
  );
}

function WeightPanel({
  day,
  disabled,
  onSubmit,
  setWeightValue,
  todayIso,
  weightValue,
}: {
  day: CalDay;
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setWeightValue: (value: string) => void;
  todayIso: string;
  weightValue: string;
}) {
  return (
    <section className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        Weight
      </p>
      <form className="mt-3 flex gap-2" onSubmit={onSubmit}>
        <label className="min-w-0 flex-1 text-sm font-semibold text-[var(--text-secondary)]">
          {focusedDayLabel(day.date, todayIso)}
          <input
            className="mt-1 h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-ring)]"
            min={1}
            onChange={(event) => setWeightValue(event.target.value)}
            step="0.1"
            type="number"
            value={weightValue}
          />
        </label>
        <button
          className="mt-6 rounded-md bg-[var(--surface-base)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-hover)]"
          disabled={disabled || !weightValue.trim()}
          type="submit"
        >
          Save
        </button>
      </form>
    </section>
  );
}

// Discreet mobile-only dropdown of saved foods. Renders a thin button
// "Quick log (N) ▾" that, when tapped, reveals a compact list of saved
// food rows. Hidden entirely when the user has no saved foods so it
// doesn't add clutter for new users. Closes after one-tap log.
function MobileSavedFoodsDropdown({
  disabled,
  loggedFoodId,
  onDelete,
  onInstantLog,
  savedFoods,
}: {
  disabled: boolean;
  loggedFoodId: string | null;
  onDelete: (id: string) => void;
  onInstantLog: (food: SavedFood) => void;
  savedFoods: SavedFood[];
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (savedFoods.length === 0) return null;

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
      <button
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span>Quick log ({savedFoods.length})</span>
        <span
          aria-hidden="true"
          className={`text-[10px] transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {isOpen ? (
        <div className="space-y-1 border-t border-[var(--border-subtle)] px-2 py-2">
          {savedFoods.map((food) => (
            <div className="flex items-center gap-1" key={food.id}>
              <button
                className={`flex flex-1 items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  loggedFoodId === food.id
                    ? "bg-[var(--accent-primary-fill)] text-[var(--accent-primary-text)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
                }`}
                disabled={disabled}
                onClick={() => {
                  onInstantLog(food);
                  setIsOpen(false);
                }}
                type="button"
              >
                <span className="truncate font-semibold">{food.name}</span>
                <span className="shrink-0 text-[10px] font-semibold text-[var(--text-tertiary)]">
                  {food.calories} cal
                </span>
              </button>
              <button
                aria-label={`Delete ${food.name}`}
                className="shrink-0 rounded px-1.5 py-1 text-xs font-semibold text-[var(--text-tertiary)] transition hover:text-[var(--accent-negative-text)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
                onClick={() => {
                  if (window.confirm(`Delete saved food "${food.name}"?`)) {
                    onDelete(food.id);
                  }
                }}
                type="button"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SavedFoodsList({
  disabled,
  loggedFoodId,
  onDelete,
  onInstantLog,
  savedFoods,
}: {
  disabled: boolean;
  loggedFoodId: string | null;
  onDelete: (id: string) => void;
  onInstantLog: (food: SavedFood) => void;
  savedFoods: SavedFood[];
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (savedFoods.length === 0) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          Saved foods
        </p>
        <p className="mt-2 rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--text-secondary)]">
          Save logged foods to quick-log them later.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
      <button
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span>Quick log ({savedFoods.length})</span>
        <span
          aria-hidden="true"
          className={`text-[10px] transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {isOpen ? (
        <div className="space-y-1 border-t border-[var(--border-subtle)] px-2 py-2">
          {savedFoods.map((food) => (
            <SavedFoodRow
              disabled={disabled}
              food={food}
              isLogged={loggedFoodId === food.id}
              key={food.id}
              onDelete={onDelete}
              onInstantLog={onInstantLog}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SavedFoodRow({
  disabled,
  food,
  isLogged,
  onDelete,
  onInstantLog,
}: {
  disabled: boolean;
  food: SavedFood;
  isLogged: boolean;
  onDelete: (id: string) => void;
  onInstantLog: (food: SavedFood) => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded px-2 py-1.5 transition ${
        isLogged
          ? "bg-[var(--accent-primary-fill)] text-[var(--accent-primary-text)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--surface-base)]"
      }`}
    >
      <button
        className="flex flex-1 items-center justify-between gap-3 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => onInstantLog(food)}
        type="button"
      >
        <span className="min-w-0 truncate font-semibold">{food.name}</span>
        <span className="shrink-0 text-[10px] font-semibold text-[var(--text-tertiary)]">
          {food.calories} cal
        </span>
      </button>
      <button
        aria-label={`Delete ${food.name}`}
        className="shrink-0 rounded px-1.5 py-1 text-xs font-semibold text-[var(--text-tertiary)] transition hover:text-[var(--accent-negative-text)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => {
          if (window.confirm(`Delete saved food "${food.name}"?`)) {
            onDelete(food.id);
          }
        }}
        type="button"
      >
        ×
      </button>
    </div>
  );
}

function CategorySelect({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: FoodCategory) => void;
  value: FoodCategory;
}) {
  return (
    <label className="block text-sm font-semibold text-[var(--text-secondary)]">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-ring)]"
        onChange={(event) => onChange(event.target.value as FoodCategory)}
        value={value}
      >
        {FOOD_CATEGORY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextInput({
  className = "",
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  className?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className={`block text-sm font-semibold text-[var(--text-secondary)] ${className}`}>
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-ring)]"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function NumberInput({
  label,
  onChange,
  required = false,
  suffix,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  suffix?: string;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-[var(--text-secondary)]">
      {label}
      <span className="relative mt-1 block">
        <input
          className="h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-ring)]"
          min={0}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          step={1}
          type="number"
          value={value}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--text-tertiary)]">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function currentTimeInput(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
}

function formatMacros(entry: {
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  addedSugarG: number | null;
  saturatedFatG: number | null;
}): string {
  const inline = formatMacrosInline(entry);
  return inline ? ` - ${inline}` : "";
}

function focusedDayLabel(dateIso: string, todayIso: string): string {
  if (dateIso === todayIso) return "Today";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
  }).format(new Date(`${dateIso}T00:00:00.000Z`));
}

function formatMacrosInline(entry: {
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  addedSugarG: number | null;
  saturatedFatG: number | null;
}): string {
  return [
    entry.proteinG === null ? null : `${entry.proteinG}p`,
    entry.carbsG === null ? null : `${entry.carbsG}c`,
    entry.fatG === null ? null : `${entry.fatG}f`,
    entry.fiberG === null ? null : `${entry.fiberG}fi`,
    entry.sodiumMg === null ? null : `${entry.sodiumMg}mg sodium`,
    entry.addedSugarG === null ? null : `${entry.addedSugarG}g sugar`,
    entry.saturatedFatG === null ? null : `${entry.saturatedFatG}g sat fat`,
  ]
    .filter(Boolean)
    .join(" / ");
}

function verdictStatusText(entry: FoodEntry): string {
  if (entry.isProjectedPlan) return "Projected from the meal plan targets.";
  if (entry.verdictSource === "pending") return "Scoring...";
  if (entry.verdictSource === "unscored") return "Not scored yet.";
  if (entry.verdictSource === "manual_override") return "Manual verdict override.";
  if (entry.verdict === null) return "Scoring...";
  return `${entry.verdict[0].toUpperCase()}${entry.verdict.slice(1)} verdict`;
}

function mergeEstimateIntoEntry(
  current: {
    mealName: string;
    category: FoodCategory;
    loggedTime: string;
    calories: string;
    proteinG: string;
    carbsG: string;
    fatG: string;
    fiberG: string;
    sodiumMg: string;
    addedSugarG: string;
    saturatedFatG: string;
  },
  addition: {
    mealName: string;
    category: FoodCategory;
    calories: string;
    proteinG: string;
    carbsG: string;
    fatG: string;
    fiberG: string;
    sodiumMg: string;
    addedSugarG: string;
    saturatedFatG: string;
  },
) {
  return {
    ...current,
    mealName: appendMealName(current.mealName, addition.mealName),
    category: current.category || addition.category,
    calories: addNumberStrings(current.calories, addition.calories),
    proteinG: addOptionalNumberStrings(current.proteinG, addition.proteinG),
    carbsG: addOptionalNumberStrings(current.carbsG, addition.carbsG),
    fatG: addOptionalNumberStrings(current.fatG, addition.fatG),
    fiberG: addOptionalNumberStrings(current.fiberG, addition.fiberG),
    sodiumMg: addOptionalNumberStrings(current.sodiumMg, addition.sodiumMg),
    addedSugarG: addOptionalNumberStrings(current.addedSugarG, addition.addedSugarG),
    saturatedFatG: addOptionalNumberStrings(
      current.saturatedFatG,
      addition.saturatedFatG,
    ),
  };
}

function appendMealName(current: string, addition: string): string {
  const cleanCurrent = current.trim();
  const cleanAddition = addition.trim();
  if (!cleanCurrent) return cleanAddition;
  if (!cleanAddition) return cleanCurrent;
  return `${cleanCurrent} + ${cleanAddition}`;
}

function addNumberStrings(left: string, right: string): string {
  return String(toFormNumber(left) + toFormNumber(right));
}

function addOptionalNumberStrings(left: string, right: string): string {
  const sum = toFormNumber(left) + toFormNumber(right);
  return sum === 0 ? "" : String(sum);
}

function toFormNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSignedCalories(value: number): string {
  return `${formatSignedNumber(value, 0)} cal`;
}

function metricState(
  value: number,
  target: number | null,
  kind: MetricKind,
  unit: string,
) {
  if (target === null || target <= 0) {
    return {
      barPct: 0,
      note: "No target set",
      tone: "neutral" as const,
    };
  }

  const ratio = value / target;
  const barPct = Math.min(100, Math.round(ratio * 100));

  if (kind === "goal") {
    const remaining = Math.max(0, target - value);
    if (value >= target) {
      return {
        barPct,
        note:
          value > target ? `${formatAmount(value - target, unit)} over goal` : "Goal hit",
        tone: "green" as const,
      };
    }
    if (ratio >= 0.9) {
      return {
        barPct,
        note: `${formatAmount(remaining, unit)} to goal`,
        tone: "green" as const,
      };
    }
    if (ratio >= 0.8) {
      return {
        barPct,
        note: `${formatAmount(remaining, unit)} to goal`,
        tone: "amber" as const,
      };
    }
    return {
      barPct,
      note: `${formatAmount(remaining, unit)} to goal`,
      tone: "red" as const,
    };
  }

  if (ratio <= 1.1) {
    return {
      barPct,
      note:
        value <= target
          ? `${formatAmount(target - value, unit)} left`
          : `${formatAmount(value - target, unit)} over`,
      tone: "green" as const,
    };
  }
  if (ratio <= 1.2) {
    return {
      barPct,
      note: `${formatAmount(value - target, unit)} over`,
      tone: "amber" as const,
    };
  }
  return {
    barPct,
    note: `${formatAmount(value - target, unit)} over`,
    tone: "red" as const,
  };
}

function metricTextClass(tone: "green" | "amber" | "red" | "neutral"): string {
  switch (tone) {
    case "green":
      return "text-[var(--accent-primary-text)]";
    case "amber":
      return "text-[var(--accent-warning-text)]";
    case "red":
      return "text-[var(--accent-negative-text)]";
    case "neutral":
      return "text-[var(--text-primary)]";
  }
}

function formatAmount(value: number, unit: string): string {
  return `${Math.round(value).toLocaleString()} ${unit}`;
}

function metricFillClass(tone: "green" | "amber" | "red" | "neutral"): string {
  switch (tone) {
    case "green":
      return "bg-[var(--accent-primary-text)]";
    case "amber":
      return "bg-[var(--accent-warning-text)]";
    case "red":
      return "bg-[var(--accent-negative-text)]";
    case "neutral":
      return "bg-[var(--surface-hover)]";
  }
}

function formatTargetProgress(
  value: number,
  target: number | null,
  unit: string,
): string {
  const formattedValue = value.toLocaleString();
  if (target === null) return `${formattedValue} ${unit}`;
  return `${formattedValue}/${target.toLocaleString()} ${unit}`;
}

function formatSignedNumber(value: number, digits: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })}`;
}

function formatWeekRange(startIso: string, endIso: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const start = formatter.format(new Date(`${startIso}T00:00:00.000Z`));
  const end = formatter.format(new Date(`${endIso}T00:00:00.000Z`));
  const year = new Date(`${endIso}T00:00:00.000Z`).getUTCFullYear();

  return `${start} - ${end}, ${year}`;
}
