"use client";

import type { MealPlanAxioms } from "@/lib/cal/mealPlan/types";

type MealPlanAxiomBarProps = {
  axioms: MealPlanAxioms;
  disabled?: boolean;
  onChange: (axioms: MealPlanAxioms) => void;
};

export function MealPlanAxiomBar({
  axioms,
  disabled = false,
  onChange,
}: MealPlanAxiomBarProps) {
  function update(patch: Partial<MealPlanAxioms>) {
    onChange({ ...axioms, ...patch });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <SegmentedControl
        disabled={disabled}
        label="Mode"
        onChange={(value) => update({ eatOut: value === "out" })}
        options={[
          { label: "Eat out", value: "out" },
          { label: "Eat in", value: "in" },
        ]}
        value={axioms.eatOut ? "out" : "in"}
      />

      <label className="flex min-h-10 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">
        <input
          checked={axioms.requireDoorDash && axioms.eatOut}
          className="h-4 w-4 accent-[var(--accent-primary)] disabled:opacity-50"
          disabled={disabled || !axioms.eatOut}
          onChange={(event) =>
            update({
              requireDoorDash: event.target.checked,
              allowNonDoorDashMain: event.target.checked
                ? axioms.allowNonDoorDashMain
                : false,
            })
          }
          type="checkbox"
        />
        Require DoorDash
      </label>

      {axioms.eatOut && axioms.requireDoorDash ? (
        <label className="flex min-h-10 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">
          <input
            checked={axioms.allowNonDoorDashMain}
            className="h-4 w-4 accent-[var(--accent-primary)]"
            disabled={disabled}
            onChange={(event) =>
              update({ allowNonDoorDashMain: event.target.checked })
            }
            type="checkbox"
          />
          Allow non-DoorDash main
        </label>
      ) : null}

      <SegmentedControl
        disabled={disabled}
        label="Carbs"
        onChange={(value) =>
          update({
            carbMode:
              value === "high"
                ? "high"
                : value === "low"
                  ? "low"
                  : "indifferent",
          })
        }
        options={[
          { label: "High", value: "high" },
          { label: "Low", value: "low" },
          { label: "Any", value: "indifferent" },
        ]}
        value={axioms.carbMode}
      />

      {axioms.eatOut ? (
        <label className="min-w-[180px] flex-1 text-xs font-semibold text-[var(--text-tertiary)] sm:max-w-[240px]">
          Location
          <input
            className="mt-1 h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary-border)] focus:ring-2 focus:ring-[var(--accent-primary-fill)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onChange={(event) => update({ locationHint: event.target.value })}
            placeholder="Naugatuck, CT"
            value={axioms.locationHint ?? ""}
          />
        </label>
      ) : null}
    </div>
  );
}

type SegmentedControlProps = {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
};

function SegmentedControl({
  disabled,
  label,
  onChange,
  options,
  value,
}: SegmentedControlProps) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-[var(--text-tertiary)]">{label}</p>
      <div className="inline-flex rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              className={`min-h-8 rounded-full px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? "bg-[var(--accent-primary)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
              disabled={disabled}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
