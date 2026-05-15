"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";

import { AiFoodEstimator } from "@/components/cal/AiFoodEstimator";
import {
  createFoodEntryAction,
  deleteFoodEntryAction,
  generateMealOrderPromptAction,
  logWaterAction,
  logWeightAction,
  overrideVerdictAction,
  regenerateVerdictAction,
  updateFoodEntryAction,
} from "@/app/(protected)/cal/actions";
import {
  categoryBarClass,
  categoryLabel,
  magnitudeColorClass,
  verdictBarClass,
} from "@/lib/cal/color";
import {
  colorToneFromMagnitude,
  dailyDeviation,
  DAILY_CALORIE_THRESHOLDS,
  WEEKLY_CALORIE_THRESHOLDS,
  WEEKLY_MACRO_THRESHOLDS,
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

type MealFormState = {
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
  savedFoodId: string | null;
};

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

function emptyMealForm(): MealFormState {
  return {
    mealName: "",
    category: "meal",
    loggedTime: currentTimeInput(),
    calories: "",
    proteinG: "",
    carbsG: "",
    fatG: "",
    fiberG: "",
    sodiumMg: "",
    addedSugarG: "",
    saturatedFatG: "",
    savedFoodId: null,
  };
}

const FOOD_CATEGORY_OPTIONS: Array<{ value: FoodCategory; label: string }> = [
  { value: "meal", label: "Meal" },
  { value: "healthy_snack", label: "Healthy snack" },
  { value: "unhealthy_snack", label: "Unhealthy snack" },
  { value: "drink", label: "Drink" },
  { value: "other", label: "Other" },
];

export function ShiftlyCalView({
  initialData,
  weekStartIso,
}: {
  initialData: ShiftlyCalData;
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
  const [mealForm, setMealForm] = useState<MealFormState>(() => emptyMealForm());
  const [isMealFormOpen, setIsMealFormOpen] = useState(false);
  const [weightValue, setWeightValue] = useState(
    initialData.currentWeek.days[todayIndex]?.weight?.weightLbs.toString() ?? "",
  );
  const [loggedFoodId, setLoggedFoodId] = useState<string | null>(null);
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
  const currentWeight = useMemo(
    () => getMostRecentWeight(initialData.currentWeek.days),
    [initialData.currentWeek.days],
  );
  const weeklyCalorieDeviation = dailyDeviation(
    initialData.currentWeek.totals.calories,
    initialData.targets.tdeeCalories === null
      ? null
      : initialData.targets.tdeeCalories * 7,
  );
  const weeklyProteinDeviation = dailyDeviation(
    initialData.currentWeek.totals.proteinG,
    initialData.targets.proteinTargetG === null
      ? null
      : initialData.targets.proteinTargetG * 7,
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

  function submitMeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        await createFoodEntryAction({
          date: focusedDay.date,
          loggedTime: mealForm.loggedTime,
          mealName: mealForm.mealName,
          category: mealForm.category,
          calories: mealForm.calories,
          proteinG: mealForm.proteinG,
          carbsG: mealForm.carbsG,
          fatG: mealForm.fatG,
          fiberG: mealForm.fiberG,
          sodiumMg: mealForm.sodiumMg,
          addedSugarG: mealForm.addedSugarG,
          saturatedFatG: mealForm.saturatedFatG,
          savedFoodId: mealForm.savedFoodId,
        });
        setMealForm(emptyMealForm());
        setIsMealFormOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to log meal.");
      }
    });
  }

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
        await createFoodEntryAction({
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

  function fillFromSavedFood(food: SavedFood) {
    setMealForm({
      mealName: food.name,
      category: food.category,
      loggedTime: currentTimeInput(),
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
    setIsMealFormOpen(true);
  }

  function focusDay(index: number) {
    setFocusedDayIndex(index);
    setWeightValue(
      initialData.currentWeek.days[index]?.weight?.weightLbs.toString() ?? "",
    );
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-white/15 bg-black/5 shadow-[0_24px_70px_rgba(8,15,28,0.22)] backdrop-blur-[1px]">
        <div className="h-2 bg-white/10" />
        <div className="p-3 sm:p-4">
          <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(520px,1.05fr)] lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                ShiftlyCal
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Link
                  className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-sm font-semibold text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20"
                  href={`/cal?week=${prevWeekIso}`}
                >
                  Prev
                </Link>
                <h2 className="text-2xl font-semibold tracking-tight text-white drop-shadow-sm sm:text-3xl">
                  {formatWeekRange(
                    initialData.currentWeek.weekStartIso,
                    initialData.currentWeek.weekEndIso,
                  )}
                </h2>
                {isCurrentWeek ? (
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-semibold text-white/40">
                    Next
                  </span>
                ) : (
                  <Link
                    className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-sm font-semibold text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20"
                    href={`/cal?week=${nextWeekIso}`}
                  >
                    Next
                  </Link>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <p className="inline-flex rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-sm">
                  Energy balance tracker
                </p>
                <Link
                  className="inline-flex rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20"
                  href={`/cal/trends?week=${weekStartIso}`}
                >
                  Trends
                </Link>
              </div>
            </div>
            <MetricStrip
              currentWeight={currentWeight?.weightLbs ?? null}
              projection={initialData.projection}
              targets={initialData.targets}
              totals={initialData.currentWeek.totals}
              weeklyCalorieDeviation={weeklyCalorieDeviation}
              weeklyProteinDeviation={weeklyProteinDeviation}
            />
          </div>

          <div className="pb-2">
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {initialData.currentWeek.days.map((day, index) => (
                <WeekStripCell
                  day={day}
                  isFocused={index === focusedDayIndex}
                  key={day.date}
                  onClick={() => focusDay(index)}
                  targets={initialData.targets}
                />
              ))}
            </div>
          </div>

          {error ? (
            <p className="mt-4 rounded-md border border-red-300/60 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-200">
              {error}
            </p>
          ) : null}

          <section className="mt-4 rounded-lg border border-white/15 bg-black/15 p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-md">
            <div className="grid gap-3 xl:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.08fr)_minmax(260px,0.72fr)]">
              <SavedFoodsList
                disabled={isPending}
                loggedFoodId={loggedFoodId}
                onFill={fillFromSavedFood}
                onInstantLog={instantLog}
                savedFoods={initialData.savedFoods}
              />

              <div>
                <FocusedDayHeader
                  day={focusedDay}
                  dayTotals={focusedDay.totals}
                  targets={initialData.targets}
                />
                <div className="mt-4 space-y-3">
        <AiFoodEstimator
                    disabled={isPending}
                    onConfirm={logFromEstimate}
                  />
                </div>
                {isMealFormOpen ? (
                  <MealEntryForm
                    disabled={isPending}
                    mealForm={mealForm}
                    onMealFormChange={setMealForm}
                    onSubmit={submitMeal}
                  />
                ) : null}
                <div className="mt-4 space-y-2">
                  {focusedDay.entries.length > 0 ? (
                    focusedDay.entries.map((entry) => (
                      <FoodEntryRow
                        disabled={isPending}
                        entry={entry}
                        key={entry.id}
                        nowMs={nowMs}
                        onDelete={deleteEntry}
                        onOverrideVerdict={overrideVerdict}
                        onRegenerateVerdict={regenerateVerdict}
                        onUpdate={updateEntry}
                      />
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-white/20 bg-black/15 p-6 text-center text-sm text-white/70">
                      No food logged for this day.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <DayTotalsPanel
                  day={focusedDay}
                  targets={initialData.targets}
                />
                <div className="mt-4">
                  <MealOrderPromptBox disabled={isPending} />
                </div>
                <div className="mt-4">
                  <WaterPanel
                    day={focusedDay}
                    disabled={isPending}
                    onLog={logWater}
                    targetOz={initialData.targets.waterTargetOz}
                  />
                </div>
                <div className="mt-4">
                  <WeightPanel
                    day={focusedDay}
                    disabled={isPending}
                    onSubmit={submitWeight}
                    setWeightValue={setWeightValue}
                    todayIso={initialData.todayIso}
                    weightValue={weightValue}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function MetricStrip({
  currentWeight,
  projection,
  targets,
  totals,
  weeklyCalorieDeviation,
  weeklyProteinDeviation,
}: {
  currentWeight: number | null;
  projection: ShiftlyCalData["projection"];
  targets: CalTargets;
  totals: CalTotals;
  weeklyCalorieDeviation: number | null;
  weeklyProteinDeviation: number | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      <TopMetric
        accent="green"
        label="Week calories"
        tone={colorToneFromMagnitude(weeklyCalorieDeviation, WEEKLY_CALORIE_THRESHOLDS)}
        value={totals.calories.toLocaleString()}
      />
      <TopMetric
        accent="blue"
        label="Week protein"
        tone={colorToneFromMagnitude(weeklyProteinDeviation, WEEKLY_MACRO_THRESHOLDS)}
        value={`${totals.proteinG}g`}
      />
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
      <TopMetric
        label="Current weight"
        value={currentWeight === null ? "--" : `${currentWeight.toFixed(1)} lbs`}
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
      ? "before:bg-green-600"
      : accent === "blue"
        ? "before:bg-[#7e22ce]"
        : accent === "amber"
          ? "before:bg-amber-500"
          : accent === "negative"
            ? "before:bg-red-600"
            : "before:bg-[#cbd5e1]";

  return (
    <div
      className={`relative overflow-hidden rounded-md border-2 border-white/45 bg-white/10 px-2.5 py-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_24px_rgba(8,15,28,0.12)] backdrop-blur-xl before:absolute before:inset-x-0 before:top-0 before:h-1 sm:px-4 ${accentClass}`}
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/85 sm:text-[10px] sm:tracking-[0.14em]">
        {label}
      </p>
      <p className={`mt-1 text-base font-semibold sm:text-lg ${magnitudeColorClass(tone)}`}>
        {value}
      </p>
      {note ? <p className="mt-2 text-xs text-white/60">{note}</p> : null}
    </div>
  );
}

function WeekStripCell({
  day,
  isFocused,
  onClick,
  targets,
}: {
  day: CalDay;
  isFocused: boolean;
  onClick: () => void;
  targets: CalTargets;
}) {
  const deviation = dailyDeviation(day.totals.calories, targets.tdeeCalories);
  const tone = colorToneFromMagnitude(deviation, DAILY_CALORIE_THRESHOLDS);
  const date = new Date(`${day.date}T00:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(date);

  return (
    <button
      className={`min-w-0 rounded-md px-1.5 py-2 text-left text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-white sm:p-3 ${
        isFocused
          ? "border-2 border-white/90 bg-white/14 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_24px_rgba(8,15,28,0.12)] backdrop-blur-xl"
          : "border-2 border-white/45 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-xl hover:border-white/60 hover:bg-white/14"
      }`}
      onClick={onClick}
      type="button"
    >
      <p className="truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-white sm:text-[10px] sm:tracking-[0.14em]">
        {weekday}
      </p>
      <p className="mt-1 text-base font-semibold text-white sm:text-lg">
        {date.getUTCDate()}
      </p>
      <p
        className={`mt-3 truncate text-xs font-semibold sm:mt-6 sm:text-sm ${magnitudeColorClass(tone)}`}
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
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
          Focused day
        </p>
        <h2 className="mt-1 text-xl font-semibold text-white">{label}</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm font-semibold text-white/80">
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
      <span className="rounded-full border border-emerald-300/50 bg-white/10 px-3 py-1 text-sm font-semibold text-emerald-300">
        {remaining.toLocaleString()} cal left
      </span>
    );
  }

  if (remaining < 0) {
    return (
      <span className="rounded-full border border-red-300/50 bg-white/10 px-3 py-1 text-sm font-semibold text-red-300">
        {Math.abs(remaining).toLocaleString()} cal over
      </span>
    );
  }

  return (
    <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-sm font-semibold text-white">
      Right on target
    </span>
  );
}

function MealEntryForm({
  disabled,
  mealForm,
  onMealFormChange,
  onSubmit,
}: {
  disabled: boolean;
  mealForm: MealFormState;
  onMealFormChange: (form: MealFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="mt-4 rounded-md border border-white/15 bg-black/20 p-3" onSubmit={onSubmit}>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <TextInput
          className="lg:col-span-2"
        label="Meal"
          onChange={(value) => onMealFormChange({ ...mealForm, mealName: value })}
          placeholder="Chicken bowl"
          value={mealForm.mealName}
        />
        <TextInput
          label="Time"
          onChange={(value) => onMealFormChange({ ...mealForm, loggedTime: value })}
          type="time"
          value={mealForm.loggedTime}
        />
        <CategorySelect
          label="Category"
          onChange={(category) => onMealFormChange({ ...mealForm, category })}
          value={mealForm.category}
        />
        <NumberInput
          label="Calories"
          onChange={(value) => onMealFormChange({ ...mealForm, calories: value })}
          required
          value={mealForm.calories}
        />
        <NumberInput
          label="Protein"
          onChange={(value) => onMealFormChange({ ...mealForm, proteinG: value })}
          suffix="g"
          value={mealForm.proteinG}
        />
        <NumberInput
          label="Carbs"
          onChange={(value) => onMealFormChange({ ...mealForm, carbsG: value })}
          suffix="g"
          value={mealForm.carbsG}
        />
        <NumberInput
          label="Fat"
          onChange={(value) => onMealFormChange({ ...mealForm, fatG: value })}
          suffix="g"
          value={mealForm.fatG}
        />
        <NumberInput
          label="Fiber"
          onChange={(value) => onMealFormChange({ ...mealForm, fiberG: value })}
          suffix="g"
          value={mealForm.fiberG}
        />
        <NumberInput
          label="Sodium"
          onChange={(value) => onMealFormChange({ ...mealForm, sodiumMg: value })}
          suffix="mg"
          value={mealForm.sodiumMg}
        />
        <NumberInput
          label="Added sugar"
          onChange={(value) => onMealFormChange({ ...mealForm, addedSugarG: value })}
          suffix="g"
          value={mealForm.addedSugarG}
        />
        <NumberInput
          label="Sat fat"
          onChange={(value) => onMealFormChange({ ...mealForm, saturatedFatG: value })}
          suffix="g"
          value={mealForm.saturatedFatG}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/20"
          disabled={disabled || !mealForm.calories.trim()}
          type="submit"
        >
          Log entry
        </button>
      </div>
    </form>
  );
}

function FoodEntryRow({
  disabled,
  entry,
  nowMs,
  onDelete,
  onOverrideVerdict,
  onRegenerateVerdict,
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
  onUpdate: (id: string, patch: UpdateFoodEntryPatch) => Promise<boolean>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isVerdictSaving, setIsVerdictSaving] = useState(false);
  const [overrideValue, setOverrideValue] = useState<FoodVerdict>(
    entry.verdict ?? "fine",
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
    ? "rounded-md border border-zinc-600 bg-zinc-700 p-3 text-sm text-white shadow-[0_8px_18px_rgba(8,15,28,0.16)]"
    : verdictBarClass(entry);

  if (isEditing) {
    return (
      <form className={rowClass} onSubmit={submitEdit}>
        <button
          className="mb-3 w-full rounded-md border border-white/20 bg-black/20 p-3 text-left transition hover:bg-black/30 focus:outline-none focus:ring-2 focus:ring-white/60"
          onClick={() => setIsEditing(false)}
          type="button"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm italic text-white/85">
              {entry.verdictReason
                ? `${entry.verdictReason}${
                    entry.verdictSource === "manual_override" ? " (your override)" : ""
                  }`
                : verdictStatus}
            </p>
            <span aria-hidden="true" className="shrink-0 text-xs text-white/60">
              tap to close
            </span>
          </div>
          {entry.verdictSource === "unscored" && entry.verdictError ? (
            <p className="mt-2 rounded-md border border-red-300/50 bg-red-500/15 px-2 py-1 text-xs font-semibold text-red-200">
              Scoring failed: {entry.verdictError}
            </p>
          ) : null}
          <span className="mt-2 inline-flex rounded-full border border-white/20 bg-black/20 px-2 py-0.5 text-xs font-semibold text-white/65">
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
            className="rounded border border-white/30 bg-black/20 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black/30 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || isSaving || !editForm.calories.trim()}
            type="submit"
          >
            Save
          </button>
          <button
            className="rounded border border-white/20 bg-black/10 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-black/20 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || isSaving}
            onClick={() => setIsEditing(false)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded border border-white/20 bg-black/10 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-black/20 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || isSaving || isVerdictSaving}
            onClick={regenerateVerdict}
            type="button"
          >
            Regenerate verdict
          </button>
        </div>
        <div className="mt-3 rounded-md border border-white/20 bg-black/20 p-3">
          <p className="mb-2 text-xs font-semibold text-white/75">
            Lock verdict override
          </p>
          <div className="grid gap-2 sm:grid-cols-[120px_1fr_auto]">
            <select
              className="rounded-md border border-white/20 bg-[#111827] px-3 py-2 text-sm font-semibold text-white focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-white/30"
              disabled={disabled || isVerdictSaving}
              onChange={(event) => setOverrideValue(event.target.value as FoodVerdict)}
              value={overrideValue}
            >
              <option value="good">Good</option>
              <option value="fine">Fine</option>
              <option value="bad">Bad</option>
            </select>
            <input
              className="rounded-md border border-white/20 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-white/30"
              disabled={disabled || isVerdictSaving}
              onChange={(event) => setOverrideReason(event.target.value)}
              placeholder="Reason"
              value={overrideReason}
            />
            <button
              className="rounded border border-white/30 bg-black/20 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black/30 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled || isVerdictSaving}
              onClick={submitOverride}
              type="button"
            >
              Lock override
            </button>
          </div>
        </div>
        <div className="mt-3 rounded-md border border-white/20 bg-black/20 p-3">
          <p className="mb-2 text-xs font-semibold text-white/75">
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
        className={`${rowClass} flex w-full items-center justify-between gap-3 text-left transition-all focus:outline-none focus:ring-2 focus:ring-white/60`}
        onClick={() => setIsExpanded(true)}
        type="button"
      >
        <span className="min-w-0 truncate font-semibold">{title}</span>
        {entry.verdictSource === "manual_override" ? (
          <span className="shrink-0 rounded-full border border-white/20 bg-black/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/75">
            Override
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-right font-semibold opacity-90">
          {entry.calories.toLocaleString()} cal
        </span>
        {isStuck ? (
          <span className="shrink-0 rounded border border-white/30 bg-black/20 px-2 py-1 text-xs font-semibold text-white">
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
    <div className={`${rowClass} transition-all`}>
      <button
        className="flex w-full items-center justify-between gap-3 text-left focus:outline-none focus:ring-2 focus:ring-white/60"
        onClick={() => setIsExpanded(false)}
        type="button"
        aria-label={`Collapse ${title}`}
      >
        <span className="min-w-0 truncate font-semibold">{title}</span>
        <span className="text-right font-semibold opacity-90">
          {entry.calories.toLocaleString()} cal
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs opacity-70">
          ^
        </span>
      </button>
      <div className="mt-2 rounded-md border border-white/20 bg-black/20 p-2 text-xs text-white/85">
        <p className="line-clamp-2 italic">{entry.verdictReason ?? verdictStatus}</p>
        {entry.verdictSource === "unscored" && entry.verdictError ? (
          <p className="mt-2 rounded-md border border-red-300/50 bg-red-500/15 px-2 py-1 font-semibold text-red-200">
            Scoring failed: {entry.verdictError}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/20 bg-black/20 px-2 py-0.5 font-semibold text-white/70">
            {categoryLabel(entry.category)}
          </span>
          {entry.verdictSource === "manual_override" ? (
            <span className="rounded-full border border-white/20 bg-black/20 px-2 py-0.5 font-semibold text-white/70">
              Override
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs opacity-85 transition-all">
        <span>{formatMacrosInline(entry) || "No macros logged"}</span>
        <div className="flex items-center gap-2">
          <button
            className="rounded px-1 py-0.5 font-semibold text-white/70 transition hover:text-white"
            onClick={() => setIsExpanded(false)}
            type="button"
          >
            Close
          </button>
          {entry.verdictSource === "unscored" || isStuck ? (
            <button
              className="rounded border border-white/30 bg-black/20 px-2 py-1 font-semibold text-white transition hover:bg-black/30 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled || isVerdictSaving}
              onClick={regenerateVerdict}
              type="button"
            >
              {isStuck ? "Scoring stuck - retry" : "Retry scoring"}
            </button>
          ) : null}
          <button
            className="rounded px-1 py-0.5 font-semibold text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
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
            className="rounded px-1 py-0.5 font-semibold text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(entry.id);
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
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
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
    <div className="rounded-md border border-white/15 bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
          {label}
        </p>
        <p className={`text-xl font-bold ${textClass}`}>
          {formatTargetProgress(value, target, unit)}
        </p>
      </div>
      {target !== null ? (
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-2.5 rounded-full transition-all ${fillClass}`}
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

  return (
    <div className="rounded-md border border-white/10 bg-black/15 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-bold ${textClass}`}>{label}</p>
        <p className={`text-sm font-bold ${textClass}`}>
          {formatTargetProgress(value, target, unit)}
        </p>
      </div>
      {target !== null ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-1.5 rounded-full transition-all ${fillClass}`}
            style={{ width: `${state.barPct}%` }}
          />
        </div>
      ) : null}
      <p className={`mt-1 text-xs font-semibold ${textClass}`}>{state.note}</p>
    </div>
  );
}

function MealOrderPromptBox({ disabled }: { disabled: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [zipCode, setZipCode] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (window.localStorage.getItem("shiftlycal-order-zip") ?? ""),
  );
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  async function generatePrompt() {
    setStatus(null);
    setIsGenerating(true);
    try {
      window.localStorage.setItem("shiftlycal-order-zip", zipCode);
      const result = await generateMealOrderPromptAction({
        locationHint: zipCode,
      });
      setPrompt(result.prompt);
      setIsOpen(true);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unable to generate prompt.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("Copied to clipboard.");
    } catch {
      setStatus("Copy failed. Select the text and copy it manually.");
    }
  }

  return (
    <section className="rounded-md border border-white/15 bg-black/15 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md">
      <button
        className="w-full rounded-md border border-emerald-300/50 bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled || isGenerating}
        onClick={() => {
          if (!isOpen || !prompt) {
            void generatePrompt();
            return;
          }
          setIsOpen((current) => !current);
        }}
        type="button"
      >
        {isGenerating ? "Building DoorDash prompt..." : "🛵 Order final meal"}
      </button>

      {isOpen ? (
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-semibold text-white/75">
            Zip code
            <input
              className="mt-1 h-10 w-full rounded-md border border-white/20 bg-black/25 px-3 text-sm text-white outline-none transition placeholder:text-white/50 focus:border-white/60 focus:ring-2 focus:ring-white/40"
              onChange={(event) => setZipCode(event.target.value)}
              placeholder="10001"
              value={zipCode}
            />
          </label>
          <textarea
            className="h-[400px] w-full rounded-md border border-white/20 bg-black/25 px-3 py-2 font-mono text-xs leading-5 text-white outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white/40"
            onChange={(event) => setPrompt(event.target.value)}
            value={prompt}
          />
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled || isGenerating}
              onClick={generatePrompt}
              type="button"
            >
              Regenerate
            </button>
            <button
              className="rounded-md border border-emerald-300/50 bg-emerald-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!prompt}
              onClick={copyPrompt}
              type="button"
            >
              📋 Copy to clipboard
            </button>
            <button
              className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
          {status ? <p className="text-xs font-semibold text-white/70">{status}</p> : null}
        </div>
      ) : status ? (
        <p className="mt-2 text-xs font-semibold text-red-200">{status}</p>
      ) : null}
    </section>
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
    <section className="rounded-md border border-white/15 bg-black/15 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm font-bold ${textClass}`}>Water</p>
        <p className={`text-sm font-bold ${textClass}`}>
          {formatTargetProgress(day.waterOz, targetOz, "oz")}
        </p>
      </div>
      {targetOz !== null ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-1.5 rounded-full transition-all ${fillClass}`}
            style={{ width: `${state.barPct}%` }}
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {[8, 12, 16, 24].map((amount) => (
          <button
            className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
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
    <section className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        Weight
      </p>
      <form className="mt-3 flex gap-2" onSubmit={onSubmit}>
        <label className="min-w-0 flex-1 text-sm font-semibold text-white/80">
          {focusedDayLabel(day.date, todayIso)}
          <input
            className="mt-1 h-10 w-full rounded-md border border-white/20 bg-black/25 px-3 text-sm text-white outline-none transition placeholder:text-white/50 focus:border-white/60 focus:ring-2 focus:ring-white/40"
            min={1}
            onChange={(event) => setWeightValue(event.target.value)}
            step="0.1"
            type="number"
            value={weightValue}
          />
        </label>
        <button
          className="mt-6 rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/20"
          disabled={disabled || !weightValue.trim()}
          type="submit"
        >
          Save
        </button>
      </form>
    </section>
  );
}

function SavedFoodsList({
  disabled,
  loggedFoodId,
  onFill,
  onInstantLog,
  savedFoods,
}: {
  disabled: boolean;
  loggedFoodId: string | null;
  onFill: (food: SavedFood) => void;
  onInstantLog: (food: SavedFood) => void;
  savedFoods: SavedFood[];
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        Saved foods
      </p>
      <h2 className="mt-1 text-xl font-semibold text-white">Quick log</h2>
      <div className="mt-4 grid gap-2">
        {savedFoods.length > 0 ? (
          savedFoods.map((food) => (
            <SavedFoodRow
              disabled={disabled}
              food={food}
              isLogged={loggedFoodId === food.id}
              key={food.id}
              onFill={onFill}
              onInstantLog={onInstantLog}
            />
          ))
        ) : (
          <p className="rounded-md border border-dashed border-white/20 bg-black/15 p-4 text-sm text-white/70">
            Create saved foods from Trends.
          </p>
        )}
      </div>
    </div>
  );
}

function SavedFoodRow({
  disabled,
  food,
  isLogged,
  onFill,
  onInstantLog,
}: {
  disabled: boolean;
  food: SavedFood;
  isLogged: boolean;
  onFill: (food: SavedFood) => void;
  onInstantLog: (food: SavedFood) => void;
}) {
  return (
    <div className={categoryBarClass(food.category)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{food.name}</p>
          <p className="text-sm text-white/70">
            {categoryLabel(food.category)} - {food.calories.toLocaleString()} cal
            {formatMacros(food)}
          </p>
        </div>
        <button
          className="rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/20"
          disabled={disabled}
          onClick={() => onInstantLog(food)}
          type="button"
        >
          {isLogged ? "Logged" : "Log"}
        </button>
      </div>
      <button
        className="mt-2 text-xs font-semibold text-white/60 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={() => onFill(food)}
        type="button"
      >
        Edit
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
    <label className="block text-sm font-semibold text-white/80">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-md border border-white/20 bg-[#111827] px-3 text-sm text-white outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white/40"
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
    <label className={`block text-sm font-semibold text-white/80 ${className}`}>
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-white/20 bg-black/25 px-3 text-sm text-white outline-none transition placeholder:text-white/50 focus:border-white/60 focus:ring-2 focus:ring-white/40"
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
    <label className="block text-sm font-semibold text-white/80">
      {label}
      <span className="relative mt-1 block">
        <input
          className="h-10 w-full rounded-md border border-white/20 bg-black/25 px-3 text-sm text-white outline-none transition placeholder:text-white/50 focus:border-white/60 focus:ring-2 focus:ring-white/40"
          min={0}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          step={1}
          type="number"
          value={value}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-white/50">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function getMostRecentWeight(days: CalDay[]) {
  return [...days]
    .reverse()
    .map((day) => day.weight)
    .find((weight) => weight !== null) ?? null;
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
        tone: "amber" as const,
      };
    }
    return {
      barPct,
      note: `${formatAmount(remaining, unit)} to goal`,
      tone: "red" as const,
    };
  }

  if (value <= target) {
    return {
      barPct,
      note: `${formatAmount(target - value, unit)} left`,
      tone: "green" as const,
    };
  }
  if (value <= target * 1.1) {
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
      return "text-emerald-300";
    case "amber":
      return "text-amber-300";
    case "red":
      return "text-red-300";
    case "neutral":
      return "text-white";
  }
}

function formatAmount(value: number, unit: string): string {
  return `${Math.round(value).toLocaleString()} ${unit}`;
}

function metricFillClass(tone: "green" | "amber" | "red" | "neutral"): string {
  switch (tone) {
    case "green":
      return "bg-emerald-300";
    case "amber":
      return "bg-amber-300";
    case "red":
      return "bg-red-300";
    case "neutral":
      return "bg-white/40";
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
