"use client";

import { useMemo, useState } from "react";

import { saveDefaultTemplateAction } from "@/app/(protected)/settings/template/actions";
import type { JobType, PayType } from "@/lib/domain/pay";
import type {
  TemplateDayDraft,
  TemplateEditorData,
  TemplateSlotDraft,
} from "@/lib/template/types";

const JOB_OPTIONS: JobType[] = [
  "none",
  "ability",
  "prestige",
  "incentive",
  "other",
];
const PAY_OPTIONS: PayType[] = ["none", "regular", "overtime", "unit"];

type SaveState = "idle" | "saving" | "saved" | "error";

type TemplateEditorProps = {
  initialData: TemplateEditorData;
};

export function TemplateEditor({ initialData }: TemplateEditorProps) {
  const [days, setDays] = useState(initialData.days);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const filledSlotCount = useMemo(
    () =>
      days
        .flatMap((day) => day.slots)
        .filter((slot) => slot.jobType !== "none" && slot.hoursOrUnits > 0)
        .length,
    [days],
  );

  function updateSlot(
    dayIndex: number,
    slotIndex: number,
    patch: Partial<TemplateSlotDraft>,
  ) {
    setDays((currentDays) =>
      currentDays.map((day) => {
        if (day.dayIndex !== dayIndex) {
          return day;
        }

        return {
          ...day,
          slots: day.slots.map((slot) =>
            slot.slotIndex === slotIndex
              ? normalizeSlot({ ...slot, ...patch })
              : slot,
          ),
        };
      }),
    );
    setSaveState("idle");
    setSaveError(null);
  }

  async function saveTemplate() {
    setSaveState("saving");
    setSaveError(null);

    try {
      const result = await saveDefaultTemplateAction({
        slots: days.flatMap((day) => day.slots),
      });

      setSaveState("saved");
      setSaveError(`Saved ${result.savedCount} template slots.`);
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Save failed.");
    }
  }

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Weekly shape</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {filledSlotCount} active slots across the default week.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SaveStatus state={saveState} message={saveError} />
          <button
            className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saveState === "saving"}
            onClick={saveTemplate}
            type="button"
          >
            {saveState === "saving" ? "Saving..." : "Save"}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-4 lg:flex-row lg:overflow-x-auto lg:pb-2">
        {days.map((day) => (
          <TemplateDayCard day={day} key={day.dayIndex} onChange={updateSlot} />
        ))}
      </section>
    </div>
  );
}

function TemplateDayCard({
  day,
  onChange,
}: {
  day: TemplateDayDraft;
  onChange: (
    dayIndex: number,
    slotIndex: number,
    patch: Partial<TemplateSlotDraft>,
  ) => void;
}) {
  return (
    <article className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm lg:min-w-[320px] lg:flex-1">
      <h2 className="text-lg font-semibold">{day.label}</h2>
      <div className="mt-4 space-y-3">
        {day.slots.map((slot) => (
          <TemplateSlotRow key={slot.slotIndex} slot={slot} onChange={onChange} />
        ))}
      </div>
    </article>
  );
}

function TemplateSlotRow({
  slot,
  onChange,
}: {
  slot: TemplateSlotDraft;
  onChange: (
    dayIndex: number,
    slotIndex: number,
    patch: Partial<TemplateSlotDraft>,
  ) => void;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 sm:grid-cols-[1fr_1fr_84px]">
      <select
        className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
        onChange={(event) =>
          onChange(slot.dayIndex, slot.slotIndex, {
            jobType: event.target.value as JobType,
          })
        }
        value={slot.jobType}
      >
        {JOB_OPTIONS.map((jobType) => (
          <option key={jobType} value={jobType}>
            {jobType}
          </option>
        ))}
      </select>

      <select
        className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
        onChange={(event) =>
          onChange(slot.dayIndex, slot.slotIndex, {
            payType: event.target.value as PayType,
          })
        }
        value={slot.payType}
      >
        {PAY_OPTIONS.map((payType) => (
          <option key={payType} value={payType}>
            {payType}
          </option>
        ))}
      </select>

      <input
        className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
        min="0"
        onChange={(event) =>
          onChange(slot.dayIndex, slot.slotIndex, {
            hoursOrUnits: parsePositiveNumber(event.target.value),
          })
        }
        step="0.25"
        type="number"
        value={slot.hoursOrUnits}
      />
    </div>
  );
}

function SaveStatus({
  state,
  message,
}: {
  state: SaveState;
  message: string | null;
}) {
  const label =
    state === "saving"
      ? "Saving..."
      : state === "saved"
        ? message
        : state === "error"
          ? message
          : "Unsaved changes save manually";

  return (
    <p
      className={
        state === "error"
          ? "max-w-64 text-right text-sm font-medium text-red-700"
          : "max-w-64 text-right text-sm font-medium text-zinc-600"
      }
    >
      {label}
    </p>
  );
}

function normalizeSlot(slot: TemplateSlotDraft): TemplateSlotDraft {
  if (slot.jobType === "none") {
    return {
      ...slot,
      payType: "none",
      hoursOrUnits: 0,
    };
  }

  if (slot.jobType === "incentive" || slot.jobType === "other") {
    return {
      ...slot,
      payType: "unit",
      hoursOrUnits: Math.max(0, slot.hoursOrUnits),
    };
  }

  return {
    ...slot,
    payType:
      slot.payType === "regular" || slot.payType === "overtime"
        ? slot.payType
        : "regular",
    hoursOrUnits: Math.max(0, slot.hoursOrUnits),
  };
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
