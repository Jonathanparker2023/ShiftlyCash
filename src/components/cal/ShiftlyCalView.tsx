"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useMemo, useState, useTransition } from "react";

import {
  archiveSavedFoodAction,
  createFoodEntryAction,
  createSavedFoodAction,
  deleteFoodEntryAction,
  logWeightAction,
  saveCalTargetsAction,
} from "@/app/(protected)/cal/actions";
import { magnitudeColorClass } from "@/lib/cal/color";
import {
  colorToneFromMagnitude,
  dailyDeviation,
  DAILY_CALORIE_THRESHOLDS,
  DAILY_MACRO_THRESHOLDS,
  WEEKLY_CALORIE_THRESHOLDS,
  WEEKLY_MACRO_THRESHOLDS,
  type MagnitudeTone,
} from "@/lib/cal/projection";
import type {
  CalDay,
  CalTargets,
  FoodEntry,
  SavedFood,
  ShiftlyCalData,
} from "@/lib/cal/types";

type MealFormState = {
  mealName: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  savedFoodId: string | null;
};

type SavedFoodFormState = {
  name: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
};

type TargetFormState = {
  tdeeCalories: string;
  proteinTargetG: string;
  carbsTargetG: string;
  fatTargetG: string;
};

const emptyMealForm: MealFormState = {
  mealName: "",
  calories: "",
  proteinG: "",
  carbsG: "",
  fatG: "",
  savedFoodId: null,
};

const emptySavedFoodForm: SavedFoodFormState = {
  name: "",
  calories: "",
  proteinG: "",
  carbsG: "",
  fatG: "",
};

