"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { savePaycheckActualAction } from "@/app/(protected)/paychecks/actions";
import {
  reconcilePaycheckAction,
  revertPaycheckReconciliationAction,
} from "@/app/(protected)/paychecks/reconcile-actions";
import { centsToDollars, dollarsToCents } from "@/lib/domain/money";
import type {
  PaycheckAuditData,
  PaycheckJobKey,
  PaycheckJobSummary,
  PaycheckPeriod,
  PaycheckReconciliation,
} from "@/lib/paychecks/data";

type SaveState = "idle" | "saving" | "saved" | "error";

export function PaycheckAuditPage({
  initialData,
}: {
  initialData: PaycheckAuditData;
}) {
  const [periods, setPeriods] = useState(initialData.periods);
  const jobList = periods[0]?.jobs ?? [];
  const [activeJob, setActiveJob] = useState<PaycheckJobKey>(
    jobList[0]?.key ?? "",
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function saveActual(
    period: PaycheckPeriod,
    jobKey: PaycheckJobKey,
    value: string,
  ) {
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
        jobType: jobKey,
        actualCents,
      });
      setPeriods((current) =>
        current.map((item) => {
          if (item.id !== period.id) {
            return item;
          }

          return {
            ...item,
            jobs: item.jobs.map((job) =>
              job.key === jobKey
                ? {
                    ...job,
                    actualNetCents: actualCents,
                    differenceCents:
                      actualCents === null
                        ? null
                        : actualCents - job.estimatedNetCents,
                  }
                : job,
            ),
          };
        }),
      );
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Unable to save paycheck.");
    }
  }

  async function reconcile(
    period: PaycheckPeriod,
    jobKey: PaycheckJobKey,
    actualCents: number,
  ) {
    if (!period.actualWeekId) return;
    setError(null);
    setSaveState("saving");
    try {
      const { reconciliation } = await reconcilePaycheckAction({
        weekId: period.actualWeekId,
        jobType: jobKey,
        actualCents,
        confirmedCorrect: true,
      });
      setPeriods((current) =>
        current.map((item) =>
          item.id !== period.id
            ? item
            : {
                ...item,
                jobs: item.jobs.map((job) =>
                  job.key === jobKey ? { ...job, reconciliation } : job,
                ),
              },
        ),
      );
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Unable to reconcile paycheck.");
    }
  }

  async function revertReconciliation(
    period: PaycheckPeriod,
    jobKey: PaycheckJobKey,
  ) {
    if (!period.actualWeekId) return;
    setError(null);
    setSaveState("saving");
    try {
      await revertPaycheckReconciliationAction({
        weekId: period.actualWeekId,
        jobType: jobKey,
      });
      setPeriods((current) =>
        current.map((item) =>
          item.id !== period.id
            ? item
            : {
                ...item,
                jobs: item.jobs.map((job) =>
                  job.key === jobKey ? { ...job, reconciliation: null } : job,
                ),
              },
        ),
      );
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Unable to revert reconciliation.");
    }
  }

  const activeExists = jobList.some((job) => job.key === activeJob);
  const resolvedActiveJob = activeExists ? activeJob : (jobList[0]?.key ?? "");

  return (
    <main className="min-h-screen px-3 py-4 text-[var(--text-primary)] sm:px-4 lg:px-6">
      <section className="mx-auto max-w-7xl rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] backdrop-blur-md shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
        <div className="h-2 bg-[var(--accent-brand)]" />
        <div className="p-4 sm:p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                Paycheck audit
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">
                Pay-period check
              </h1>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Compare expected take-home against what the paycheck actually paid.
              </p>
            </div>
            <SaveBadge state={saveState} error={error} />
          </div>

          {jobList.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {jobList.length > 1 ? (
                <div className="mb-4 inline-flex flex-wrap gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-overlay)] backdrop-blur-md p-1 shadow-sm">
                  {jobList.map((job) => (
                    <button
                      key={job.key}
                      className={[
                        "rounded px-3 py-1.5 text-sm font-semibold transition",
                        resolvedActiveJob === job.key
                          ? "bg-[var(--accent-brand)] text-white"
                          : "text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)]",
                      ].join(" ")}
                      onClick={() => {
                        setActiveJob(job.key);
                        setSaveState("idle");
                        setError(null);
                      }}
                      type="button"
                    >
                      {job.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                {periods.map((period) => (
                  <PaycheckPeriodCard
                    key={`${period.id}-${resolvedActiveJob}`}
                    jobKey={resolvedActiveJob}
                    period={period}
                    onSaveActual={saveActual}
                    onReconcile={reconcile}
                    onRevert={revertReconciliation}
                  />
                ))}
              </div>

              <PeriodTotals periods={periods} />
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] backdrop-blur-md p-6 text-center text-sm text-[var(--text-tertiary)]">
      No paycheck jobs logged for the current or previous pay period yet. Log
      hours against a job and it shows up here automatically.
    </div>
  );
}

function PeriodTotals({ periods }: { periods: PaycheckPeriod[] }) {
  return (
    <div className="mt-6 border-t border-[var(--border-subtle)] pt-5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        Pay-period totals (all jobs)
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {periods.map((period) => (
          <PeriodTotalCard key={period.id} period={period} />
        ))}
      </div>
    </div>
  );
}

function PeriodTotalCard({ period }: { period: PaycheckPeriod }) {
  const estimatedTotalCents = period.jobs.reduce(
    (total, job) => total + job.estimatedNetCents,
    0,
  );
  const hasActuals =
    period.jobs.length > 0 &&
    period.jobs.every((job) => job.actualNetCents !== null);
  const actualTotalCents = hasActuals
    ? period.jobs.reduce((total, job) => total + (job.actualNetCents ?? 0), 0)
    : null;
  const heading = period.id === "previous" ? "Total prev" : "Total current";

  return (
    <article className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] backdrop-blur-md p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{heading}</h3>
        <span className="text-xs font-semibold text-[var(--text-tertiary)]">{period.label}</span>
      </div>
      <div className="mt-3 grid gap-2 text-sm">
        {period.jobs.map((job) => (
          <MoneyLine
            key={job.key}
            label={`${job.label} net`}
            value={job.estimatedNetCents}
          />
        ))}
        <MoneyLine strong label="Expected total" tone="positive" value={estimatedTotalCents} />
        {actualTotalCents !== null ? (
          <MoneyLine strong label="Actual total" value={actualTotalCents} />
        ) : null}
      </div>
    </article>
  );
}

function PaycheckPeriodCard({
  jobKey,
  period,
  onSaveActual,
  onReconcile,
  onRevert,
}: {
  jobKey: PaycheckJobKey;
  period: PaycheckPeriod;
  onSaveActual: (
    period: PaycheckPeriod,
    jobKey: PaycheckJobKey,
    value: string,
  ) => Promise<void>;
  onReconcile: (
    period: PaycheckPeriod,
    jobKey: PaycheckJobKey,
    actualCents: number,
  ) => Promise<void>;
  onRevert: (period: PaycheckPeriod, jobKey: PaycheckJobKey) => Promise<void>;
}) {
  const job = period.jobs.find((item) => item.key === jobKey);
  const [actualValue, setActualValue] = useState(
    job?.actualNetCents == null ? "" : centsToDollars(job.actualNetCents).toFixed(2),
  );
  const [confirmedCorrect, setConfirmedCorrect] = useState(false);

  // Editing the typed actual forces a fresh affirmation (never reuse an old
  // confirmation; reconcile always recomputes from base).
  useEffect(() => {
    setConfirmedCorrect(false);
  }, [actualValue]);

  if (!job) {
    return null;
  }

  // Parse exactly like saveActual: integer cents, finite, >= 0.
  const trimmedActual = actualValue.trim();
  const parsedCents = trimmedActual ? dollarsToCents(Number(trimmedActual)) : null;
  const actualIsValid =
    parsedCents !== null && Number.isFinite(parsedCents) && parsedCents >= 0;
  const actualIsZero = actualIsValid && parsedCents === 0;

  const recon = job.reconciliation;
  const isReconciled = recon?.status === "reconciled";
  const isStale = isReconciled && recon?.stale === true;
  const canReconcile =
    Boolean(period.actualWeekId) && actualIsValid && confirmedCorrect;

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
    await onSaveActual(period, jobKey, actualValue);
  }

  return (
    <article className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] backdrop-blur-md p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{period.label}</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
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

      <div className="my-4 border-t border-[var(--border-subtle)]" />

      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] backdrop-blur-md p-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{job.label} hours by week</h3>
          <span className="text-xs font-semibold text-[var(--text-tertiary)]">
            {formatRate(job.regularRate)} base / {formatRate(job.overtimeRate)} OT
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">{job.rateNote}</p>
        <div className="mt-3 grid gap-2">
          {period.weeks.map((week) => (
            <WeekBreakdown key={week.id} jobKey={jobKey} week={week} />
          ))}
        </div>
      </div>

      <div className="my-4 border-t border-[var(--border-subtle)]" />

      <div className="grid gap-2 text-sm">
        <MoneyLine label="Expected gross" value={job.grossCents} />
        <MoneyLine label="Est. withholding" tone="negative" value={job.estimatedTaxCents} />
        <MoneyLine strong label="Expected take-home" tone="positive" value={job.estimatedNetCents} />
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

      <form className="mt-4 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] backdrop-blur-md p-3" onSubmit={submit}>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          Actual {job.label} check
        </label>
        <div className="mt-2 flex gap-2">
          <input
            className="h-10 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-overlay)] backdrop-blur-md px-3 text-sm outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-ring)]"
            disabled={!period.actualWeekId}
            inputMode="decimal"
            onChange={(event) => setActualValue(event.target.value)}
            placeholder="0.00"
            type="number"
            value={actualValue}
          />
          <button
            className="h-10 rounded-md bg-[var(--accent-brand)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-brand-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-hover)]"
            disabled={!period.actualWeekId}
            type="submit"
          >
            Save
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Paste the net {job.label} amount from your paystub. ShiftlyCash compares it to expected take-home.
        </p>
      </form>

      {/* Reconcile — affirm the check, then scale this job's shifts to the actual. */}
      <div className="mt-4 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] backdrop-blur-md p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Reconcile to actual</h3>
          {isReconciled && recon ? (
            <ReconciledBadge recon={recon} stale={isStale} />
          ) : null}
        </div>

        {isStale ? (
          <div className="mt-2 rounded-md border border-[var(--accent-warning-border)] bg-[var(--accent-warning-fill)] px-3 py-2 text-xs font-medium text-[var(--accent-warning-text)]">
            Stale — the shifts changed since this was reconciled. The old factor
            no longer applies. Re-reconcile to scale the current shifts to the
            actual.
          </div>
        ) : null}

        <label className="mt-3 flex items-start gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-[var(--border-default)] bg-[var(--surface-overlay)]"
            checked={confirmedCorrect}
            disabled={!period.actualWeekId || !actualIsValid}
            onChange={(event) => setConfirmedCorrect(event.target.checked)}
          />
          <span>This check is correct — no dispute.</span>
        </label>

        {actualIsZero ? (
          <div className="mt-2 rounded-md border border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] px-3 py-2 text-xs font-medium text-[var(--accent-negative-text)]">
            Reconciling to $0.00 zeroes the take-home for every {job.label} shift
            in this period. Reversible with Undo, but it wipes this period&apos;s{" "}
            {job.label} earnings in every rollup until reverted.
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="h-10 rounded-md bg-[var(--accent-brand)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-brand-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-hover)]"
            disabled={!canReconcile}
            onClick={() => {
              if (parsedCents === null) return;
              void onReconcile(period, jobKey, parsedCents);
            }}
          >
            {isReconciled ? "Re-reconcile" : "Reconcile"}
          </button>

          {isReconciled ? (
            <button
              type="button"
              className="h-10 rounded-md border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)]"
              onClick={() => void onRevert(period, jobKey)}
            >
              Undo
            </button>
          ) : null}
        </div>

        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Distributes the actual net across every {job.label} shift in this period
          so your daily and weekly rollups match the real paycheck. Reversible.
        </p>
      </div>
    </article>
  );
}

function ReconciledBadge({
  recon,
  stale,
}: {
  recon: PaycheckReconciliation;
  stale: boolean;
}) {
  const factorLabel = formatFactor(recon.factor);
  return (
    <span
      className={[
        "inline-flex flex-col items-end rounded-md border px-3 py-1 text-right",
        stale
          ? "border-[var(--accent-warning-border)] bg-[var(--accent-warning-fill)] text-[var(--accent-warning-text)]"
          : "border-[var(--accent-primary-border)] bg-[var(--accent-primary-fill)] text-[var(--accent-primary-text)]",
      ].join(" ")}
    >
      <span className="text-xs font-semibold">
        Reconciled to actual — {formatMoney(recon.actualAmountCents)}
      </span>
      <span className="text-[0.65rem] font-medium opacity-90">
        {stale ? "factor stale" : `${factorLabel} across all shifts`}
      </span>
    </span>
  );
}

// Display-only. recon.factor is the float multiplier (actual/projected); null
// means projected was $0 (equal split, no meaningful percentage).
function formatFactor(factor: number | null): string {
  if (factor === null) return "even split";
  const pct = (factor - 1) * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "" : "±";
  return `${sign}${pct.toFixed(1)}%`;
}

function WeekBreakdown({
  jobKey,
  week,
}: {
  jobKey: PaycheckJobKey;
  week: PaycheckPeriod["weeks"][number];
}) {
  const job = week.jobs[jobKey];

  if (!job) {
    return null;
  }

  return (
    <div className="grid gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] backdrop-blur-md px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        <p className="font-semibold text-[var(--text-primary)]">
          Week {week.displayWeekNumber}{" "}
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            {week.role === "week_1" ? "first week" : "second week"}
          </span>
        </p>
        <p className="text-xs text-[var(--text-tertiary)]">
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
      <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <span className="font-semibold text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

function AuditRead({ job }: { job: PaycheckJobSummary }) {
  const difference = job.differenceCents;
  const classes =
    difference === null
      ? "border-[var(--border-subtle)] bg-[var(--surface-elevated)] backdrop-blur-md text-[var(--text-tertiary)]"
      : difference < -100
        ? "border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] text-[var(--accent-negative-text)]"
        : difference > 100
          ? "border-[var(--accent-primary-border)] bg-[var(--accent-primary-fill)] text-[var(--accent-primary-text)]"
          : "border-[var(--accent-brand-border)] bg-[var(--accent-brand-fill)] text-[var(--accent-brand-text)]";
  const message =
    difference === null
      ? `Expected ${job.label} net is ${formatMoney(job.estimatedNetCents)} from ${formatHours(job.totalHours)} total hours. Add the net check to see if the paycheck is short.`
      : difference < -100
        ? `Short by ${formatMoney(Math.abs(difference))}. First compare the paystub gross to ${formatMoney(job.grossCents)}; if gross matches, the gap is likely deductions or withholding.`
        : difference > 100
          ? `Over by ${formatMoney(difference)}. Check the paystub for extra pay, bonus pay, or lower withholding than the model expected.`
          : `Within ${formatMoney(Math.abs(difference))} of the estimate. This paycheck is close enough to call matched.`;

  return (
    <div className={`mt-4 rounded-md border px-3 py-2 text-sm font-medium ${classes}`}>
      {message}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] backdrop-blur-md px-3 py-2">
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <span className="text-base font-semibold text-[var(--text-primary)]">{value}</span>
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
  tone?: "negative" | "positive";
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? "font-semibold" : "text-[var(--text-tertiary)]"}>{label}</span>
      <span
        className={[
          strong ? "text-base font-bold" : "font-semibold",
          tone === "negative"
            ? "text-[var(--accent-negative-text)]"
            : tone === "positive"
              ? "text-[var(--accent-primary-text)] drop-shadow-[0_0_12px_rgba(110,231,183,0.6)]"
              : "text-[var(--text-primary)]",
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
    neutral: "border-[var(--border-subtle)] bg-[var(--surface-elevated)] backdrop-blur-md text-[var(--text-tertiary)]",
    short: "border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] text-[var(--accent-negative-text)]",
    over: "border-[var(--accent-primary-border)] bg-[var(--accent-primary-fill)] text-[var(--accent-primary-text)]",
    match: "border-[var(--accent-brand-border)] bg-[var(--accent-brand-fill)] text-[var(--accent-primary-text)]",
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
          ? "rounded-full bg-[var(--accent-negative-fill)] px-3 py-1 text-xs font-semibold text-[var(--accent-negative-text)]"
          : "rounded-full bg-[var(--accent-brand-fill)] px-3 py-1 text-xs font-semibold text-[var(--accent-primary-text)]"
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
