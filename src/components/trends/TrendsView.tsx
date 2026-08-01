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

        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-5 shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Weekly cashflow
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                Earnings minus spending minus fixed, per week.
              </p>
            </div>
            <div className="flex gap-5">
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
    <div className="text-right">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// Collapsed row height drives the "ten weeks deep, then scroll" viewport.
const WEEK_ROW_PX = 46;
const VISIBLE_WEEK_ROWS = 10;

/**
 * Vertical cashflow rail, newest week at the top.
 *
 * Monochrome by design: no hue scale. A week's bar is hollow when the money
 * was low, fills toward solid as it climbs, and glows white when it reaches
 * the $1,000 reference — the light itself is the reading. Negative weeks stay
 * an empty outline. Hover (or keyboard focus) scales the row up, boosts the
 * glow, and unfolds the week's numbers.
 */
function WeeklyCashflowChart({
  weeks,
  medianCents,
}: {
  weeks: TrendsWeek[];
  medianCents: number;
}) {
  const ordered = useMemo(() => [...weeks].reverse(), [weeks]);
  const maxPos = Math.max(
    TARGET_LINE_CENTS,
    ...weeks.map((w) => w.cashflowCents),
  );
  const maxNeg = Math.max(0, ...weeks.map((w) => -w.cashflowCents));
  const total = maxPos + maxNeg || 1;
  // Shared horizontal scale: zero sits right of the space negatives need.
  const zeroPct = (maxNeg / total) * 100;
  const targetPct = zeroPct + (TARGET_LINE_CENTS / total) * 100;
  const medianPct = zeroPct + (medianCents / total) * 100;

  return (
    <div className="w-full">
      <div
        className="overflow-y-auto overscroll-contain pr-1"
        style={{ maxHeight: WEEK_ROW_PX * VISIBLE_WEEK_ROWS }}
      >
        <div className="relative">
          {/* Vertical guides span the full scroll height, behind the rows. */}
          {maxNeg > 0 ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px bg-[var(--chart-zero)]"
              style={{ left: `${zeroPct}%` }}
            />
          ) : null}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-[rgba(255,255,255,0.35)]"
            style={{ left: `${targetPct}%` }}
          />
          {medianCents > 0 ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px border-l border-dashed border-[var(--chart-grid)]"
              style={{ left: `${medianPct}%` }}
            />
          ) : null}

          <ol>
            {ordered.map((week, index) => (
              <CashflowWeekRow
                isLatest={index === 0}
                key={week.weekId}
                total={total}
                week={week}
                zeroPct={zeroPct}
              />
            ))}
          </ol>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
        <span>Hollow = low</span>
        <span>Brighter = closer to the $1,000 line</span>
        <span>Glowing white = at or above it</span>
        <span>Outline only = negative week</span>
        <span>Dashed = median</span>
      </div>
    </div>
  );
}

function CashflowWeekRow({
  isLatest,
  total,
  week,
  zeroPct,
}: {
  isLatest: boolean;
  total: number;
  week: TrendsWeek;
  zeroPct: number;
}) {
  const router = useRouter();
  const cents = week.cashflowCents;
  const negative = cents < 0;
  // 0 → hollow, 1 → white-hot at the $1,000 reference. Negatives stay 0.
  const ratio = negative
    ? 0
    : Math.min(1, cents / TARGET_LINE_CENTS);
  const widthPct = Math.max(0.75, (Math.abs(cents) / total) * 100);
  const leftPct = negative ? zeroPct - widthPct : zeroPct;
  const fillAlpha = Math.pow(ratio, 1.5) * 0.92;
  const borderAlpha = negative ? 0.22 : 0.25 + 0.55 * ratio;
  const glow =
    ratio >= 1
      ? "0 0 26px rgba(255,255,255,0.75), 0 0 8px rgba(255,255,255,0.55)"
      : ratio > 0.35
        ? `0 0 ${Math.round(4 + 20 * ratio)}px rgba(255,255,255,${(0.12 + 0.5 * ratio).toFixed(2)})`
        : "none";
  const open = () => router.push(`/history/${week.weekId}`);

  return (
    <li className="group relative">
      <div
        className="cursor-pointer rounded-lg border border-transparent px-2 py-1.5 outline-none transition-all duration-150 group-hover:z-10 group-hover:scale-[1.015] group-hover:border-[var(--border-default)] group-hover:bg-[var(--surface-hover)] group-hover:shadow-[0_0_24px_-8px_rgba(255,255,255,0.35)] group-focus-within:z-10 group-focus-within:scale-[1.015] group-focus-within:border-[var(--border-default)] group-focus-within:bg-[var(--surface-hover)]"
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
        role="link"
        tabIndex={0}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--text-primary)]">
            {shortDate(week.startDate)}
            {week.status === "active" ? (
              <span className="ml-2 normal-case tracking-normal text-[var(--text-muted)]">
                in progress
              </span>
            ) : null}
          </span>
          <span
            className="text-xs font-semibold tabular-nums text-[var(--text-primary)]"
            style={{ opacity: negative ? 0.75 : 0.55 + 0.45 * ratio }}
          >
            {formatMoney(cents)}
          </span>
        </div>
        <div className="relative mt-1 h-3">
          <span
            className={`absolute inset-y-0 rounded-full border transition-all duration-150 group-hover:brightness-125 ${
              week.status === "active" ? "border-dashed" : ""
            }`}
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              borderColor: `rgba(255,255,255,${borderAlpha.toFixed(2)})`,
              backgroundColor:
                fillAlpha > 0
                  ? `rgba(255,255,255,${fillAlpha.toFixed(2)})`
                  : "transparent",
              boxShadow: glow,
            }}
          />
        </div>
        {/* Unfolds on hover/focus, same mechanic as the energy timeline. */}
        <div className="grid grid-rows-[0fr] opacity-0 transition-all duration-200 group-hover:grid-rows-[1fr] group-hover:opacity-100 group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100">
          <div className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5 text-xs text-[var(--text-muted)]">
              <span>
                Wk {week.weekNumber} · {shortDate(week.startDate)} –{" "}
                {shortDate(week.endDate)}
              </span>
              <span>Earned {formatMoney(week.earningsCents)}</span>
              <span>Spent {formatMoney(week.spendCents)}</span>
              <span>Fixed {formatMoney(week.baseCents)}</span>
              <span
                className="font-semibold tabular-nums"
                style={{
                  color:
                    cents >= TARGET_LINE_CENTS
                      ? "rgba(255,255,255,0.95)"
                      : "var(--text-tertiary)",
                }}
              >
                {cents >= TARGET_LINE_CENTS
                  ? `+${formatMoney(cents - TARGET_LINE_CENTS)} over the $1,000 line`
                  : `${formatMoney(TARGET_LINE_CENTS - cents)} short of $1,000`}
              </span>
              {isLatest ? (
                <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 font-semibold text-[var(--text-tertiary)]">
                  Latest
                </span>
              ) : null}
              <span className="ml-auto text-[var(--text-muted)]">
                Click to open week
              </span>
            </div>
          </div>
        </div>
      </div>
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