export function ShiftlyCalView({
  initialData,
}: {
  initialData: ShiftlyCalData;
}) {
  const router = useRouter();
  const todayIndex = Math.max(
    0,
    initialData.currentWeek.days.findIndex((day) => day.date === initialData.todayIso),
  );
  const [focusedDayIndex, setFocusedDayIndex] = useState(todayIndex);
  const [mealForm, setMealForm] = useState<MealFormState>(emptyMealForm);
  const [savedFoodForm, setSavedFoodForm] = useState<SavedFoodFormState>(
    emptySavedFoodForm,
  );
  const [targetForm, setTargetForm] = useState<TargetFormState>({
    tdeeCalories: initialData.targets.tdeeCalories?.toString() ?? "",
    proteinTargetG: initialData.targets.proteinTargetG?.toString() ?? "",
    carbsTargetG: initialData.targets.carbsTargetG?.toString() ?? "",
    fatTargetG: initialData.targets.fatTargetG?.toString() ?? "",
  });
  const [weightValue, setWeightValue] = useState(
    initialData.currentWeek.days[todayIndex]?.weight?.weightLbs.toString() ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const focusedDay = initialData.currentWeek.days[focusedDayIndex] ?? initialData.currentWeek.days[0];
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

  function submitMeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        await createFoodEntryAction({
          date: focusedDay.date,
          mealName: mealForm.mealName,
          calories: mealForm.calories,
          proteinG: mealForm.proteinG,
          carbsG: mealForm.carbsG,
          fatG: mealForm.fatG,
          savedFoodId: mealForm.savedFoodId,
        });
        setMealForm(emptyMealForm);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to log meal.");
      }
    });
  }

  function submitSavedFood(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        await createSavedFoodAction(savedFoodForm);
        setSavedFoodForm(emptySavedFoodForm);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to save food.");
      }
    });
  }

  function submitTargets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        await saveCalTargetsAction(targetForm);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to save targets.");
      }
    });
  }

  function submitWeight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        await logWeightAction({
          date: initialData.todayIso,
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

  function archiveSavedFood(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await archiveSavedFoodAction({ id });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to archive saved food.");
      }
    });
  }

  function fillFromSavedFood(food: SavedFood) {
    setMealForm({
      mealName: food.name,
      calories: food.calories.toString(),
      proteinG: food.proteinG?.toString() ?? "",
      carbsG: food.carbsG?.toString() ?? "",
      fatG: food.fatG?.toString() ?? "",
      savedFoodId: food.id,
    });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.22)] backdrop-blur-md">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <TopMetric
            label="Week calories"
            tone={colorToneFromMagnitude(weeklyCalorieDeviation, WEEKLY_CALORIE_THRESHOLDS)}
            value={initialData.currentWeek.totals.calories.toLocaleString()}
          />
          <TopMetric
            label="Week protein"
            tone={colorToneFromMagnitude(weeklyProteinDeviation, WEEKLY_MACRO_THRESHOLDS)}
            value={`${initialData.currentWeek.totals.proteinG}g`}
          />
          <TopMetric
            label="Weekly delta"
            note={
              initialData.targets.tdeeCalories === null
                ? "Set your TDEE in targets to see projections."
                : null
            }
            value={
              initialData.targets.tdeeCalories === null
                ? "--"
                : formatSignedCalories(initialData.projection.weeklyDeficitCalories)
            }
          />
          <TopMetric
            label="Estimated weight change"
            note={
              initialData.targets.tdeeCalories === null
                ? "Estimate unlocks after TDEE is set."
                : null
            }
            value={
              initialData.targets.tdeeCalories === null
                ? "--"
                : `${formatSignedNumber(initialData.projection.projectedWeightDeltaLbs, 2)} lbs`
            }
          />
          <TopMetric
            label="Current weight"
            value={currentWeight === null ? "--" : `${currentWeight.weightLbs.toFixed(1)} lbs`}
          />
        </div>
      </section>

      <section className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.22)] backdrop-blur-md">
        <div className="grid grid-cols-7 gap-2">
          {initialData.currentWeek.days.map((day, index) => (
            <WeekStripCell
              day={day}
              isFocused={index === focusedDayIndex}
              key={day.date}
              onClick={() => setFocusedDayIndex(index)}
              targets={initialData.targets}
            />
          ))}
        </div>
      </section>

      {error ? (
        <p className="rounded-md border border-red-300/60 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-200">
          {error}
        </p>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)_minmax(320px,0.7fr)]">
        <div className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md">
          <FocusedDayHeader day={focusedDay} />
          <MealEntryForm
            disabled={isPending}
            focusedDay={focusedDay}
            mealForm={mealForm}
            onMealFormChange={setMealForm}
            onSubmit={submitMeal}
          />
          <div className="mt-4 space-y-2">
            {focusedDay.entries.length > 0 ? (
              focusedDay.entries.map((entry) => (
                <FoodEntryRow
                  disabled={isPending}
                  entry={entry}
                  key={entry.id}
                  onDelete={deleteEntry}
                />
              ))
            ) : (
              <div className="rounded-md border border-dashed border-white/20 bg-black/15 p-6 text-center text-sm text-white/70">
                No food logged for this day.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
            Day totals
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {focusedDay.totals.calories.toLocaleString()} calories
          </h2>
          <div className="mt-4 grid gap-2">
            <DayTotalLine
              label="Calories"
              target={initialData.targets.tdeeCalories}
              thresholds={DAILY_CALORIE_THRESHOLDS}
              unit="cal"
              value={focusedDay.totals.calories}
            />
            <DayTotalLine
              label="Protein"
              target={initialData.targets.proteinTargetG}
              thresholds={DAILY_MACRO_THRESHOLDS}
              unit="g"
              value={focusedDay.totals.proteinG}
            />
            <DayTotalLine
              label="Carbs"
              target={initialData.targets.carbsTargetG}
              thresholds={DAILY_MACRO_THRESHOLDS}
              unit="g"
              value={focusedDay.totals.carbsG}
            />
            <DayTotalLine
              label="Fat"
              target={initialData.targets.fatTargetG}
              thresholds={DAILY_MACRO_THRESHOLDS}
              unit="g"
              value={focusedDay.totals.fatG}
            />
          </div>
        </div>

        <div className="space-y-4">
          <WeightPanel
            day={focusedDay}
            disabled={isPending}
            onSubmit={submitWeight}
            setWeightValue={setWeightValue}
            todayIso={initialData.todayIso}
            weightValue={weightValue}
          />
          <TargetsPanel
            disabled={isPending}
            onSubmit={submitTargets}
            setTargetForm={setTargetForm}
            targetForm={targetForm}
            targets={initialData.targets}
          />
        </div>
      </section>

      <section className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)]">
          <SavedFoodsList
            disabled={isPending}
            onArchive={archiveSavedFood}
            onFill={fillFromSavedFood}
            savedFoods={initialData.savedFoods}
          />
          <SavedFoodForm
            disabled={isPending}
            form={savedFoodForm}
            onChange={setSavedFoodForm}
            onSubmit={submitSavedFood}
          />
        </div>
      </section>
    </div>
  );
}

