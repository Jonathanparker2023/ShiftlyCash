"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { removeEvChargeAllocationAction } from "@/app/(protected)/trends/actions";
import { centsToDollars } from "@/lib/domain/money";
import type {
  TrendsData,
  TrendsEnergyTracker,
  TrendsWeek,
} from "@/lib/trends/data";

type RangeKey = "12w" | "ytd" | "all" | "custom";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "12w", label: "12W" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
  { key: "custom", label: "Custom" },
];

const TARGET_LINE_CENTS = 100_000; // $1,000 reference line

export function TrendsView({ initialData }: { initialData: TrendsData }) {
  const [range, setRange] = useState<RangeKey>("ytd");
  const [customWeeks, setCustomWeeks] = useState(10);

  const weeks = useMemo(
    () => filterByRange(initialData.weeks, range, customWeeks),
    [initialData.weeks, range, customWeeks],
  );

  const stats = useMemo(() => {
    const values = weeks.map((w) => w.cashflowCents);
    const total = values.reduce((a, b) => a + b, 0);
    return {
      count: values.length,
      total,
      median: median(values),
      average: values.length ? Math.round(total / values.length) : 0,
    };
  }, [weeks]);

  return (
    <main className="min-h-screen px-4 py-6 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <section className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
              Bashflow
            </p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Trends</h1>
            <p className="mt-1.5 text-sm text-[var(--text-tertiary)]">
              How your weekly cashflow moves over time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RangeSelector range={range} onChange={setRange} />
            {range === "custom" ? (
              <div className="flex items-center gap-1.5">
                <input
                  className="h-9 w-16 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-2 text-center text-sm font-semibold text-[var(--text-primary)] outline-none backdrop-blur-md focus:border-[var(--border-default)]"
                  inputMode="numeric"
                  max={53}
                  min={2}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isInteger(parsed)) {
                      setCustomWeeks(Math.min(53, Math.max(2, parsed)));
                    }
                  }}
                  type="number"
                  value={customWeeks}
                />
                <span className="text-xs font-semibold text-[var(--text-tertiary)]">wks</span>
              </div>
            ) : null}
          </div>
        </header>

        <section className="rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 shadow-[var(--panel-shadow)] sm:p-5">
          <div className="mb-4 flex flex-col gap-4 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Weekly cashflow
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                Earnings minus spending minus fixed, per week.
              </p>
            </div>
            <div className="grid grid-cols-4 gap-x-4 sm:gap-x-6">
              <Stat label="Total" value={formatMoney(stats.total)} />
              <Stat label="Median" value={formatMoney(stats.median)} />
              <Stat label="Average" value={formatMoney(stats.average)} />
              <Stat label="Weeks" value={String(stats.count)} />
            </div>
          </div>

          {weeks.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--text-tertiary)]">
              No weeks in this range yet.
            </div>
          ) : (
            <WeeklyCashflowChart weeks={weeks} medianCents={stats.median} />
          )}

          <EnergyTracker
            archived
            emptyMessage="Gas history is preserved as a frozen record."
            eventLabel="fill"
            title="Gas history"
            tracker={initialData.gasTracker}
          />
          <EnergyTracker
            emptyMessage="Tag your first charging transaction as EV Charge to start the daily average."
            eventLabel="charge"
            title="EV charging - Onyx"
            tracker={initialData.evChargeTracker}
          />
        </section>
      </section>
    </main>
  );
}

