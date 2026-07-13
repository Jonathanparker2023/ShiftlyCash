"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import { createContext, useContext, useMemo, useState } from "react";

import { saveDefaultTemplateAction } from "@/app/(protected)/settings/template/actions";
import { centsToDollars } from "@/lib/domain/money";
import { contrastText, darken } from "@/lib/domain/jobColor";
import type { IncentiveMode, JobType, PayType } from "@/lib/domain/pay";
import type { JobsData } from "@/lib/jobs/data";
import type {
  TemplateCustomJob,
  TemplateDayDraft,
  TemplateEditorData,
  TemplateSlotDraft,
} from "@/lib/template/types";

const JOB_OPTIONS: JobType[] = [
  "prestige",
  "prestige_ilst",
  "ability",
  "other",
];
const PAY_OPTIONS: PayType[] = ["regular", "overtime", "split"];

// Custom jobs available to the template picker, provided once at the top so the
// nested shift bars can read them without prop threading.
const CustomJobsContext = createContext<TemplateCustomJob[]>([]);
// Built-in job keys the user hid — dropped from the template job picker.
const HiddenBuiltinsContext = createContext<string[]>([]);
// Net pay rates (built-ins + custom jobs) so a shift bar can show the money it
// generates without threading jobsData through every nested component.
const RatesContext = createContext<JobsData | null>(null);

// Net cents/hr for a slot's job: custom jobs by id, built-ins by key (incentive
// variants ride the base job's rate). Returns null for non-wage jobs (other).
function slotRateCents(
  slot: TemplateSlotDraft,
  jobsData: JobsData | null,
): { reg: number; ot: number } | null {
  if (!jobsData) return null;
  if (slot.jobType === "custom") {
    const job = jobsData.customJobs.find((entry) => entry.id === slot.customJobId);
    return job ? { reg: job.regularRateCents, ot: job.otRateCents } : null;
  }
  const key =
    slot.jobType === "prestige" ||
    slot.jobType === "prestige_ilst" ||
    slot.jobType === "ability"
      ? slot.jobType
      : slot.jobType === "ability_incentive"
        ? "ability"
        : null;
  if (!key) return null;
  const builtin = jobsData.builtins.find((entry) => entry.key === key);
  return builtin ? { reg: builtin.regularRateCents, ot: builtin.otRateCents } : null;
}

// Net dollars (cents) a single template shift generates: hours × rate, splitting
// regular vs overtime the same way the dashboard pay engine does.
function slotNetCents(slot: TemplateSlotDraft, jobsData: JobsData | null): number {
  const rate = slotRateCents(slot, jobsData);
  if (!rate) return 0;
  let regular: number;
  let overtime: number;
  if (slot.payType === "split") {
    regular = slot.regularHours;
    overtime = slot.overtimeHours;
  } else if (slot.payType === "overtime") {
    regular = 0;
    overtime = slot.hoursOrUnits;
  } else {
    regular = slot.hoursOrUnits;
    overtime = 0;
  }
  return Math.round(regular * rate.reg + overtime * rate.ot);
}

// Hours a wage shift contributes (units-based jobs don't count toward hours).
function slotWageHours(slot: TemplateSlotDraft, jobsData: JobsData | null): number {
  return slotRateCents(slot, jobsData) ? Math.max(0, slot.hoursOrUnits) : 0;
}

