"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import { saveAbilityPaycheckActualAction } from "@/app/(protected)/paychecks/actions";
import { centsToDollars, dollarsToCents } from "@/lib/domain/money";
import type { PaycheckAuditData, PaycheckPeriod } from "@/lib/paychecks/data";

type SaveState = "idle" | "saving" | "saved" | "error";

export function PaycheckAuditPage({
  initialData,
}: {
  initialData: PaycheckAuditData;
}) {
  const [periods, setPeriods] = useState(initialData.periods);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function saveActual(period: PaycheckPeriod, value: string) {
    if (!period.actualWeekId) {
      return;
    }

    const actualCents = value.trim() ? dollarsToCents(Number(value)) : null;

    if (actualCents !== null && (!Number.isFinite(actualCents) || actualCents < 0)) {
      setError("Enter a valid paycheck amount.");
      setSaveState("error");
      return;
    }

    setError(null);
    setSaveState("saving");

    try {
      await saveAbilityPaycheckActualAction({
        weekId: period.actualWeekId,
        actualCents,
      });
      setPeriods((current) =>
        current.map((item) => {
          if (item.id !== period.id) {
            return item;
          }

          return {
            ...item,
            ability: {
              ...item.ability,
              actualNetCents: actualCents,
              differenceCents:
                actualCents === null
                  ? null
                  : actualCents - item.ability.estimatedNetCents,
            },
          };
        }),
      );
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Unable to save paycheck.");
    }
  }

  return (
    <main className="min-h-screen bg-[#101827] px-3 py-4 text-[#0f172a] sm:px-4 lg:px-6">
      <section className="mx-auto max-w-7xl rounded-xl border border-[#d7dee8] bg-[#f8fafc] shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
        <div className="h-2 bg-[#0b1220]" />
        <div className="p-4 sm:p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#334155]">
                Paycheck audit
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#0f172a] sm:text-3xl">
                Ability pay-period check
              </h1>
              <p className="mt-1 text-sm text-[#64748b]">
                Compare expected Ability take-home against what UKG actually paid.
              </p>
            </div>
            <SaveBadge state={saveState} error={error} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {periods.map((period) => (
              <PaycheckPeriodCard
                key={period.id}
                period={period}
                onSaveActual={saveActual}
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function PaycheckPeriodCard({
  period,
  onSaveActual,
}: {
  period: PaycheckPeriod;
  onSaveActual: (period: PaycheckPeriod, value: string) => Promise<void>;
}) {
  const [actualValue, setActualValue] = useState(
    period.ability.actualNetCents === null
      ? ""
      : centsToDollars(period.ability.actualNetCents).toFixed(2),
  );
  const difference = period.ability.differenceCents;
  const tone =
    difference === null
      ? "neutral"
      : difference < -100
        ? "short"
        : difference > 100
          ? "over"
          : "match";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSaveActual(period, actualValue);
  }

  return (
    <article className="rounded-md border border-[#d7dee8] bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#0f172a]">{period.label}</h2>
          <p className="mt-1 text-sm text-[#64748b]">
            {formatDate(period.startDate)} - {formatDate(period.endDate)}
          </p>
        </div>
        <StatusPill tone={tone} differenceCents={difference} />
      </div>

      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <Metric label="Regular hours" value={`${formatHours(period.ability.regularHours)}h`} />
        <Metric label="OT hours" value={`${formatHours(period.ability.overtimeHours)}h`} />
        <Metric label="Total hours" value={`${formatHours(period.ability.totalHours)}h`} />
        <Metric label="Pay date" value={period.paycheckDueDate ? formatDate(period.paycheckDueDate) : "Not ready"} />
      </div>

      <div className="my-4 border-t border-[#e2e8f0]" />

      <div className="grid gap-2 text-sm">
        <MoneyLine label="Expected gross" value={period.ability.grossCents} />
        <MoneyLine label="Est. withholding" tone="negative" value={period.ability.estimatedTaxCents} />
        <MoneyLine strong label="Expected take-home" value={period.ability.estimatedNetCents} />
      </div>

      <form className="mt-4 rounded-md border border-[#d7dee8] bg-[#f8fafc] p-3" onSubmit={submit}>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-[#334155]">
          Actual Ability check
        </label>
        <div className="mt-2 flex gap-2">
          <input
            className="h-10 min-w-0 flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm outline-none transition focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
            disabled={!period.actualWeekId}
            inputMode="decimal"
            onChange={(event) => setActualValue(event.target.value)}
            placeholder="0.00"
            type="number"
            value={actualValue}
          />
          <button
            className="h-10 rounded-md bg-[#0b1220] px-3 text-sm font-semibold text-white transition hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
            disabled={!period.actualWeekId}
            type="submit"
          >
            Save
          </button>
        </div>
        <p className="mt-2 text-xs text-[#64748b]">
          Paste the net Ability amount from UKG. ShiftlyCash compares it to expected take-home.
        </p>
      </form>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2">
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b]">
        {label}
      </span>
      <span className="text-base font-semibold text-[#0f172a]">{value}</span>
    </div>
  );
}

function MoneyLine({
  label,
  value,
  tone,
  strong = false,
}: {
  label: string;
  value: number;
  tone?: "negative";
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? "font-semibold" : "text-[#475569]"}>{label}</span>
      <span
        className={[
          strong ? "text-base font-bold" : "font-semibold",
          tone === "negative" ? "text-[#b91c1c]" : "text-[#0f172a]",
        ].join(" ")}
      >
        {tone === "negative" ? "-" : ""}
        {formatMoney(value)}
      </span>
    </div>
  );
}

function StatusPill({
  tone,
  differenceCents,
}: {
  tone: "neutral" | "short" | "over" | "match";
  differenceCents: number | null;
}) {
  const classes = {
    neutral: "border-[#d7dee8] bg-[#f8fafc] text-[#475569]",
    short: "border-[#fecaca] bg-[#fff1f2] text-[#b91c1c]",
    over: "border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]",
    match: "border-[#bae6fd] bg-[#e0f2fe] text-[#0e7490]",
  };
  const label =
    differenceCents === null
      ? "No actual yet"
      : tone === "short"
        ? `${formatMoney(Math.abs(differenceCents))} short`
        : tone === "over"
          ? `${formatMoney(differenceCents)} over`
          : "Matches estimate";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${classes[tone]}`}>
      {label}
    </span>
  );
}

function SaveBadge({ state, error }: { state: SaveState; error: string | null }) {
  if (state === "idle") {
    return null;
  }

  return (
    <span
      className={
        state === "error"
          ? "rounded-full bg-[#fff1f2] px-3 py-1 text-xs font-semibold text-[#b91c1c]"
          : "rounded-full bg-[#e0f2fe] px-3 py-1 text-xs font-semibold text-[#0e7490]"
      }
    >
      {state === "saving" ? "Saving..." : state === "saved" ? "Saved" : error}
    </span>
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centsToDollars(value));
}

function formatHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
