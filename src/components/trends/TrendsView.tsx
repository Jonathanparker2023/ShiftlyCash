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
const CONFETTI_CENTS = 150_000; // $1,500+ weeks get confetti

// Continuous hue: full green at >= $950, yellow at $650, full red at <= $0.
const GREEN = [22, 163, 74];
const YELLOW = [245, 158, 11];
const RED = [220, 38, 38];

function cashflowHue(cents: number): string {
  const v = cents / 100;
  if (v >= 950) return rgb(GREEN);
  if (v >= 650) return rgb(mix(GREEN, YELLOW, (950 - v) / 300));
  if (v >= 0) return rgb(mix(YELLOW, RED, (650 - v) / 650));
  return rgb(RED);
}

const CONFETTI_COLORS = [
  "#f472b6",
  "#38bdf8",
  "#a78bfa",
  "#fbbf24",
  "#34d399",
  "#f87171",
];

// Deterministic pseudo-random so confetti doesn't shimmer between renders.
function pseudo(i: number, k: number): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function ConfettiBurst({
  cx,
  topY,
  seed,
  spread,
}: {
  cx: number;
  topY: number;
  seed: number;
  spread: number;
}) {
  const pieces = Array.from({ length: 14 }, (_, k) => {
    const x = cx + (pseudo(seed, k) - 0.5) * spread * 2.2;
    const y = topY - 6 - pseudo(seed, k + 20) * 22;
    const rot = Math.round(pseudo(seed, k + 40) * 360);
    const color = CONFETTI_COLORS[k % CONFETTI_COLORS.length];
    return { x, y, rot, color, key: k };
  });

  return (
    <g>
      {pieces.map((p) => (
        <rect
          fill={p.color}
          height={5.5}
          key={p.key}
          opacity={0.9}
          rx={1}
          transform={`rotate(${p.rot} ${p.x} ${p.y})`}
          width={2.6}
          x={p.x}
          y={p.y}
        />
      ))}
    </g>
  );
}

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((c, i) => Math.round(c + (b[i] - c) * t));
}

function rgb(c: number[]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

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
  const perDayCents =
    gapDays !== null && gapDays > 0
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

const VBW = 1000;
const VBH = 280;
const PAD_TOP = 34;
const PAD_BOTTOM = 28;

function WeeklyCashflowChart({
  weeks,
  medianCents,
}: {
  weeks: TrendsWeek[];
  medianCents: number;
}) {
  const router = useRouter();
  const maxPos = Math.max(
    TARGET_LINE_CENTS,
    ...weeks.map((w) => w.cashflowCents),
  );
  const maxNeg = Math.max(0, ...weeks.map((w) => -w.cashflowCents));
  const total = maxPos + maxNeg || 1;
  const plotH = VBH - PAD_TOP - PAD_BOTTOM;
  const zeroY = PAD_TOP + (maxPos / total) * plotH;
  const slot = VBW / weeks.length;
  const barW = Math.min(slot * 0.6, 46);
  const labelEvery = Math.ceil(weeks.length / 12);
  const targetY = yFor(TARGET_LINE_CENTS, zeroY, maxPos, maxNeg, plotH);

  return (
    <div className="w-full">
      <svg
        className="w-full"
        preserveAspectRatio="none"
        style={{ height: 280 }}
        viewBox={`0 0 ${VBW} ${VBH}`}
      >
        {/* zero baseline */}
        <line
          className="stroke-[var(--chart-zero)]"
          strokeWidth={1}
          x1={0}
          x2={VBW}
          y1={zeroY}
          y2={zeroY}
        />
        {/* $1,000 target line */}
        <line
          className="stroke-[var(--chart-axis)]"
          strokeWidth={1.25}
          x1={0}
          x2={VBW}
          y1={targetY}
          y2={targetY}
        />
        <text
          className="fill-[var(--chart-axis)]"
          fontSize={11}
          x={6}
          y={targetY - 5}
        >
          $1,000
        </text>
        {/* median guide */}
        {medianCents !== 0 ? (
          <line
            className="stroke-[var(--chart-grid)]"
            strokeDasharray="4 5"
            strokeWidth={1}
            x1={0}
            x2={VBW}
            y1={yFor(medianCents, zeroY, maxPos, maxNeg, plotH)}
            y2={yFor(medianCents, zeroY, maxPos, maxNeg, plotH)}
          />
        ) : null}

        {weeks.map((week, i) => {
          const cx = i * slot + slot / 2;
          const fill = cashflowHue(week.cashflowCents);
          const valueY = yFor(week.cashflowCents, zeroY, maxPos, maxNeg, plotH);
          const barH = Math.max(1, Math.abs(valueY - zeroY));
          const barY = week.cashflowCents >= 0 ? valueY : zeroY;

          return (
            <g
              className="cursor-pointer"
              key={week.weekId}
              onClick={() => router.push(`/history/${week.weekId}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  router.push(`/history/${week.weekId}`);
                }
              }}
              role="link"
              tabIndex={0}
            >
              {/* full-column transparent hit area so the whole week is clickable */}
              <rect fill="transparent" height={VBH} width={slot} x={i * slot} y={0} />
              <rect
                fill={fill}
                height={barH}
                opacity={week.status === "active" ? 0.55 : 1}
                rx={3}
                width={barW}
                x={cx - barW / 2}
                y={barY}
              >
                <title>{`${week.startDate} Â· ${formatMoney(week.cashflowCents)} â€” open week`}</title>
              </rect>
              {week.cashflowCents >= CONFETTI_CENTS ? (
                <ConfettiBurst cx={cx} seed={i + 1} spread={barW} topY={valueY} />
              ) : null}
              {i % labelEvery === 0 ? (
                <text
                  className="fill-[var(--chart-axis)]"
                  fontSize={11}
                  textAnchor="middle"
                  x={cx}
                  y={VBH - 9}
                >
                  {shortDate(week.startDate)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[var(--text-tertiary)]">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-16 rounded-sm"
            style={{
              background:
                "linear-gradient(90deg, rgb(220,38,38) 0%, rgb(245,158,11) 65%, rgb(22,163,74) 100%)",
            }}
          />
          $0 â†’ $650 â†’ $950+
        </span>
        <span className="text-[var(--text-muted)]">
          Solid line = $1,000 Â· dashed = median Â· faded = current week Â· confetti = $1,500+
        </span>
      </div>
    </div>
  );
}

function yFor(
  cents: number,
  zeroY: number,
  maxPos: number,
  maxNeg: number,
  plotH: number,
): number {
  if (cents >= 0) {
    const span = (maxPos / (maxPos + maxNeg || 1)) * plotH || 1;
    return zeroY - (maxPos ? (cents / maxPos) * span : 0);
  }
  const span = (maxNeg / (maxPos + maxNeg || 1)) * plotH || 1;
  return zeroY + (maxNeg ? (-cents / maxNeg) * span : 0);
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