function formatTemplateHours(hours: number): string {
  const rounded = Math.round(hours * 2) / 2;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}h`;
}

function formatTemplateMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(centsToDollars(cents)));
}
const INCENTIVE_MODE_OPTIONS: IncentiveMode[] = ["rate", "lump_sum"];

type SaveState = "idle" | "saving" | "saved" | "error";

type TemplateEditorProps = {
  initialData: TemplateEditorData;
  jobsData: JobsData | null;
};

export function TemplateEditor({ initialData, jobsData }: TemplateEditorProps) {
  const [days, setDays] = useState(initialData.days);
  const [focusedDayIndex, setFocusedDayIndex] = useState(() => {
    const firstWithShift = initialData.days.findIndex((day) =>
      day.slots.some((slot) => slot.jobType !== "none"),
    );
    return firstWithShift >= 0 ? firstWithShift : 0;
  });
  const [expandedSlotIndex, setExpandedSlotIndex] = useState<number | null>(
    null,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const filledSlotCount = useMemo(
    () =>
      days
        .flatMap((day) => day.slots)
        .filter((slot) => slot.jobType !== "none").length,
    [days],
  );

  // Week totals — hours and the net money the whole template generates per week.
  const { totalHours, totalNetCents } = useMemo(() => {
    let hours = 0;
    let cents = 0;
    for (const slot of days.flatMap((day) => day.slots)) {
      if (slot.jobType === "none") continue;
      hours += slotWageHours(slot, jobsData);
      cents += slotNetCents(slot, jobsData);
    }
    return { totalHours: hours, totalNetCents: cents };
  }, [days, jobsData]);

  const focusedDay = days[focusedDayIndex] ?? days[0];

  function updateSlot(
    dayIndex: number,
    slotIndex: number,
    patch: Partial<TemplateSlotDraft>,
  ) {
    setDays((currentDays) =>
      currentDays.map((day) =>
        day.dayIndex !== dayIndex
          ? day
          : {
              ...day,
              slots: day.slots.map((slot) =>
                slot.slotIndex === slotIndex
                  ? normalizeSlot({ ...slot, ...patch })
                  : slot,
              ),
            },
      ),
    );
    setSaveState("idle");
    setSaveError(null);
  }

  function addShift(dayIndex: number) {
    const day = days.find((current) => current.dayIndex === dayIndex);
    const empty = day?.slots.find((slot) => slot.jobType === "none");
    if (!empty) {
      return;
    }
    updateSlot(dayIndex, empty.slotIndex, {
      jobType: "prestige",
      payType: "regular",
      hoursOrUnits: 0,
    });
    setExpandedSlotIndex(empty.slotIndex);
  }

  function removeShift(dayIndex: number, slotIndex: number) {
    updateSlot(dayIndex, slotIndex, { jobType: "none" });
    setExpandedSlotIndex(null);
  }

  function reorderSlots(
    dayIndex: number,
    fromSlotIndex: number,
    toSlotIndex: number,
  ) {
    const day = days.find((current) => current.dayIndex === dayIndex);
    if (!day || fromSlotIndex === toSlotIndex) {
      return;
    }

    const activeSlots = day.slots
      .filter((slot) => slot.jobType !== "none")
      .sort((a, b) => a.slotIndex - b.slotIndex);
    const emptySlots = day.slots.filter((slot) => slot.jobType === "none");
    const fromPosition = activeSlots.findIndex(
      (slot) => slot.slotIndex === fromSlotIndex,
    );
    const toPosition = activeSlots.findIndex(
      (slot) => slot.slotIndex === toSlotIndex,
    );

    if (fromPosition < 0 || toPosition < 0 || fromPosition === toPosition) {
      return;
    }

    const reorderedActiveSlots = [...activeSlots];
    const [movedSlot] = reorderedActiveSlots.splice(fromPosition, 1);
    reorderedActiveSlots.splice(toPosition, 0, movedSlot);

    const nextSlots = Array.from({ length: day.slots.length }, (_, slotIndex) => {
      const activeSlot = reorderedActiveSlots[slotIndex];
      if (activeSlot) {
        return normalizeSlot({ ...activeSlot, slotIndex });
      }
      const emptySlot = emptySlots[slotIndex - reorderedActiveSlots.length];
      return normalizeSlot({ ...emptySlot, slotIndex });
    });

    setDays((currentDays) =>
      currentDays.map((current) =>
        current.dayIndex === dayIndex
          ? { ...current, slots: nextSlots }
          : current,
      ),
    );
    setSaveState("idle");
    setSaveError(null);
  }

  async function saveTemplate() {
    setSaveState("saving");
    setSaveError(null);
    try {
      await saveDefaultTemplateAction({
        slots: days.flatMap((day) => day.slots),
      });
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Save failed.");
    }
  }

  const activeFocusedSlots = focusedDay.slots.filter(
    (slot) => slot.jobType !== "none",
  );

  return (
    <RatesContext.Provider value={jobsData}>
    <HiddenBuiltinsContext.Provider value={initialData.hiddenBuiltins}>
    <CustomJobsContext.Provider value={initialData.customJobs}>
    <div className="space-y-4">
      <section className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Weekly template</h2>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">
            {filledSlotCount} shifts prefilled into every new week. Tap a day,
            then tap a bar to edit.
          </p>
          {jobsData ? (
            <div className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="flex items-baseline gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                  Total hours
                </span>
                <span className="text-base font-semibold tabular-nums text-[var(--text-primary)]">
                  {formatTemplateHours(totalHours)}
                </span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                  Net / week
                </span>
                <span className="text-base font-semibold tabular-nums text-[var(--text-primary)]">
                  {formatTemplateMoney(totalNetCents)}
                </span>
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <SaveStatus state={saveState} message={saveError} />
          <button
            className="h-10 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-5 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saveState === "saving"}
            onClick={saveTemplate}
            type="button"
          >
            {saveState === "saving" ? "Saving..." : "Save"}
          </button>
        </div>
      </section>

      {/* Week strip — tap a day to focus it (like the dashboard). */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex w-max min-w-full gap-2">
          {days.map((day) => (
            <WeekDayButton
              active={day.dayIndex === focusedDayIndex}
              day={day}
              key={day.dayIndex}
              onSelect={() => {
                setFocusedDayIndex(day.dayIndex);
                setExpandedSlotIndex(null);
              }}
            />
          ))}
        </div>
      </div>

      {/* Focused day — its shift bars, editable. */}
      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
          {WEEKDAY_FULL[focusedDay.dayIndex]}
        </h3>
        <div className="space-y-2">
          {activeFocusedSlots.length > 0 ? (
            <TemplateShiftList
              activeFocusedSlots={activeFocusedSlots}
              dayIndex={focusedDay.dayIndex}
              expandedSlotIndex={expandedSlotIndex}
              onRemove={(slot) => removeShift(focusedDay.dayIndex, slot.slotIndex)}
              onReorder={reorderSlots}
              onSlotChange={updateSlot}
              onToggle={(slotIndex) =>
                setExpandedSlotIndex((current) =>
                  current === slotIndex ? null : slotIndex,
                )
              }
            />
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-hover)] p-4 text-sm text-[var(--text-tertiary)]">
              No shifts on {WEEKDAY_FULL[focusedDay.dayIndex]}.
            </div>
          )}
        </div>
        <button
          className="mt-2 h-10 w-full rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-hover)] text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={activeFocusedSlots.length >= 4}
          onClick={() => addShift(focusedDay.dayIndex)}
          type="button"
        >
          + Add shift
        </button>
      </section>
    </div>
    </CustomJobsContext.Provider>
    </HiddenBuiltinsContext.Provider>
    </RatesContext.Provider>
  );
}

function WeekDayButton({
  day,
  active,
  onSelect,
}: {
  day: TemplateDayDraft;
  active: boolean;
  onSelect: () => void;
}) {
  const shifts = day.slots.filter((slot) => slot.jobType !== "none");
  return (
    <button
      className={[
        "flex min-w-[68px] flex-col items-center gap-1.5 rounded-xl border px-3 py-2.5 transition",
        active
          ? "border-[var(--accent-brand-border)] bg-[var(--accent-brand-fill)] text-[var(--accent-brand-text)]"
          : "border-[var(--border-subtle)] bg-[var(--surface-hover)] hover:bg-[var(--surface-overlay)]",
      ].join(" ")}
      onClick={onSelect}
      type="button"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {day.label}
      </span>
      <span className="flex h-2.5 items-center gap-1">
        {shifts.length > 0 ? (
          // Up to 3 dots; a custom job uses ITS color (not the fallback teal).
          shifts.slice(0, 3).map((slot) =>
            slot.jobType === "custom" && slot.customColor ? (
              <span
                className="h-2.5 w-2.5 rounded-full"
                key={slot.slotIndex}
                style={{
                  backgroundColor: slot.customColor,
                  boxShadow: `0 0 0 3px ${slot.customColor}29`,
                }}
              />
            ) : (
              <span className={shiftDotClass(slot.jobType)} key={slot.slotIndex} />
            ),
          )
        ) : (
          <span className="h-1 w-1 rounded-full bg-[var(--surface-hover)]" />
        )}
      </span>
    </button>
  );
}

function TemplateShiftList({
  activeFocusedSlots,
  dayIndex,
  expandedSlotIndex,
  onRemove,
  onReorder,
  onSlotChange,
  onToggle,
}: {
  activeFocusedSlots: TemplateSlotDraft[];
  dayIndex: number;
  expandedSlotIndex: number | null;
  onRemove: (slot: TemplateSlotDraft) => void;
  onReorder: (dayIndex: number, fromSlotIndex: number, toSlotIndex: number) => void;
  onSlotChange: (
    dayIndex: number,
    slotIndex: number,
    patch: Partial<TemplateSlotDraft>,
  ) => void;
  onToggle: (slotIndex: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const sortableIds = activeFocusedSlots.map((slot) => slot.slotIndex);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    onReorder(dayIndex, Number(active.id), Number(over.id));
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      sensors={sensors}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        {activeFocusedSlots.map((slot) => (
          <SortableTemplateShiftBar
            expanded={expandedSlotIndex === slot.slotIndex}
            key={slot.slotIndex}
            onRemove={() => onRemove(slot)}
            onSlotChange={onSlotChange}
            onToggle={() => onToggle(slot.slotIndex)}
            slot={slot}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableTemplateShiftBar({
  slot,
  expanded,
  onToggle,
  onSlotChange,
  onRemove,
}: {
  slot: TemplateSlotDraft;
  expanded: boolean;
  onToggle: () => void;
  onSlotChange: (
    dayIndex: number,
    slotIndex: number,
    patch: Partial<TemplateSlotDraft>,
  ) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slot.slotIndex });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <TemplateShiftBar
      dragAttributes={attributes}
      dragListeners={listeners}
      expanded={expanded}
      isDragging={isDragging}
      onRemove={onRemove}
      onSlotChange={onSlotChange}
      onToggle={onToggle}
      setNodeRef={setNodeRef}
      slot={slot}
      style={style}
    />
  );
}

function TemplateShiftBar({
  slot,
  expanded,
  isDragging,
  onToggle,
  onSlotChange,
  onRemove,
  dragAttributes,
  dragListeners,
  setNodeRef,
  style,
}: {
  slot: TemplateSlotDraft;
  expanded: boolean;
  isDragging?: boolean;
  onToggle: () => void;
  onSlotChange: (
    dayIndex: number,
    slotIndex: number,
    patch: Partial<TemplateSlotDraft>,
  ) => void;
  onRemove: () => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  setNodeRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
}) {
  const customJobs = useContext(CustomJobsContext);
  const hiddenBuiltins = useContext(HiddenBuiltinsContext);
  const jobsData = useContext(RatesContext);
  const netCents = slotNetCents(slot, jobsData);
  const isCustom = slot.jobType === "custom";
  const customColor = slot.customColor ?? "#3b82f6";
  const customStyle = isCustom
    ? {
        backgroundColor: customColor,
        borderColor: darken(customColor),
        color: contrastText(customColor),
      }
    : undefined;
  return (
    <div
      className={`rounded-xl border shadow-sm transition ${isCustom ? "" : shiftBarClass(slot.jobType)} ${isDragging ? "scale-[0.99] opacity-70 ring-2 ring-[var(--accent-primary)]" : ""}`}
      ref={setNodeRef}
      style={{ ...customStyle, ...style }}
    >
      <div className="flex min-h-10 w-full items-center gap-1 pl-1 pr-3 py-1.5">
        <button
          aria-label="Drag to reorder"
          className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-current opacity-50 transition hover:opacity-90 active:cursor-grabbing"
          type="button"
          {...dragAttributes}
          {...dragListeners}
        >
          ⠿
        </button>
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={onToggle}
          type="button"
        >
        <span className="flex shrink-0 items-center gap-2">
          <span
            className={
              isCustom ? "h-2.5 w-2.5 rounded-full" : shiftDotClass(slot.jobType)
            }
            style={
              isCustom
                ? { backgroundColor: contrastText(customColor) }
                : undefined
            }
          />
          <span className="text-sm font-semibold">
            {isCustom
              ? (slot.customName ?? "Custom")
              : formatJobLabel(slot.jobType)}
          </span>
          {slot.payType === "regular" ||
          slot.payType === "overtime" ||
          slot.payType === "split" ? (
            <span className={payTypeBadgeClass(slot.payType)}>
              {formatPayBadge(slot.payType)}
            </span>
          ) : null}
          <span className="text-xs font-semibold opacity-90">
            {formatNumberInput(slot.hoursOrUnits)}h
          </span>
          {jobsData && netCents > 0 ? (
            <span className="text-xs font-semibold tabular-nums opacity-90">
              {formatTemplateMoney(netCents)}
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-center text-xs font-semibold">
          {slot.label ?? ""}
        </span>
        </button>
      </div>

      {expanded ? (
        <div className="grid gap-3 border-t border-black/10 bg-black/5 p-3 sm:grid-cols-2">
          <Field label="Job">
            <select
              className={SELECT_CLASS}
              onChange={(event) => {
                const value = event.target.value;
                if (value.startsWith("custom:")) {
                  const id = value.slice("custom:".length);
                  const job = customJobs.find((entry) => entry.id === id);
                  const wagePay =
                    slot.payType === "regular" ||
                    slot.payType === "overtime" ||
                    slot.payType === "split"
                      ? slot.payType
                      : "regular";
                  onSlotChange(slot.dayIndex, slot.slotIndex, {
                    jobType: "custom",
                    payType: wagePay,
                    hoursOrUnits:
                      slot.payType === "unit" ? 0 : slot.hoursOrUnits,
                    customJobId: id,
                    // Keep the stamped color/name if the job is inactive (not
                    // in the picker list) so the bar styling survives.
                    customColor: job?.color ?? slot.customColor,
                    customName: job?.name ?? slot.customName,
                  });
                } else {
                  onSlotChange(slot.dayIndex, slot.slotIndex, {
                    jobType: value as JobType,
                    customJobId: null,
                    customColor: undefined,
                    customName: undefined,
                  });
                }
              }}
              value={isCustom ? `custom:${slot.customJobId ?? ""}` : slot.jobType}
            >
              {isCustom &&
              slot.customJobId &&
              !customJobs.some((job) => job.id === slot.customJobId) ? (
                <option value={`custom:${slot.customJobId}`}>
                  {`${slot.customName ?? "Custom"} (inactive)`}
                </option>
              ) : null}
              {JOB_OPTIONS.filter(
                (jobType) =>
                  !hiddenBuiltins.includes(jobType) || jobType === slot.jobType,
              ).map((jobType) => (
                <option key={jobType} value={jobType}>
                  {formatJobLabel(jobType)}
                </option>
              ))}
              {customJobs.map((job) => (
                <option key={job.id} value={`custom:${job.id}`}>
                  {job.name}
                </option>
              ))}
            </select>
          </Field>

          {slot.payType === "unit" ? (
            <span aria-hidden className="hidden sm:block" />
          ) : (
            <Field label="Type">
              <select
                className={SELECT_CLASS}
                onChange={(event) =>
                  onSlotChange(
                    slot.dayIndex,
                    slot.slotIndex,
                    normalizePayTypePatch(slot, event.target.value as PayType),
                  )
                }
                value={slot.payType}
              >
                {PAY_OPTIONS.map((payType) => (
                  <option key={payType} value={payType}>
                    {formatPayOptionLabel(payType)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {slot.payType === "split" ? (
            <>
              <Field label="Regular hours">
                <input
                  className={SELECT_CLASS}
                  min="0"
                  onChange={(event) => {
                    const regularHours = parsePositiveNumber(event.target.value);
                    onSlotChange(slot.dayIndex, slot.slotIndex, {
                      regularHours,
                      hoursOrUnits: regularHours + slot.overtimeHours,
                    });
                  }}
                  step="0.25"
                  type="number"
                  value={formatNumberInput(slot.regularHours)}
                />
              </Field>
              <Field label="OT hours">
                <input
                  className={SELECT_CLASS}
                  min="0"
                  onChange={(event) => {
                    const overtimeHours = parsePositiveNumber(
                      event.target.value,
                    );
                    onSlotChange(slot.dayIndex, slot.slotIndex, {
                      overtimeHours,
                      hoursOrUnits: slot.regularHours + overtimeHours,
                    });
                  }}
                  step="0.25"
                  type="number"
                  value={formatNumberInput(slot.overtimeHours)}
                />
              </Field>
            </>
          ) : (
            <Field label={slot.payType === "unit" ? "Amount ($)" : "Hours"}>
              <input
                className={SELECT_CLASS}
                min="0"
                onChange={(event) =>
                  onSlotChange(slot.dayIndex, slot.slotIndex, {
                    hoursOrUnits: parsePositiveNumber(event.target.value),
                  })
                }
                step="0.25"
                type="number"
                value={formatNumberInput(slot.hoursOrUnits)}
              />
            </Field>
          )}

          {isAbilityShift(slot.jobType) ? (
            <>
              <Field label="Incentive">
                <select
                  className={SELECT_CLASS}
                  onChange={(event) =>
                    onSlotChange(slot.dayIndex, slot.slotIndex, {
                      incentiveMode: event.target.value as IncentiveMode,
                      incentiveRate:
                        event.target.value === "rate" ? slot.incentiveRate : 0,
                      incentiveAmount:
                        event.target.value === "lump_sum"
                          ? slot.incentiveAmount
                          : 0,
                    })
                  }
                  value={slot.incentiveMode === "lump_sum" ? "lump_sum" : "rate"}
                >
                  {INCENTIVE_MODE_OPTIONS.map((mode) => (
                    <option key={mode} value={mode}>
                      {formatIncentiveModeLabel(mode)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={
                  slot.incentiveMode === "lump_sum"
                    ? "Incentive lump ($)"
                    : "Incentive rate ($/h)"
                }
              >
                <input
                  className={SELECT_CLASS}
                  min="0"
                  onChange={(event) =>
                    onSlotChange(
                      slot.dayIndex,
                      slot.slotIndex,
                      slot.incentiveMode === "lump_sum"
                        ? {
                            incentiveAmount: parsePositiveNumber(
                              event.target.value,
                            ),
                          }
                        : {
                            incentiveRate: parsePositiveNumber(
                              event.target.value,
                            ),
                          },
                    )
                  }
                  step="0.01"
                  type="number"
                  value={formatNumberInput(
                    slot.incentiveMode === "lump_sum"
                      ? slot.incentiveAmount
                      : slot.incentiveRate,
                  )}
                />
              </Field>
            </>
          ) : null}

          <Field label="Label">
            <input
              className={SELECT_CLASS}
              onChange={(event) =>
                onSlotChange(slot.dayIndex, slot.slotIndex, {
                  label: event.target.value,
                })
              }
              placeholder={
                isAbilityShift(slot.jobType)
                  ? "Auto-set for Ability"
                  : "e.g. Spanish Shift"
              }
              type="text"
              value={slot.label ?? ""}
            />
          </Field>

          <div className="sm:col-span-2">
            <button
              className="h-9 w-full rounded-lg border border-black/15 bg-black/5 text-sm font-medium text-[#7f1d1d] transition hover:bg-red-500/15"
              onClick={onRemove}
              type="button"
            >
              Remove shift
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-semibold text-black/70">
      <span className="mb-1 block uppercase tracking-wide opacity-70">
        {label}
      </span>
      {children}
    </label>
  );
}

function SaveStatus({
  state,
  message,
}: {
  state: SaveState;
  message: string | null;
}) {
  if (state === "idle") {
    return (
      <span className="text-sm text-[var(--text-muted)]">Tap Save to apply changes</span>
    );
  }
  const label =
    state === "saving"
      ? "Saving..."
      : state === "saved"
        ? "Saved"
        : (message ?? "Save failed");
  return (
    <span
      className={
        state === "error"
          ? "max-w-56 text-right text-sm font-medium text-[var(--accent-negative-text)]"
          : "text-sm font-medium text-[var(--text-secondary)]"
      }
    >
      {label}
    </span>
  );
}

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-black/15 bg-white px-2 text-sm text-[#1f2937]";

const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ── Dashboard-matched shift-bar styling ─────────────────────────────────────
function shiftBarClass(jobType: JobType): string {
  if (isAbilityShift(jobType) || jobType === "incentive") {
    return "border-[#1e3a8a] bg-[#1d4ed8] text-white";
  }
  if (jobType === "prestige" || jobType === "prestige_ilst") {
    return "border-[#d97706] bg-[#facc15] text-[#1f2937]";
  }
  return "border-[#d7dee8] bg-white text-[#0f172a]";
}

function shiftDotClass(jobType: JobType): string {
  if (isAbilityShift(jobType) || jobType === "incentive") {
    return "h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.22)]";
  }
  if (jobType === "prestige" || jobType === "prestige_ilst") {
    return "h-2.5 w-2.5 rounded-full bg-[#92400e] shadow-[0_0_0_3px_rgba(146,64,14,0.16)]";
  }
  return "h-2.5 w-2.5 rounded-full bg-[#0e7490] shadow-[0_0_0_3px_rgba(14,116,144,0.16)]";
}

function payTypeBadgeClass(payType: PayType): string {
  if (payType === "overtime") {
    return "rounded-full bg-[#1f2937] px-2 py-0.5 text-[10px] font-bold uppercase text-white";
  }
  return "rounded-full bg-black/80 px-2 py-0.5 text-[10px] font-bold uppercase text-white";
}

function formatPayBadge(payType: PayType): string {
  if (payType === "regular") return "REG";
  if (payType === "overtime") return "OT";
  if (payType === "split") return "SPLIT";
  return "";
}

// ── slot normalization (unchanged behavior) ─────────────────────────────────
function normalizeSlot(slot: TemplateSlotDraft): TemplateSlotDraft {
  if (slot.jobType === "none") {
    return {
      ...slot,
      payType: "none",
      hoursOrUnits: 0,
      regularHours: 0,
      overtimeHours: 0,
      incentiveMode: "none",
      incentiveRate: 0,
      incentiveAmount: 0,
    };
  }

  if (slot.jobType === "incentive" || slot.jobType === "other") {
    return {
      ...slot,
      payType: "unit",
      hoursOrUnits: Math.max(0, slot.hoursOrUnits),
      regularHours: 0,
      overtimeHours: 0,
      incentiveMode: "none",
      incentiveRate: 0,
      incentiveAmount: 0,
    };
  }

  const incentiveMode = isAbilityShift(slot.jobType)
    ? slot.incentiveMode === "lump_sum"
      ? "lump_sum"
      : "rate"
    : "none";

  if (slot.payType === "split") {
    const regularHours = Math.max(0, slot.regularHours);
    const overtimeHours = Math.max(0, slot.overtimeHours);
    return {
      ...slot,
      regularHours,
      overtimeHours,
      hoursOrUnits: regularHours + overtimeHours,
      incentiveMode,
      incentiveRate:
        incentiveMode === "rate" ? Math.max(0, slot.incentiveRate) : 0,
      incentiveAmount:
        incentiveMode === "lump_sum" ? Math.max(0, slot.incentiveAmount) : 0,
    };
  }

  const hoursOrUnits = Math.max(0, slot.hoursOrUnits);
  return {
    ...slot,
    payType:
      slot.payType === "regular" || slot.payType === "overtime"
        ? slot.payType
        : "regular",
    hoursOrUnits,
    regularHours: slot.payType === "overtime" ? 0 : hoursOrUnits,
    overtimeHours: slot.payType === "overtime" ? hoursOrUnits : 0,
    incentiveMode,
    incentiveRate:
      incentiveMode === "rate" ? Math.max(0, slot.incentiveRate) : 0,
    incentiveAmount:
      incentiveMode === "lump_sum" ? Math.max(0, slot.incentiveAmount) : 0,
  };
}

function normalizePayTypePatch(
  slot: TemplateSlotDraft,
  payType: PayType,
): Partial<TemplateSlotDraft> {
  if (payType === "split") {
    return {
      payType,
      hoursOrUnits: slot.hoursOrUnits,
      regularHours: slot.payType === "overtime" ? 0 : slot.hoursOrUnits,
      overtimeHours: slot.payType === "overtime" ? slot.hoursOrUnits : 0,
    };
  }

  if (payType === "regular" || payType === "overtime") {
    const hoursOrUnits =
      slot.payType === "split"
        ? slot.regularHours + slot.overtimeHours
        : slot.hoursOrUnits;
    return {
      payType,
      hoursOrUnits,
      regularHours: payType === "regular" ? hoursOrUnits : 0,
      overtimeHours: payType === "overtime" ? hoursOrUnits : 0,
    };
  }

  return { payType, regularHours: 0, overtimeHours: 0 };
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function formatNumberInput(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatJobLabel(jobType: JobType): string {
  if (jobType === "ability_incentive" || jobType === "ability") {
    return "Ability";
  }
  if (jobType === "prestige" || jobType === "prestige_ilst") {
    return "Prestige";
  }
  if (jobType === "other") {
    return "Other";
  }
  return jobType;
}

function isAbilityShift(jobType: JobType): boolean {
  return jobType === "ability" || jobType === "ability_incentive";
}

function formatIncentiveModeLabel(mode: IncentiveMode): string {
  return mode === "lump_sum" ? "Lump sum" : "Rate";
}

function formatPayOptionLabel(payType: PayType): string {
  if (payType === "split") return "Split (Reg + OT)";
  if (payType === "regular") return "Regular";
  if (payType === "overtime") return "Overtime";
  return payType;
}
