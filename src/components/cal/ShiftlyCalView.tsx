"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useMemo, useState, useTransition } from "react";

import {
  archiveSavedFoodAction,
  createFoodEntryAction,
  createSavedFoodAction,
  deleteFoodEntryAction,
  saveCalTargetsAction,
} from "@/app/(protected)/cal/actions";
import type { FoodEntry, SavedFood, ShiftlyCalData } from "@/lib/cal/types";

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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const totals = useMemo(
    () => calculateTotals(initialData.todaysEntries),
    [initialData.todaysEntries],
  );

  function submitMeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        await createFoodEntryAction({
          date: initialData.todayIso,
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
      <section className="space-y-4">
        <form
          className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md"
          onSubmit={submitMeal}
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                Today
              </p>
              <h2 className="text-xl font-semibold text-white">Log food</h2>
            </div>
            <p className="text-sm font-semibold text-white/80">{initialData.todayIso}</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <TextInput
              className="lg:col-span-2"
              label="Meal"
              onChange={(value) =>
                setMealForm((current) => ({ ...current, mealName: value }))
              }
              placeholder="Chicken bowl"
              value={mealForm.mealName}
            />
            <NumberInput
              label="Calories"
              onChange={(value) =>
                setMealForm((current) => ({ ...current, calories: value }))
              }
              required
              value={mealForm.calories}
            />
            <NumberInput
              label="Protein"
              onChange={(value) =>
                setMealForm((current) => ({ ...current, proteinG: value }))
              }
              suffix="g"
              value={mealForm.proteinG}
            />
            <NumberInput
              label="Carbs"
              onChange={(value) =>
                setMealForm((current) => ({ ...current, carbsG: value }))
              }
              suffix="g"
              value={mealForm.carbsG}
            />
            <NumberInput
              label="Fat"
              onChange={(value) =>
                setMealForm((current) => ({ ...current, fatG: value }))
              }
              suffix="g"
              value={mealForm.fatG}
            />
          </div>

          {mealForm.savedFoodId ? (
            <p className="mt-3 rounded-md border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              Filled from a saved food. Edit anything before logging.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/20"
              disabled={isPending || !mealForm.calories.trim()}
              type="submit"
            >
              Log entry
            </button>
            <button
              className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
              disabled={isPending}
              onClick={() => setMealForm(emptyMealForm)}
              type="button"
            >
              Clear
            </button>
          </div>
        </form>

        {error ? (
          <p className="rounded-md border border-red-300/60 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-200">
            {error}
          </p>
        ) : null}

        <section className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                Logged today
              </p>
              <h2 className="text-xl font-semibold text-white">
                {totals.calories.toLocaleString()} calories
              </h2>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <MacroStat label="Protein" value={totals.proteinG} />
              <MacroStat label="Carbs" value={totals.carbsG} />
              <MacroStat label="Fat" value={totals.fatG} />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {initialData.todaysEntries.length > 0 ? (
              initialData.todaysEntries.map((entry) => (
                <FoodEntryRow
                  disabled={isPending}
                  entry={entry}
                  key={entry.id}
                  onDelete={deleteEntry}
                />
              ))
            ) : (
              <div className="rounded-md border border-dashed border-white/20 bg-black/15 p-6 text-center text-sm text-white/70">
                No food logged yet today.
              </div>
            )}
          </div>
        </section>
      </section>

      <aside className="space-y-4">
        <section className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
              Targets
            </p>
            <h2 className="text-xl font-semibold text-white">
              {initialData.targets.tdeeCalories
                ? `${initialData.targets.tdeeCalories.toLocaleString()} calories`
                : "Set your targets"}
            </h2>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
            <TargetStat label="Protein" value={initialData.targets.proteinTargetG} />
            <TargetStat label="Carbs" value={initialData.targets.carbsTargetG} />
            <TargetStat label="Fat" value={initialData.targets.fatTargetG} />
          </dl>

          <details className="mt-4 rounded-md border border-white/15 bg-black/20 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-white">
              Edit targets
            </summary>
            <form className="mt-3 grid gap-3" onSubmit={submitTargets}>
              <NumberInput
                label="Daily calories"
                onChange={(value) =>
                  setTargetForm((current) => ({ ...current, tdeeCalories: value }))
                }
                value={targetForm.tdeeCalories}
              />
              <div className="grid grid-cols-3 gap-2">
                <NumberInput
                  label="Protein"
                  onChange={(value) =>
                    setTargetForm((current) => ({ ...current, proteinTargetG: value }))
                  }
                  suffix="g"
                  value={targetForm.proteinTargetG}
                />
                <NumberInput
                  label="Carbs"
                  onChange={(value) =>
                    setTargetForm((current) => ({ ...current, carbsTargetG: value }))
                  }
                  suffix="g"
                  value={targetForm.carbsTargetG}
                />
                <NumberInput
                  label="Fat"
                  onChange={(value) =>
                    setTargetForm((current) => ({ ...current, fatTargetG: value }))
                  }
                  suffix="g"
                  value={targetForm.fatTargetG}
                />
              </div>
              <button
                className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/20"
                disabled={isPending}
                type="submit"
              >
                Save targets
              </button>
            </form>
          </details>
        </section>

        <section className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-md">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
              Saved foods
            </p>
            <h2 className="text-xl font-semibold text-white">Quick log</h2>
          </div>

          <div className="mt-4 space-y-2">
            {initialData.savedFoods.length > 0 ? (
              initialData.savedFoods.map((food) => (
                <SavedFoodRow
                  disabled={isPending}
                  food={food}
                  key={food.id}
                  onArchive={archiveSavedFood}
                  onFill={fillFromSavedFood}
                />
              ))
            ) : (
              <p className="rounded-md border border-dashed border-white/20 bg-black/15 p-4 text-sm text-white/70">
                Save foods you repeat often, then use them to prefill the log.
              </p>
            )}
          </div>

          <form
            className="mt-4 rounded-md border border-white/15 bg-black/20 p-3"
            onSubmit={submitSavedFood}
          >
            <p className="text-sm font-semibold text-white">Create saved food</p>
            <div className="mt-3 grid gap-2">
              <TextInput
                label="Name"
                onChange={(value) =>
                  setSavedFoodForm((current) => ({ ...current, name: value }))
                }
                placeholder="Greek yogurt"
                value={savedFoodForm.name}
              />
              <div className="grid grid-cols-2 gap-2">
                <NumberInput
                  label="Calories"
                  onChange={(value) =>
                    setSavedFoodForm((current) => ({ ...current, calories: value }))
                  }
                  required
                  value={savedFoodForm.calories}
                />
                <NumberInput
                  label="Protein"
                  onChange={(value) =>
                    setSavedFoodForm((current) => ({ ...current, proteinG: value }))
                  }
                  suffix="g"
                  value={savedFoodForm.proteinG}
                />
                <NumberInput
                  label="Carbs"
                  onChange={(value) =>
                    setSavedFoodForm((current) => ({ ...current, carbsG: value }))
                  }
                  suffix="g"
                  value={savedFoodForm.carbsG}
                />
                <NumberInput
                  label="Fat"
                  onChange={(value) =>
                    setSavedFoodForm((current) => ({ ...current, fatG: value }))
                  }
                  suffix="g"
                  value={savedFoodForm.fatG}
                />
              </div>
              <button
                className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending || !savedFoodForm.name.trim() || !savedFoodForm.calories.trim()}
                type="submit"
              >
                Save food
              </button>
            </div>
          </form>
        </section>
      </aside>
    </div>
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

function MacroStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/10 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">
        {label}
      </p>
      <p className="font-semibold text-white">{value}g</p>
    </div>
  );
}

function TargetStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/10 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">
        {label}
      </dt>
      <dd className="font-semibold text-white">{value === null ? "--" : `${value}g`}</dd>
    </div>
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

function calculateTotals(entries: FoodEntry[]) {
  return entries.reduce(
    (totals, entry) => ({
      calories: totals.calories + entry.calories,
      proteinG: totals.proteinG + (entry.proteinG ?? 0),
      carbsG: totals.carbsG + (entry.carbsG ?? 0),
      fatG: totals.fatG + (entry.fatG ?? 0),
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
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
