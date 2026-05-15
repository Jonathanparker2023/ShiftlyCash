"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState, useTransition } from "react";

import {
  archiveSavedFoodAction,
  createSavedFoodAction,
  saveCalTargetsAction,
} from "@/app/(protected)/cal/actions";
import { categoryBarClass, categoryLabel, magnitudeColorClass } from "@/lib/cal/color";
import type { CalTrendDay, ShiftlyCalTrendsData } from "@/lib/cal/data";
import {
  colorToneFromMagnitude,
  dailyDeviation,
  DAILY_CALORIE_THRESHOLDS,
} from "@/lib/cal/projection";
import type {
  CalDay,
  CalTargets,
  FoodCategory,
  SavedFood,
} from "@/lib/cal/types";

type SavedFoodFormState = {
  name: string;
  category: FoodCategory;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  fiberG: string;
};

type TargetFormState = {
  tdeeCalories: string;
  proteinTargetG: string;
  carbsTargetG: string;
  fatTargetG: string;
  fiberTargetG: string;
};

const emptySavedFoodForm: SavedFoodFormState = {
  name: "",
  category: "meal",
  calories: "",
  proteinG: "",
  carbsG: "",
  fatG: "",
  fiberG: "",
};

const FOOD_CATEGORY_OPTIONS: Array<{ value: FoodCategory; label: string }> = [
  { value: "meal", label: "Meal" },
  { value: "healthy_snack", label: "Healthy snack" },
  { value: "unhealthy_snack", label: "Unhealthy snack" },
  { value: "drink", label: "Drink" },
  { value: "other", label: "Other" },
];