function TopMetric({
  label,
  note,
  tone = "neutral",
  value,
}: {
  label: string;
  note?: string | null;
  tone?: MagnitudeTone;
  value: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border-2 border-white/35 bg-black/25 shadow-sm backdrop-blur-md">
      <div className="h-1 bg-white/30" />
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
          {label}
        </p>
        <p className={`mt-2 text-2xl font-bold ${magnitudeColorClass(tone)}`}>
          {value}
        </p>
        {note ? <p className="mt-2 text-xs text-white/60">{note}</p> : null}
      </div>
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
      className={`min-h-[112px] rounded-md p-3 text-left text-white shadow-sm transition hover:bg-black/25 ${
        isFocused
          ? "border-2 border-white/90 bg-black/30 backdrop-blur-lg"
          : "border-2 border-white/40 bg-black/20 backdrop-blur-md"
      }`}
      onClick={onClick}
      type="button"
    >
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-white/90">
        {weekday}
      </p>
      <p className="mt-1 text-2xl font-semibold text-white">{date.getUTCDate()}</p>
      <p className="mt-4 text-sm font-semibold text-white">
        {day.totals.calories.toLocaleString()} cal
      </p>
      {deviation === null ? (
        <p className="mt-1 text-xs font-semibold text-white/60">No target</p>
      ) : (
        <p className={`mt-1 text-xs font-semibold ${magnitudeColorClass(tone)}`}>
          {formatSignedCalories(deviation)}
        </p>
      )}
    </button>
  );
}

function FocusedDayHeader({ day }: { day: CalDay }) {
  const date = new Date(`${day.date}T00:00:00.000Z`);
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
          Focused day
        </p>
        <h2 className="mt-1 text-xl font-semibold text-white">{label}</h2>
      </div>
      <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm font-semibold text-white/80">
        {day.entries.length} entries
      </span>
    </div>
  );
}

