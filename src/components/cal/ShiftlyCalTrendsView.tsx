"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState, useTransition } from "react";

import {
  archiveSavedFoodAction,
  createSavedFoodAction,
  saveCalTargetsAction,
} from "@/app/(protected)/cal/actions";
import { categoryBarClass, categoryLabel } from "@/lib/cal/color";
import type { CalTrendDay, ShiftlyCalTrendsData } from "@/lib/cal/data";
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
  sodiumMg: string;
  addedSugarG: string;
  saturatedFatG: string;
};

type TargetFormState = {
  tdeeCalories: string;
  proteinTargetG: string;
  carbsTargetG: string;
  fatTargetG: string;
  fiberTargetG: string;
  sodiumTargetMg: string;
  addedSugarTargetG: string;
  saturatedFatTargetG: string;
  waterTargetOz: string;
};

const emptySavedFoodForm: SavedFoodFormState = {
  name: "",
  category: "meal",
  calories: "",
  proteinG: "",
  carbsG: "",
  fatG: "",
  fiberG: "",
  sodiumMg: "",
  addedSugarG: "",
  saturatedFatG: "",
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
    sodiumTargetMg: initialData.targets.sodiumTargetMg?.toString() ?? "",
    addedSugarTargetG: initialData.targets.addedSugarTargetG?.toString() ?? "",
    saturatedFatTargetG: initialData.targets.saturatedFatTargetG?.toString() ?? "",
    waterTargetOz: initialData.targets.waterTargetOz?.toString() ?? "",
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
    <section className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
      <div className="h-2 bg-[var(--surface-elevated)]" />
      <div className="space-y-4 p-3 sm:p-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
            Week
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
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
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        Targets
      </p>
      <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
        Daily energy and macros
      </h2>
      <p className="mt-1 text-sm text-[var(--text-tertiary)]">
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
        <NumberInput
          label="Sodium target"
          onChange={(value) => onChange({ ...form, sodiumTargetMg: value })}
          suffix="mg"
          value={form.sodiumTargetMg}
        />
        <NumberInput
          label="Added sugar target"
          onChange={(value) => onChange({ ...form, addedSugarTargetG: value })}
          suffix="g"
          value={form.addedSugarTargetG}
        />
        <NumberInput
          label="Sat fat target"
          onChange={(value) => onChange({ ...form, saturatedFatTargetG: value })}
          suffix="g"
          value={form.saturatedFatTargetG}
        />
        <NumberInput
          label="Water target"
          onChange={(value) => onChange({ ...form, waterTargetOz: value })}
          suffix="oz"
          value={form.waterTargetOz}
        />
        <div className="sm:col-span-2">
          <button
            className="rounded-md bg-[var(--surface-base)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-hover)]"
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
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        Saved foods
      </p>
      <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Manage quick logs</h2>
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
        <NumberInput
          label="Sodium"
          onChange={(value) => onChange({ ...form, sodiumMg: value })}
          suffix="mg"
          value={form.sodiumMg}
        />
        <NumberInput
          label="Added sugar"
          onChange={(value) => onChange({ ...form, addedSugarG: value })}
          suffix="g"
          value={form.addedSugarG}
        />
        <NumberInput
          label="Sat fat"
          onChange={(value) => onChange({ ...form, saturatedFatG: value })}
          suffix="g"
          value={form.saturatedFatG}
        />
        <div className="sm:col-span-2 xl:col-span-3">
          <button
            className="rounded-md bg-[var(--surface-base)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-hover)]"
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
          <p className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--text-secondary)]">
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
          <p className="text-sm text-[var(--text-secondary)]">
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
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        28-day history
      </p>
      <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Daily trend rows</h2>
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
  return (
    <div className="grid gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-sm text-[var(--text-primary)]">
      <div>
        <p className="font-semibold">{formatDayLabel(day.date)}</p>
        <p className="text-xs text-[var(--text-tertiary)]">{day.date}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <TrendMetric
          kind="limit"
          label="Cal"
          target={targets.tdeeCalories}
          unit="cal"
          value={day.calories}
        />
        <TrendMetric
          kind="goal"
          label="Protein"
          target={targets.proteinTargetG}
          unit="g"
          value={day.proteinG}
        />
        <TrendMetric
          kind="goal"
          label="Fiber"
          target={targets.fiberTargetG}
          unit="g"
          value={day.fiberG}
        />
        <TrendMetric
          kind="goal"
          label="Water"
          target={targets.waterTargetOz}
          unit="oz"
          value={day.waterOz}
        />
      </div>
      <p className="text-[var(--text-secondary)]">
        {day.weightLbs === null ? "No weight" : `${day.weightLbs.toFixed(1)} lbs`}
      </p>
    </div>
  );
}