export function ShiftlyCalTrendsView({
  initialData,
  weekStartIso,
}: {
  initialData: ShiftlyCalTrendsData;
  weekStartIso: string;
}) {
  const router = useRouter();
  const [savedFoodForm, setSavedFoodForm] =
    useState<SavedFoodFormState>(emptySavedFoodForm);
  const [targetForm, setTargetForm] = useState<TargetFormState>({
    tdeeCalories: initialData.targets.tdeeCalories?.toString() ?? "",
    proteinTargetG: initialData.targets.proteinTargetG?.toString() ?? "",
    carbsTargetG: initialData.targets.carbsTargetG?.toString() ?? "",
    fatTargetG: initialData.targets.fatTargetG?.toString() ?? "",
    fiberTargetG: initialData.targets.fiberTargetG?.toString() ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

  function submitSavedFood(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        await createSavedFoodAction(savedFoodForm);
        setSavedFoodForm(emptySavedFoodForm);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to create saved food.");
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

  return (
    <section className="overflow-hidden rounded-xl border border-white/15 bg-black/5 shadow-[0_24px_70px_rgba(8,15,28,0.22)] backdrop-blur-[1px]">
      <div className="h-2 bg-white/10" />
      <div className="space-y-4 p-3 sm:p-4">
        <div className="rounded-lg border border-white/15 bg-black/15 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-md">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
            Week
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {formatDayLabel(weekStartIso)} - {formatDayLabel(initialData.currentWeek.weekEndIso)}
          </h2>
        </div>

        {error ? (
          <p className="rounded-md border border-red-300/60 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-200">
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
          <TargetsPanel
            disabled={isPending}
            form={targetForm}
            onChange={setTargetForm}
            onSubmit={submitTargets}
            targets={initialData.targets}
          />
          <SavedFoodsManagement
            disabled={isPending}
            form={savedFoodForm}
            onArchive={archiveSavedFood}
            onChange={setSavedFoodForm}
            onSubmit={submitSavedFood}
            savedFoods={initialData.savedFoods}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]">
          <TrendHistoryStrip
            trendDays={initialData.trendDays}
            targets={initialData.targets}
          />
          <WeightLogWeek days={initialData.currentWeek.days} />
        </div>
      </div>
    </section>
  );
}

function TargetsPanel({
  disabled,
  form,
  onChange,
  onSubmit,
  targets,
}: {
  disabled: boolean;
  form: TargetFormState;
  onChange: (form: TargetFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  targets: CalTargets;
}) {
  return (
    <section className="rounded-lg border border-white/15 bg-black/15 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-md">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        Targets
      </p>
      <h2 className="mt-1 text-xl font-semibold text-white">
        Daily energy and macros
      </h2>
      <p className="mt-1 text-sm text-white/65">
        Current TDEE: {targets.tdeeCalories?.toLocaleString() ?? "--"} cal
      </p>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
        <NumberInput
          label="TDEE"
          onChange={(value) => onChange({ ...form, tdeeCalories: value })}
          suffix="cal"
          value={form.tdeeCalories}
        />
        <NumberInput
          label="Protein target"
          onChange={(value) => onChange({ ...form, proteinTargetG: value })}
          suffix="g"
          value={form.proteinTargetG}
        />
        <NumberInput
          label="Carbs target"
          onChange={(value) => onChange({ ...form, carbsTargetG: value })}
          suffix="g"
          value={form.carbsTargetG}
        />
        <NumberInput
          label="Fat target"
          onChange={(value) => onChange({ ...form, fatTargetG: value })}
          suffix="g"
          value={form.fatTargetG}
        />
        <NumberInput
          label="Fiber target"
          onChange={(value) => onChange({ ...form, fiberTargetG: value })}
          suffix="g"
          value={form.fiberTargetG}
        />
        <div className="sm:col-span-2">
          <button
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/20"
            disabled={disabled}
            type="submit"
          >
            Save targets
          </button>
        </div>
      </form>
    </section>
  );
}

function SavedFoodsManagement({
  disabled,
  form,
  onArchive,
  onChange,
  onSubmit,
  savedFoods,
}: {
  disabled: boolean;
  form: SavedFoodFormState;
  onArchive: (id: string) => void;
  onChange: (form: SavedFoodFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  savedFoods: SavedFood[];
}) {
  return (
    <section className="rounded-lg border border-white/15 bg-black/15 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-md">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        Saved foods
      </p>
      <h2 className="mt-1 text-xl font-semibold text-white">Manage quick logs</h2>
      <form className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" onSubmit={onSubmit}>
        <TextInput
          className="sm:col-span-2 xl:col-span-1"
          label="Name"
          onChange={(value) => onChange({ ...form, name: value })}
          placeholder="Greek yogurt"
          value={form.name}
        />
        <CategorySelect
          label="Category"
          onChange={(category) => onChange({ ...form, category })}
          value={form.category}
        />
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
        <NumberInput
          label="Fiber"
          onChange={(value) => onChange({ ...form, fiberG: value })}
          suffix="g"
          value={form.fiberG}
        />
        <div className="sm:col-span-2 xl:col-span-3">
          <button
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/20"
            disabled={disabled || !form.name.trim() || !form.calories.trim()}
            type="submit"
          >
            Create saved food
          </button>
        </div>
      </form>

      <div className="mt-4 grid gap-2">
        {savedFoods.length > 0 ? (
          savedFoods.map((food) => (
            <SavedFoodManageRow
              disabled={disabled}
              food={food}
              key={food.id}
              onArchive={onArchive}
            />
          ))
        ) : (
          <p className="rounded-md border border-dashed border-white/20 bg-black/15 p-4 text-sm text-white/70">
            No saved foods yet.
          </p>
        )}
      </div>
    </section>
  );
}

function SavedFoodManageRow({
  disabled,
  food,
  onArchive,
}: {
  disabled: boolean;
  food: SavedFood;
  onArchive: (id: string) => void;
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
          className="rounded-md border border-red-300/60 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onClick={() => onArchive(food.id)}
          type="button"
        >
          Archive
        </button>
      </div>
    </div>
  );
}

function TrendHistoryStrip({
  trendDays,
  targets,
}: {
  trendDays: CalTrendDay[];
  targets: CalTargets;
}) {
  return (
    <section className="rounded-lg border border-white/15 bg-black/15 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-md">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        28-day history
      </p>
      <h2 className="mt-1 text-xl font-semibold text-white">Daily trend rows</h2>
      <div className="mt-4 max-h-[34rem] overflow-y-auto pr-1">
        <div className="grid gap-2">
        {[...trendDays].reverse().map((day) => (
          <TrendHistoryRow day={day} key={day.date} targets={targets} />
        ))}
        </div>
      </div>
    </section>
  );
}

function TrendHistoryRow({
  day,
  targets,
}: {
  day: CalTrendDay;
  targets: CalTargets;
}) {
  const deviation = dailyDeviation(day.calories, targets.tdeeCalories);
  const tone = colorToneFromMagnitude(deviation, DAILY_CALORIE_THRESHOLDS);

  return (
    <div className="grid gap-2 rounded-md border border-white/15 bg-black/20 p-3 text-sm text-white sm:grid-cols-[minmax(150px,1fr)_repeat(4,minmax(80px,0.4fr))] sm:items-center">
      <div>
        <p className="font-semibold">{formatDayLabel(day.date)}</p>
        <p className="text-xs text-white/60">{day.date}</p>
      </div>
      <p className={`font-semibold ${magnitudeColorClass(tone)}`}>
        {day.calories.toLocaleString()} cal
      </p>
      <p className="text-white/80">{day.proteinG.toLocaleString()}g protein</p>
      <p className="text-white/80">{day.fiberG.toLocaleString()}g fiber</p>
      <p className="text-white/80">
        {day.weightLbs === null ? "No weight" : `${day.weightLbs.toFixed(1)} lbs`}
      </p>
    </div>
  );
}

function WeightLogWeek({ days }: { days: CalDay[] }) {
  return (
    <section className="rounded-lg border border-white/15 bg-black/15 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-md">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        Weight log
      </p>
      <h2 className="mt-1 text-xl font-semibold text-white">This week</h2>
      <div className="mt-4 grid gap-2">
        {days.map((day) => (
          <div
            className="flex items-center justify-between rounded-md border border-white/15 bg-black/20 p-3 text-sm text-white"
            key={day.date}
          >
            <span className="font-semibold">{formatDayLabel(day.date)}</span>
            <span className="text-white/80">
              {day.weight ? `${day.weight.weightLbs.toFixed(1)} lbs` : "--"}
            </span>
          </div>
        ))}
      </div>
    </section>
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

function formatDayLabel(dateIso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(`${dateIso}T00:00:00.000Z`));
}

function formatMacros(entry: {
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
}): string {
  const macros = [
    entry.proteinG === null ? null : `${entry.proteinG}p`,
    entry.carbsG === null ? null : `${entry.carbsG}c`,
    entry.fatG === null ? null : `${entry.fatG}f`,
    entry.fiberG === null ? null : `${entry.fiberG}fi`,
  ]
    .filter(Boolean)
    .join(" / ");

  return macros ? ` - ${macros}` : "";
}