function EnergyTracker({
  archived,
  emptyMessage,
  eventLabel,
  title,
  tracker,
}: {
  archived?: boolean;
  emptyMessage: string;
  eventLabel: "fill" | "charge";
  title: string;
  tracker: TrendsEnergyTracker;
}) {
  const isActive = tracker.status === "active";

  return (
    <section className="mt-5 border-t border-[var(--border-subtle)] pt-5">
      {archived ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
            {title}
          </h2>
          <span className="rounded-full border border-[var(--border-default)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Ended Jul 30, 2026
          </span>
        </div>
      ) : (
        <h2 className="mb-3 text-base font-semibold tracking-tight text-[var(--text-primary)]">
          {title}
        </h2>
      )}
      {isActive ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
          <div className="grid grid-cols-2 divide-x divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
            <GasAverageMetric
              label="Total average"
              valueCents={tracker.averageDailyCents}
            />
            <GasAverageMetric
              accent
              label="Rolling 7 day average"
              valueCents={tracker.last7d.avgPerDayCents}
            />
          </div>
          <div className="grid grid-cols-2 divide-x divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
            <GasMetric
              label="30 day average"
              value={`${formatMoney(tracker.last30d.avgPerDayCents)}/d`}
            />
            <GasMetric
              label={`Avg ${eventLabel}`}
              value={formatMoney(tracker.last30d.avgPerEventCents)}
            />
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent-brand-text)]">
            {title}
          </p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-4xl">
            Waiting for a {eventLabel}
          </h2>
          <p className="mt-1.5 max-w-xl text-sm text-[var(--text-tertiary)]">
            {emptyMessage}
          </p>
        </div>
      )}

      {isActive ? (
        <>
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            {formatMoney(tracker.totalCents)} spread across {tracker.periodDays}{" "}
            days from {shortDate(tracker.periodStartDate)} through{" "}
            {shortDate(tracker.periodEndDate)}.
          </p>
          {eventLabel === "charge" && tracker.weeklyAverages.length > 0 ? (
            <details className="group mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-[var(--text-secondary)] marker:hidden">
                <span>Weekly averages</span>
                <span className="text-xs font-medium tabular-nums text-[var(--accent-brand-text)] group-open:hidden">
                  {formatMoney(tracker.weeklyAverages[0].averageDailyCents)}/day
                </span>
                <span className="hidden text-xs font-medium text-[var(--text-muted)] group-open:inline">
                  Hide weeks
                </span>
              </summary>
              <ol className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
                {tracker.weeklyAverages.map((week) => (
                  <li
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                    key={week.weekId}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        Week {week.weekNumber}
                        {week.status === "active" ? (
                          <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-[var(--accent-brand-text)]">
                            In progress
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {shortDate(week.startDate)} - {shortDate(week.endDate)}
                        {week.eventCount > 0
                          ? `, ${week.eventCount} ${week.eventCount === 1 ? "charge" : "charges"}`
                          : ", no charges"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-[var(--accent-brand-text)]">
                        {formatMoney(week.averageDailyCents)}/day
                      </p>
                      <p className="text-[11px] tabular-nums text-[var(--text-muted)]">
                        {week.periodDays} {week.periodDays === 1 ? "day" : "days"}
                      </p>
                    </div>
                    <p className="col-span-2 text-left text-xs font-medium tabular-nums text-[var(--text-tertiary)] sm:col-span-1 sm:text-right">
                      {formatMoneyExact(week.totalCents)} total
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          <details className="group mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-[var(--text-secondary)] marker:hidden">
              <span>{eventLabel === "fill" ? "Fill-up" : "Charging"} history</span>
              <span className="text-xs font-medium text-[var(--text-muted)] group-open:hidden">
                {tracker.events.length} tagged {eventLabel}s
              </span>
              <span className="hidden text-xs font-medium text-[var(--text-muted)] group-open:inline">
                Hide history
              </span>
            </summary>
            {/* Vertical timeline, newest first. tracker.events already arrives
                sorted descending by date, so index 0 is the most recent event
                and events[index + 1] is always the one before it — which is
                what the interval maths below leans on. */}
            <ol className="relative border-t border-[var(--border-subtle)] px-3 py-3">
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-6 left-[1.4rem] top-6 w-px bg-[var(--border-subtle)]"
              />
              {tracker.events.map((event, index) => {
                const previous = tracker.events[index + 1];
                return (
                  <EnergyTimelineRow
                    event={event}
                    eventLabel={eventLabel}
                    gapDays={
                      previous ? daysBetweenIso(previous.date, event.date) : null
                    }
                    isLatest={index === 0}
                    key={event.id}
                  />
                );
              })}
            </ol>
          </details>
        </>
      ) : null}
    </section>
  );
}

function EnergyTimelineRow({
  event,
  eventLabel,
  gapDays,
  isLatest,
}: {
  event: { id: string; date: string; merchantName: string; amountCents: number };
  eventLabel: "fill" | "charge";
  gapDays: number | null;
  isLatest: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only charges are removable. Gas is frozen history at this point, and
  // duplicate Plaid rows are a live problem for charging only.
  const canRemove = eventLabel === "charge";
  // Only meaningful across a real interval. On a 1-day gap it just restates the
  // amount, and on same-day events there is no interval at all.
  const perDayCents =
    gapDays !== null && gapDays >= 2
      ? Math.round(event.amountCents / gapDays)
      : null;

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await removeEvChargeAllocationAction({ allocationId: event.id });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove.");
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <li className="group relative pl-8">
      <span
        aria-hidden
        className={`absolute left-[0.78rem] top-[1.05rem] z-10 h-[11px] w-[11px] rounded-full border-2 transition-all duration-150 ${
          isLatest
            ? "border-[var(--accent-brand-text)] bg-[var(--accent-brand-text)]"
            : "border-[var(--border-strong)] bg-[var(--surface-elevated)]"
        } group-hover:scale-125 group-hover:border-[var(--accent-brand-text)] group-hover:bg-[var(--accent-brand-text)]`}
      />
      <div
        className={`rounded-lg border border-transparent px-2.5 py-2 outline-none transition-all duration-150 group-hover:border-[var(--accent-brand-border)] group-hover:bg-[var(--surface-hover)] group-hover:shadow-[0_0_20px_-6px_var(--accent-brand)] group-focus-within:border-[var(--accent-brand-border)] group-focus-within:bg-[var(--surface-hover)] ${
          pending ? "opacity-50" : ""
        }`}
        tabIndex={0}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <span className="text-xs font-semibold text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--accent-brand-text)]">
            {shortDate(event.date)}
          </span>
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
            {event.merchantName}
          </span>
          {/* Exact cents. A rounded charge history cannot be reconciled against
              a bank statement, which is the whole point of keeping it. */}
          <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
            {formatMoneyExact(event.amountCents)}
          </span>
        </div>
        {/* Detail stays collapsed until hover/focus so the list reads as a
            scannable timeline at rest. */}
        <div className="grid grid-rows-[0fr] opacity-0 transition-all duration-200 group-hover:grid-rows-[1fr] group-hover:opacity-100 group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100">
          <div className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-[var(--text-muted)]">
              <span>{longDate(event.date)}</span>
              {gapDays === null ? (
                <span className="text-[var(--text-tertiary)]">
                  First {eventLabel} on record
                </span>
              ) : gapDays === 0 ? (
                // Multiple charges a day is normal for a Supercharger, so say
                // so plainly rather than "0 days since".
                <span className="text-[var(--text-tertiary)]">
                  Same day as the previous {eventLabel}
                </span>
              ) : (
                <span className="text-[var(--text-tertiary)]">
                  {gapDays} {gapDays === 1 ? "day" : "days"} since the previous{" "}
                  {eventLabel}
                </span>
              )}
              {perDayCents !== null ? (
                <span className="font-semibold tabular-nums text-[var(--accent-brand-text)]">
                  {formatMoneyExact(perDayCents)}/day over that stretch
                </span>
              ) : null}
              {isLatest ? (
                <span className="rounded-full bg-[var(--accent-brand-fill)] px-2 py-0.5 font-semibold text-[var(--accent-brand-text)]">
                  Most recent
                </span>
              ) : null}
              {canRemove && !confirming ? (
                <button
                  className="ml-auto rounded-md border border-[var(--border-default)] px-2 py-0.5 font-semibold text-[var(--text-tertiary)] transition-colors hover:border-[var(--accent-negative-border)] hover:text-[var(--accent-negative-text)]"
                  disabled={pending}
                  onClick={() => setConfirming(true)}
                  type="button"
                >
                  Delete
                </button>
              ) : null}
            </div>
            {confirming ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] px-2.5 py-2 text-xs">
                <span className="text-[var(--text-secondary)]">
                  Delete the {formatMoneyExact(event.amountCents)} charge on{" "}
                  {shortDate(event.date)}? It leaves the charging history and is
                  excluded from spending.
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <button
                    className="rounded-md px-2 py-0.5 font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    disabled={pending}
                    onClick={() => setConfirming(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-md bg-[var(--accent-negative)] px-2.5 py-1 font-semibold text-white disabled:opacity-60"
                    disabled={pending}
                    onClick={remove}
                    type="button"
                  >
                    {pending ? "Deleting…" : "Delete"}
                  </button>
                </span>
              </div>
            ) : null}
            {error ? (
              <p className="mt-1.5 text-xs text-[var(--accent-negative-text)]">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function GasAverageMetric({
  accent = false,
  label,
  valueCents,
}: {
  accent?: boolean;
  label: string;
  valueCents: number;
}) {
  return (
    <div className="min-w-0 px-3 py-3.5 sm:px-4">
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] sm:text-[0.65rem]">
        {label}
      </div>
      <div
        className={`mt-1 flex flex-wrap items-baseline gap-x-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl lg:text-3xl ${
          accent ? "text-[var(--accent-brand-text)]" : "text-[var(--text-primary)]"
        }`}
      >
        <span>{formatMoney(valueCents)}</span>
        <span className="text-[0.65em] font-medium text-[var(--text-tertiary)]">/ day</span>
      </div>
    </div>
  );
}

function GasMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5 text-right first:pl-3 last:pr-3">
      <div className="whitespace-nowrap text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 whitespace-nowrap text-sm font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

function RangeSelector({
  range,
  onChange,
}: {
  range: RangeKey;
  onChange: (range: RangeKey) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-1 backdrop-blur-md">
      {RANGES.map((option) => (
        <button
          key={option.key}
          className={[
            "rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
            range === option.key
              ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
          ].join(" ")}
          onClick={() => onChange(option.key)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-left sm:text-right">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="whitespace-nowrap text-[11px] font-semibold tabular-nums sm:text-sm">
        {value}
      </div>
    </div>
  );
}

const DEFAULT_VISIBLE_WEEKS = 12;

function WeeklyCashflowChart({
  weeks,
  medianCents,
}: {
  weeks: TrendsWeek[];
  medianCents: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const ordered = useMemo(() => [...weeks].reverse(), [weeks]);
  const visibleWeeks = showAll
    ? ordered
    : ordered.slice(0, DEFAULT_VISIBLE_WEEKS);
  const hiddenCount = Math.max(0, ordered.length - visibleWeeks.length);

  return (
    <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-base)]">
      <div className="hidden grid-cols-[28px_minmax(120px,0.7fr)_minmax(220px,1.3fr)_104px] items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] sm:grid">
        <span aria-hidden />
        <span>Week</span>
        <span>Cashflow composition</span>
        <span className="text-right">Net</span>
      </div>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-[24px] top-0 w-px bg-[var(--border-default)] sm:left-[26px]"
        />
        <ol className="relative divide-y divide-[var(--border-subtle)]">
          {visibleWeeks.map((week, index) => (
            <CashflowWeekRow
              isLatest={index === 0}
              key={week.weekId}
              medianCents={medianCents}
              week={week}
            />
          ))}
        </ol>
      </div>
      {hiddenCount > 0 ? (
        <button
          className="w-full border-t border-[var(--border-subtle)] px-4 py-3 text-xs font-semibold text-[var(--accent-brand-text)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-ring)]"
          onClick={() => setShowAll(true)}
          type="button"
        >
          Show {hiddenCount} earlier {hiddenCount === 1 ? "week" : "weeks"}
        </button>
      ) : ordered.length > DEFAULT_VISIBLE_WEEKS ? (
        <button
          className="w-full border-t border-[var(--border-subtle)] px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-ring)]"
          onClick={() => setShowAll(false)}
          type="button"
        >
          Show recent weeks only
        </button>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-[10px] font-medium text-[var(--text-muted)] sm:px-4">
        <div className="flex items-center gap-3 tabular-nums">
          <span>Target {formatMoney(TARGET_LINE_CENTS)}</span>
          <span>Median {formatMoney(medianCents)}</span>
        </div>
        <span>Select a week to open its history</span>
      </div>
    </div>
  );
}

function CashflowWeekRow({
  isLatest,
  medianCents,
  week,
}: {
  isLatest: boolean;
  medianCents: number;
  week: TrendsWeek;
}) {
  const router = useRouter();
  const cents = week.cashflowCents;
  const negative = cents < 0;
  const hitTarget = cents >= TARGET_LINE_CENTS;
  const belowMedian = !negative && medianCents > 0 && cents < medianCents;
  const progressPct = Math.max(
    cents === 0 ? 0 : 2,
    Math.min(100, (Math.abs(cents) / TARGET_LINE_CENTS) * 100),
  );
  const barColor = negative
    ? "var(--accent-negative)"
    : hitTarget
      ? "var(--accent-primary)"
      : belowMedian
        ? "var(--text-muted)"
        : "var(--accent-brand)";
  const amountColor = negative
    ? "var(--accent-negative-text)"
    : hitTarget
      ? "var(--accent-primary-text)"
      : belowMedian
        ? "var(--text-secondary)"
        : "var(--accent-brand-text)";
  const medianDelta = cents - medianCents;
  const open = () => router.push(`/history/${week.weekId}`);

  return (
    <li className="relative">
      <button
        aria-label={`Open week ${week.weekNumber}, cashflow ${formatMoney(cents)}`}
        className="group grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-3 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-ring)] sm:grid-cols-[28px_minmax(120px,0.7fr)_minmax(220px,1.3fr)_104px] sm:items-center sm:py-3.5"
        onClick={open}
        type="button"
      >
        <span
          aria-hidden
          className="relative z-[1] mt-1.5 h-2.5 w-2.5 justify-self-center rounded-full border-2 bg-[var(--surface-base)] transition-transform group-hover:scale-125 sm:mt-0"
          style={{
            borderColor:
              week.status === "active"
                ? "var(--accent-brand)"
                : hitTarget
                  ? "var(--accent-primary)"
                  : negative
                    ? "var(--accent-negative)"
                    : "var(--border-strong)",
          }}
        />

        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
              Week {week.weekNumber}
            </span>
            {week.status === "active" ? (
              <span className="hidden shrink-0 rounded-full border border-[var(--accent-brand-border)] bg-[var(--accent-brand-fill)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-brand-text)] sm:inline-flex">
                In progress
              </span>
            ) : isLatest ? (
              <span className="hidden shrink-0 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] sm:inline">
                Latest
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[11px] font-medium text-[var(--text-tertiary)]">
            {shortDate(week.startDate)} – {shortDate(week.endDate)}
          </span>
        </span>

        <span className="text-right sm:col-start-4 sm:row-start-1">
          <span
            className="block text-base font-semibold tabular-nums tracking-tight"
            style={{ color: amountColor }}
          >
            {cents > 0 ? "+" : ""}
            {formatMoney(cents)}
          </span>
          <span className="mt-0.5 block whitespace-nowrap text-[10px] font-medium tabular-nums text-[var(--text-muted)]">
            {medianDelta >= 0 ? "+" : "−"}
            {formatMoney(Math.abs(medianDelta))} vs median
          </span>
        </span>

        <span className="col-span-2 col-start-2 mt-2 min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:mt-0">
          <span className="relative block h-1.5 overflow-hidden rounded-full bg-[var(--surface-overlay)]">
            <span
              className="absolute inset-y-0 left-0 rounded-full transition-[width,filter] duration-200 group-hover:brightness-125"
              style={{
                backgroundColor: barColor,
                width: `${progressPct}%`,
              }}
            />
            <span
              aria-hidden
              className="absolute inset-y-[-2px] right-0 w-px bg-[var(--border-strong)]"
            />
          </span>
          <span className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-[10px] font-medium tabular-nums text-[var(--text-muted)]">
            <span className="truncate">Earn {formatMoney(week.earningsCents)}</span>
            <span className="truncate">Spend {formatMoney(week.spendCents)}</span>
            <span className="truncate">Fixed {formatMoney(week.baseCents)}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

function filterByRange(
  weeks: TrendsWeek[],
  range: RangeKey,
  customWeeks: number,
): TrendsWeek[] {
  if (range === "all") {
    return weeks;
  }
  if (range === "ytd") {
    const latest = weeks.at(-1)?.startDate;
    const year = latest ? latest.slice(0, 4) : "2026";
    return weeks.filter((w) => w.startDate >= `${year}-01-01`);
  }
  const n = range === "12w" ? 12 : customWeeks;
  return weeks.slice(-n);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(centsToDollars(cents));
}

// Exact cents. The headline averages stay rounded; individual events do not,
// because a charge history that rounds cannot be checked against a statement.
function formatMoneyExact(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centsToDollars(cents));
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00.000Z`));
}

// Spelled-out date for the timeline's hover detail, where the collapsed row
// already carries the short form.
function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00.000Z`));
}

// Whole days between two ISO dates. Parsed at UTC midnight so a local timezone
// offset can never shift the count by a day.
function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00.000Z`);
  const to = Date.parse(`${toIso}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000);
}