type TrendMetricKind = "limit" | "goal";

function TrendMetric({
  kind,
  label,
  target,
  unit,
  value,
}: {
  kind: TrendMetricKind;
  label: string;
  target: number | null;
  unit: string;
  value: number;
}) {
  const state = trendMetricState(value, target, kind);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-bold ${trendTextClass(state.tone)}`}>
          {label}
        </span>
        <span className={`text-xs font-bold ${trendTextClass(state.tone)}`}>
          {target === null
            ? `${value.toLocaleString()} ${unit}`
            : `${value.toLocaleString()}/${target.toLocaleString()}`}
        </span>
      </div>
      {target !== null ? (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-elevated)]">
          <div
            className={`h-1.5 rounded-full ${trendFillClass(state.tone)}`}
            style={{ width: `${state.barPct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function WeightLogWeek({ days }: { days: CalDay[] }) {
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        Weight log
      </p>
      <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">This week</h2>
      <div className="mt-4 grid gap-2">
        {days.map((day) => (
          <div
            className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-sm text-[var(--text-primary)]"
            key={day.date}
          >
            <span className="font-semibold">{formatDayLabel(day.date)}</span>
            <span className="text-[var(--text-secondary)]">
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
    <label className="block text-sm font-semibold text-[var(--text-secondary)]">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white/40"
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
    <label className={`block text-sm font-semibold text-[var(--text-secondary)] ${className}`}>
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white/40"
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
    <label className="block text-sm font-semibold text-[var(--text-secondary)]">
      {label}
      <span className="relative mt-1 block">
        <input
          className="h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white/40"
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
  sodiumMg: number | null;
  addedSugarG: number | null;
  saturatedFatG: number | null;
}): string {
  const macros = [
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

  return macros ? ` - ${macros}` : "";
}

function trendMetricState(
  value: number,
  target: number | null,
  kind: TrendMetricKind,
) {
  if (target === null || target <= 0) {
    return { barPct: 0, tone: "neutral" as const };
  }

  const ratio = value / target;
  const barPct = Math.min(100, Math.round(ratio * 100));

  if (kind === "goal") {
    if (value >= target) return { barPct, tone: "green" as const };
    if (ratio >= 0.9) return { barPct, tone: "amber" as const };
    return { barPct, tone: "red" as const };
  }

  if (value <= target) return { barPct, tone: "green" as const };
  if (value <= target * 1.1) return { barPct, tone: "amber" as const };
  return { barPct, tone: "red" as const };
}

function trendTextClass(tone: "green" | "amber" | "red" | "neutral"): string {
  switch (tone) {
    case "green":
      return "text-[var(--accent-primary-text)]";
    case "amber":
      return "text-[var(--accent-warning-text)]";
    case "red":
      return "text-red-300";
    case "neutral":
      return "text-[var(--text-secondary)]";
  }
}

function trendFillClass(tone: "green" | "amber" | "red" | "neutral"): string {
  switch (tone) {
    case "green":
      return "bg-[var(--accent-primary-text)]";
    case "amber":
      return "bg-[var(--accent-warning-text)]";
    case "red":
      return "bg-red-300";
    case "neutral":
      return "bg-[var(--surface-hover)]";
  }
}
