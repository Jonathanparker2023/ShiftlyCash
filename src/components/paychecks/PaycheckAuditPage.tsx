"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import { savePaycheckActualAction } from "@/app/(protected)/paychecks/actions";
import { centsToDollars, dollarsToCents } from "@/lib/domain/money";
import type {
  PaycheckAuditData,
  PaycheckJobKey,
  PaycheckJobSummary,
  PaycheckPeriod,
} from "@/lib/paychecks/data";

type SaveState = "idle" | "saving" | "saved" | "error";

export function PaycheckAuditPage({
  initialData,
}: {
  initialData: PaycheckAuditData;
}) {
  const [periods, setPeriods] = useState(initialData.periods);
  const [activeJob, setActiveJob] = useState<PaycheckJobKey>("ability");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function saveActual(period: PaycheckPeriod, jobType: PaycheckJobKey, value: string) {
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
      await savePaycheckActualAction({
        weekId: period.actualWeekId,
        jobType,
        actualCents,
      });
      setPeriods((current) =>
        current.map((item) => {
          if (item.id !== period.id) {
            return item;
          }

          return {
            ...item,
            jobs: {
              ...item.jobs,
              [jobType]: {
                ...item.jobs[jobType],
                actualNetCents: actualCents,
                differenceCents:
                  actualCents === null
                    ? null
                    : actualCents - item.jobs[jobType].estimatedNetCents,
              },
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
    <main className="min-h-screen px-3 py-4 text-white sm:px-4 lg:px-6">
      <section className="mx-auto max-w-7xl rounded-xl border border-white/15 bg-black/15 backdrop-blur-md shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
        <div className="h-2 bg-zinc-950" />
        <div className="p-4 sm:p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/85">
                Paycheck audit
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Pay-period check
              </h1>
              <p className="mt-1 text-sm text-white/70">
                Compare expected take-home against what UKG actually paid.
              </p>
            </div>
            <SaveBadge state={saveState} error={error} />
          </div>

          <div className="mb-4 inline-flex rounded-md border border-white/20 bg-black/20 backdrop-blur-md p-1 shadow-sm">
            {(["ability", "prestige"] as const).map((jobType) => (
              <button
                key={jobType}
                className={[
                  "rounded px-3 py-1.5 text-sm font-semibold transition",
                  activeJob === jobType
                    ? "bg-zinc-950 text-white"
                    : "text-white/70 hover:bg-white/10",
                ].join(" ")}
                onClick={() => {
                  setActiveJob(jobType);
                  setSaveState("idle");
                  setError(null);
                }}
                type="button"
              >
                {jobType === "ability" ? "Ability" : "Prestige"}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {periods.map((period) => (
              <PaycheckPeriodCard
                key={`${period.id}-${activeJob}`}
                jobType={activeJob}
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
  jobType,
  period,
  onSaveActual,
}: {
  jobType: PaycheckJobKey;
  period: PaycheckPeriod;
  onSaveActual: (
    period: PaycheckPeriod,
    jobType: PaycheckJobKey,
    value: string,
  ) => Promise<void>;
}) {
  const job = period.jobs[jobType];
  const [actualValue, setActualValue] = useState(
    job.actualNetCents === null
      ? ""
      : centsToDollars(job.actualNetCents).toFixed(2),
  );
  const difference = job.differenceCents;
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
    await onSaveActual(period, jobType, actualValue);
  }

  return (
    <article className="rounded-md border border-white/15 bg-black/20 backdrop-blur-md p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{period.label}</h2>
          <p className="mt-1 text-sm text-white/70">
            {formatDate(period.startDate)} - {formatDate(period.endDate)}
          </p>
        </div>
        <StatusPill tone={tone} differenceCents={difference} />
      </div>

      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <Metric label="Regular hours" value={`${formatHours(job.regularHours)}h`} />
        <Metric label="OT hours" value={`${formatHours(job.overtimeHours)}h`} />
        <Metric label="Total hours" value={`${formatHours(job.totalHours)}h`} />
        <Metric label="Pay date" value={period.paycheckDueDate ? formatDate(period.paycheckDueDate) : "Not ready"} />
      </div>

      <div className="my-4 border-t border-white/10" />

      <div className="rounded-md border border-white/15 bg-black/15 backdrop-blur-md p-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-white">{job.label} hours by week</h3>
          <span className="text-xs font-semibold text-white/70">
            {formatRate(job.regularRate)} base / {formatRate(job.overtimeRate)} OT
          </span>
        </div>
        <p className="mt-1 text-xs text-white/70">{job.rateNote}</p>
        <div className="mt-3 grid gap-2">
          {period.weeks.map((week) => (
            <WeekBreakdown key={week.id} jobType={jobType} week={week} />
          ))}
        </div>
      </div>

      <div className="my-4 border-t border-white/10" />

      <div className="grid gap-2 text-sm">
        <MoneyLine label="Expected gross" value={job.grossCents} />
        <MoneyLine label="Est. withholding" tone="negative" value={job.estimatedTaxCents} />
        <MoneyLine strong label="Expected take-home" value={job.estimatedNetCents} />
        {job.actualNetCents !== null ? (
          <>
            <MoneyLine label="Actual take-home" value={job.actualNetCents} />
            <MoneyLine
              label="Difference"
              tone={job.differenceCents !== null && job.differenceCents < 0 ? "negative" : undefined}
              value={Math.abs(job.differenceCents ?? 0)}
            />
          </>
        ) : null}
      </div>

      <AuditRead job={job} />

      <form className="mt-4 rounded-md border border-white/15 bg-black/15 backdrop-blur-md p-3" onSubmit={submit}>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-white/85">
          Actual {job.label} check
        </label>
        <div className="mt-2 flex gap-2">
          <input
            className="h-10 min-w-0 flex-1 rounded-md border border-white/20 bg-black/20 backdrop-blur-md px-3 text-sm outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white/40"
            disabled={!period.actualWeekId}
            inputMode="decimal"
            onChange={(event) => setActualValue(event.target.value)}
            placeholder="0.00"
            type="number"
            value={actualValue}
          />
          <button
            className="h-10 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-white/20"
            disabled={!period.actualWeekId}
            type="submit"
          >
            Save
          </button>
        </div>
        <p className="mt-2 text-xs text-white/70">
          Paste the net {job.label} amount from UKG. ShiftlyCash compares it to expected take-home.
        </p>
      </form>
    </article>
  );
}

function WeekBreakdown({
  jobType,
  week,
}: {
  jobType: PaycheckJobKey;
  week: PaycheckPeriod["weeks"][number];
}) {
  const job = week.jobs[jobType];

  return (
    <div className="grid gap-2 rounded-md border border-white/10 bg-black/20 backdrop-blur-md px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        <p className="font-semibold text-white">
          Week {week.displayWeekNumber}{" "}
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-white/70">
            {week.role === "week_1" ? "first half" : "paycheck week"}
          </span>
        </p>
        <p className="text-xs text-white/70">
          {formatDate(week.startDate)} - {formatDate(week.endDate)}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-right">
        <MiniStat label="Reg" value={`${formatHours(job.regularHours)}h`} />
        <MiniStat label="OT" value={`${formatHours(job.overtimeHours)}h`} />
        <MiniStat label="Gross" value={formatMoney(job.grossCents)} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-white/70">
        {label}
      </span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

function AuditRead({ job }: { job: PaycheckJobSummary }) {
  const difference = job.differenceCents;
  const classes =
    difference === null
      ? "border-white/15 bg-black/15 backdrop-blur-md text-white/70"
      : difference < -100
        ? "border-red-300/60 bg-red-500/15 text-red-200"
        : difference > 100
          ? "border-emerald-300/50 bg-emerald-500/15 text-emerald-300"
          : "border-sky-300/50 bg-sky-500/15 text-sky-200";
  const message =
    difference === null
      ? `Expected ${job.label} net is ${formatMoney(job.estimatedNetCents)} from ${formatHours(job.totalHours)} total hours. Add the UKG net check to see if the paycheck is short.`
      : difference < -100
        ? `Short by ${formatMoney(Math.abs(difference))}. First compare UKG gross to ${formatMoney(job.grossCents)}; if gross matches, the gap is likely deductions or withholding.`
        : difference > 100
          ? `Over by ${formatMoney(difference)}. Check UKG for extra pay, bonus pay, or lower withholding than the model expected.`
          : `Within ${formatMoney(Math.abs(difference))} of the estimate. This paycheck is close enough to call matched.`;

  return (
    <div className={`mt-4 rounded-md border px-3 py-2 text-sm font-medium ${classes}`}>
      {message}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/15 backdrop-blur-md px-3 py-2">
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-white/70">
        {label}
      </span>
      <span className="text-base font-semibold text-white">{value}</span>
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
      <span className={strong ? "font-semibold" : "text-white/70"}>{label}</span>
      <span
        className={[
          strong ? "text-base font-bold" : "font-semibold",
          tone === "negative" ? "text-red-300" : "text-white",
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
    neutral: "border-white/15 bg-black/15 backdrop-blur-md text-white/70",
    short: "border-red-300/60 bg-red-500/15 text-red-300",
    over: "border-emerald-300/50 bg-emerald-500/15 text-emerald-300",
    match: "border-sky-300/50 bg-sky-500/15 text-emerald-300",
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
          ? "rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-300"
          : "rounded-full bg-sky-500/15 px-3 py-1 text-xs font-semibold text-emerald-300"
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

function formatRate(value: number): string {
  return `${value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}/hr`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
