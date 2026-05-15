"use client";

import Link from "next/link";
import { useState } from "react";

import { categoryBarClass, categoryLabel } from "@/lib/cal/color";
import type {
  CalDay,
  CalTargets,
  CalTotals,
  FoodEntry,
  ShiftlyCalData,
} from "@/lib/cal/types";

export function ShiftlyCalWeekView({
  initialData,
}: {
  initialData: ShiftlyCalData;
}) {
  const [focusedDayIndex, setFocusedDayIndex] = useState(0);
  const focusedDay =
    initialData.currentWeek.days[focusedDayIndex] ?? initialData.currentWeek.days[0];

  return (
    <section className="overflow-hidden rounded-xl border border-white/15 bg-black/10 shadow-[0_24px_70px_rgba(8,15,28,0.22)] backdrop-blur-md">
      <div className="h-2 bg-white/10" />
      <div className="p-3 sm:p-4">
        <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(520px,1.05fr)] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
              Read-only week
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white drop-shadow-sm sm:text-3xl">
              {formatWeekRange(
                initialData.currentWeek.weekStartIso,
                initialData.currentWeek.weekEndIso,
              )}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20"
                href="/cal/history"
              >
                Back to history
              </Link>
              <Link
                className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20"
                href={`/cal?week=${initialData.currentWeek.weekStartIso}`}
              >
                Open in log
              </Link>
            </div>
          </div>
          <MetricStrip data={initialData} />
        </div>

        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {initialData.currentWeek.days.map((day, index) => (
            <WeekStripCell
              day={day}
              isFocused={index === focusedDayIndex}
              key={day.date}
              onClick={() => setFocusedDayIndex(index)}
            />
          ))}
        </div>

        <section className="mt-4 rounded-lg border border-white/15 bg-black/20 p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-md">
          <FocusedDayPanel
            day={focusedDay}
            targets={initialData.targets}
          />
        </section>
      </div>
    </section>
  );
}

function MetricStrip({ data }: { data: ShiftlyCalData }) {
  const weight = getMostRecentWeight(data.currentWeek.days);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      <TopMetric
        label="Week calories"
        value={`${data.currentWeek.totals.calories.toLocaleString()}`}
      />
      <TopMetric
        label="Week protein"
        value={`${data.currentWeek.totals.proteinG.toLocaleString()}g`}
      />
      <TopMetric
        label="Week fiber"
        value={`${data.currentWeek.totals.fiberG.toLocaleString()}g`}
      />
      <TopMetric
        label="Estimated change"
        value={`${formatSigned(data.projection.projectedWeightDeltaLbs)} lbs`}
      />
      <TopMetric
        label="Latest weight"
        value={weight === null ? "--" : `${weight.weightLbs.toFixed(1)} lbs`}
      />
    </div>
  );
}

function TopMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="relative overflow-hidden rounded-md border-2 border-white/35 bg-black/25 px-2.5 py-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-md before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-white/40 sm:px-4">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/85 sm:text-[10px]">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold sm:text-lg">{value}</p>
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
  const date = new Date(`${day.date}T00:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(date);

  return (
    <button
      className={`min-w-0 rounded-md px-1.5 py-2 text-left text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-white sm:p-3 ${
        isFocused
          ? "border-2 border-white/90 bg-white/14 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] backdrop-blur-xl"
          : "border-2 border-white/45 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-xl hover:border-white/60 hover:bg-white/14"
      }`}
      onClick={onClick}
      type="button"
    >
      <p className="truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-white sm:text-[10px]">
        {weekday}
      </p>
      <p className="mt-1 text-base font-semibold text-white sm:text-lg">
        {date.getUTCDate()}
      </p>
      <p className="mt-3 truncate text-xs font-semibold text-white sm:mt-6 sm:text-sm">
        {day.totals.calories.toLocaleString()}
      </p>
    </button>
  );
}

function FocusedDayPanel({
  day,
  targets,
}: {
  day: CalDay;
  targets: CalTargets;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
          {formatLongDay(day.date)}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-white">
          {day.entries.length} entries
        </h2>
        <div className="mt-4 space-y-2">
          {day.entries.length > 0 ? (
            day.entries.map((entry) => (
              <FoodEntryBar entry={entry} key={entry.id} />
            ))
          ) : (
            <div className="rounded-md border border-dashed border-white/20 bg-black/15 p-6 text-center text-sm text-white/70">
              No food logged for this day.
            </div>
          )}
        </div>
      </div>
      <DayTotals totals={day.totals} targets={targets} weight={day.weight?.weightLbs ?? null} />
    </div>
  );
}

function FoodEntryBar({ entry }: { entry: FoodEntry }) {
  return (
    <div className={categoryBarClass(entry.category)}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">
          {entry.mealName || categoryLabel(entry.category)}
        </span>
        <span className="text-right font-semibold opacity-90">
          <span className="block">{entry.calories.toLocaleString()} cal</span>
          {entry.loggedTime ? (
            <span className="text-xs font-medium opacity-75">
              {formatLoggedTime(entry.loggedTime)}
            </span>
          ) : null}
        </span>
      </div>
      <div className="mt-1 text-xs opacity-85">
        {formatMacros(entry) || categoryLabel(entry.category)}
      </div>
    </div>
  );
}

function DayTotals({
  totals,
  targets,
  weight,
}: {
  totals: CalTotals;
  targets: CalTargets;
  weight: number | null;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        Day totals
      </p>
      <div className="mt-4 grid gap-2">
        <TotalLine label="Calories" target={targets.tdeeCalories} unit="cal" value={totals.calories} />
        <TotalLine label="Protein" target={targets.proteinTargetG} unit="g" value={totals.proteinG} />
        <TotalLine label="Carbs" target={targets.carbsTargetG} unit="g" value={totals.carbsG} />
        <TotalLine label="Fat" target={targets.fatTargetG} unit="g" value={totals.fatG} />
        <TotalLine label="Fiber" target={targets.fiberTargetG} unit="g" value={totals.fiberG} />
        <div className="rounded-md border border-white/15 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white/70">Weight</p>
            <p className="font-bold text-white">
              {weight === null ? "--" : `${weight.toFixed(1)} lbs`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TotalLine({
  label,
  target,
  unit,
  value,
}: {
  label: string;
  target: number | null;
  unit: string;
  value: number;
}) {
  const deviation = target === null ? null : value - target;

  return (
    <div className="rounded-md border border-white/15 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white/70">{label}</p>
        <p className="font-bold text-white">
          {value.toLocaleString()} {unit}
        </p>
      </div>
      {deviation === null ? null : (
        <p className="mt-1 text-xs font-semibold text-white/60">
          {formatSigned(deviation)} {unit} from target
        </p>
      )}
    </div>
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
  fiberG: number | null;
}): string {
  return [
    entry.proteinG === null ? null : `${entry.proteinG}p`,
    entry.carbsG === null ? null : `${entry.carbsG}c`,
    entry.fatG === null ? null : `${entry.fatG}f`,
    entry.fiberG === null ? null : `${entry.fiberG}fi`,
  ]
    .filter(Boolean)
    .join(" / ");
}

function formatLoggedTime(value: string): string {
  const [hoursRaw, minutes = "00"] = value.split(":");
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours)) return value;

  const date = new Date(Date.UTC(2026, 0, 1, hours, Number(minutes)));
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatLongDay(dateIso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateIso}T00:00:00.000Z`));
}

function formatWeekRange(startIso: string, endIso: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const year = new Date(`${endIso}T00:00:00.000Z`).getUTCFullYear();
  return `${formatter.format(new Date(`${startIso}T00:00:00.000Z`))} - ${formatter.format(
    new Date(`${endIso}T00:00:00.000Z`),
  )}, ${year}`;
}

function formatSigned(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  })}`;
}