function MealEntryForm({
  disabled,
  focusedDay,
  mealForm,
  onMealFormChange,
  onSubmit,
}: {
  disabled: boolean;
  focusedDay: CalDay;
  mealForm: MealFormState;
  onMealFormChange: (form: MealFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="mt-4 rounded-md border border-white/15 bg-black/20 p-3" onSubmit={onSubmit}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">Add to {focusedDay.date}</p>
        {mealForm.savedFoodId ? (
          <span className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-200">
            Saved food
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextInput
          className="lg:col-span-2"
          label="Meal"
          onChange={(value) => onMealFormChange({ ...mealForm, mealName: value })}
          placeholder="Chicken bowl"
          value={mealForm.mealName}
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
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/20"
          disabled={disabled || !mealForm.calories.trim()}
          type="submit"
        >
          Log entry
        </button>
        <button
          className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
          disabled={disabled}
          onClick={() => onMealFormChange(emptyMealForm)}
          type="button"
        >
          Clear
        </button>
      </div>
    </form>
  );
}

function FoodEntryRow({
  disabled,
  entry,
  onDelete,
}: {
  disabled: boolean;
  entry: FoodEntry;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-white/15 bg-black/20 p-3 text-white backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold">{entry.mealName || "Food entry"}</p>
        <p className="text-sm text-white/70">
          {entry.calories.toLocaleString()} cal
          {formatMacros(entry)}
        </p>
      </div>
      <button
        className="self-start rounded-md border border-red-300/60 bg-red-500/15 px-3 py-1.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
        disabled={disabled}
        onClick={() => onDelete(entry.id)}
        type="button"
      >
        Delete
      </button>
    </div>
  );
}

function DayTotalLine({
  label,
  target,
  thresholds,
  unit,
  value,
}: {
  label: string;
  target: number | null;
  thresholds: { green: number; amber: number };
  unit: string;
  value: number;
}) {
  const deviation = dailyDeviation(value, target);
  const tone = colorToneFromMagnitude(deviation, thresholds);

  return (
    <div className="rounded-md border border-white/15 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white/70">{label}</p>
        <p className="font-bold text-white">
          {value.toLocaleString()} {unit}
        </p>
      </div>
      {deviation === null ? null : (
        <p className={`mt-1 text-xs font-semibold ${magnitudeColorClass(tone)}`}>
          {formatSignedValue(deviation, unit)} from target
        </p>
      )}
    </div>
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
  const isToday = day.date === todayIso;

  return (
    <section className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        Weight
      </p>
      {isToday ? (
        <form className="mt-3 flex gap-2" onSubmit={onSubmit}>
          <label className="min-w-0 flex-1 text-sm font-semibold text-white/80">
            Today
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
      ) : (
        <p className="mt-3 rounded-md border border-white/15 bg-black/20 p-3 text-sm text-white/75">
          {day.weight ? `${day.weight.weightLbs.toFixed(1)} lbs` : "No weight logged"}
        </p>
      )}
    </section>
  );
}

function TargetsPanel({
  disabled,
  onSubmit,
  setTargetForm,
  targetForm,
  targets,
}: {
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setTargetForm: (form: TargetFormState) => void;
  targetForm: TargetFormState;
  targets: CalTargets;
}) {
  return (
    <section className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        Targets
      </p>
      <h2 className="mt-1 text-xl font-semibold text-white">
        {targets.tdeeCalories ? `${targets.tdeeCalories.toLocaleString()} calories` : "Set your TDEE"}
      </h2>
      <details className="mt-4 rounded-md border border-white/15 bg-black/20 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-white">
          Edit targets
        </summary>
        <form className="mt-3 grid gap-3" onSubmit={onSubmit}>
          <NumberInput
            label="Daily calories"
            onChange={(value) => setTargetForm({ ...targetForm, tdeeCalories: value })}
            value={targetForm.tdeeCalories}
          />
          <div className="grid grid-cols-3 gap-2">
            <NumberInput
              label="Protein"
              onChange={(value) => setTargetForm({ ...targetForm, proteinTargetG: value })}
              suffix="g"
              value={targetForm.proteinTargetG}
            />
            <NumberInput
              label="Carbs"
              onChange={(value) => setTargetForm({ ...targetForm, carbsTargetG: value })}
              suffix="g"
              value={targetForm.carbsTargetG}
            />
            <NumberInput
              label="Fat"
              onChange={(value) => setTargetForm({ ...targetForm, fatTargetG: value })}
              suffix="g"
              value={targetForm.fatTargetG}
            />
          </div>
          <button
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/20"
            disabled={disabled}
            type="submit"
          >
            Save targets
          </button>
        </form>
      </details>
    </section>
  );
}

function SavedFoodsList({
  disabled,
  onArchive,
  onFill,
  savedFoods,
}: {
  disabled: boolean;
  onArchive: (id: string) => void;
  onFill: (food: SavedFood) => void;
  savedFoods: SavedFood[];
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        Saved foods
      </p>
      <h2 className="mt-1 text-xl font-semibold text-white">Quick log</h2>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {savedFoods.length > 0 ? (
          savedFoods.map((food) => (
            <SavedFoodRow
              disabled={disabled}
              food={food}
              key={food.id}
              onArchive={onArchive}
              onFill={onFill}
            />
          ))
        ) : (
          <p className="rounded-md border border-dashed border-white/20 bg-black/15 p-4 text-sm text-white/70 md:col-span-2">
            Save foods you repeat often, then use them to prefill the log.
          </p>
        )}
      </div>
    </div>
  );
}

function SavedFoodRow({
  disabled,
  food,
  onArchive,
  onFill,
}: {
  disabled: boolean;
  food: SavedFood;
  onArchive: (id: string) => void;
  onFill: (food: SavedFood) => void;
}) {
  return (
    <div className="rounded-md border border-white/15 bg-black/20 p-3 text-white backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{food.name}</p>
          <p className="text-sm text-white/70">
            {food.calories.toLocaleString()} cal
            {formatMacros(food)}
          </p>
        </div>
        <button
          className="rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onClick={() => onFill(food)}
          type="button"
        >
          Log this
        </button>
      </div>
      <button
        className="mt-2 text-xs font-semibold text-white/60 transition hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={() => onArchive(food.id)}
        type="button"
      >
        Archive
      </button>
    </div>
  );
}

function SavedFoodForm({
  disabled,
  form,
  onChange,
  onSubmit,
}: {
  disabled: boolean;
  form: SavedFoodFormState;
  onChange: (form: SavedFoodFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="rounded-md border border-white/15 bg-black/20 p-3" onSubmit={onSubmit}>
      <p className="text-sm font-semibold text-white">Create saved food</p>
      <div className="mt-3 grid gap-2">
        <TextInput
          label="Name"
          onChange={(value) => onChange({ ...form, name: value })}
          placeholder="Greek yogurt"
          value={form.name}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Calories"
            onChange={(value) => onChange({ ...form, calories: value })}
            required
            value={form.calories}
          />
          <NumberInput
            label="Protein"
            onChange={(value) => onChange({ ...form, proteinG: value })}
            suffix="g"
            value={form.proteinG}
          />
          <NumberInput
            label="Carbs"
            onChange={(value) => onChange({ ...form, carbsG: value })}
            suffix="g"
            value={form.carbsG}
          />
          <NumberInput
            label="Fat"
            onChange={(value) => onChange({ ...form, fatG: value })}
            suffix="g"
            value={form.fatG}
          />
        </div>
        <button
          className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled || !form.name.trim() || !form.calories.trim()}
          type="submit"
        >
          Save food
        </button>
      </div>
    </form>
  );
}

function TextInput({
  className = "",
  label,
  onChange,
  placeholder,
  value,
}: {
  className?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className={`block text-sm font-semibold text-white/80 ${className}`}>
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-white/20 bg-black/25 px-3 text-sm text-white outline-none transition placeholder:text-white/50 focus:border-white/60 focus:ring-2 focus:ring-white/40"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="text"
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

function formatMacros(entry: {
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}): string {
  const parts = [
    entry.proteinG === null ? null : `${entry.proteinG}p`,
    entry.carbsG === null ? null : `${entry.carbsG}c`,
    entry.fatG === null ? null : `${entry.fatG}f`,
  ].filter(Boolean);

  return parts.length > 0 ? ` · ${parts.join(" / ")}` : "";
}

function formatSignedCalories(value: number): string {
  return `${formatSignedNumber(value, 0)} cal`;
}

function formatSignedValue(value: number, unit: string): string {
  return `${formatSignedNumber(value, 0)} ${unit}`;
}

function formatSignedNumber(value: number, digits: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })}`;
}
