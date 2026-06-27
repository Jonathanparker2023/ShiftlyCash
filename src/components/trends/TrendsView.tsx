"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { centsToDollars } from "@/lib/domain/money";
import type { TrendsData, TrendsGasTracker, TrendsWeek } from "@/lib/trends/data";

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

          <GasTracker tracker={initialData.gasTracker} />
        </section>
      </section>
    </main>
  );
}

function GasTracker({ tracker }: { tracker: TrendsGasTracker }) {
  return (
    <section className="mt-5 rounded-2xl border border-[var(--accent-brand-border)] bg-[var(--accent-brand-fill)] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-brand-text)]">
            Gas tracker
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            {tracker.status === "active"
              ? `${formatMoney(tracker.averageDailyGasCents)} per gas day`
              : "Waiting for today's fill"}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">
            {tracker.status === "active"
              ? "Gas is tracked separately from total spend and added one day at a time."
              : "Once you fill the tank and hit Gas on that transaction, this shows the daily gas math."}
          </p>
        </div>
        {tracker.status === "active" ? (
          <div className="grid grid-cols-2 gap-3 text-right sm:grid-cols-4">
            <Stat label="Gas total" value={formatMoney(tracker.gasAmountCents)} />
            <Stat label="Days" value={String(tracker.periodDays)} />
            <Stat label="Daily" value={formatMoney(tracker.averageDailyGasCents)} />
            <Stat label="Extra" value={formatMoney(tracker.remainderAmountCents)} />
          </div>
        ) : null}
      </div>
      <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-semibold text-[var(--text-tertiary)]">
        {tracker.status === "active" ? (
          <>
            <span className="text-[var(--text-secondary)]">{formatMoney(tracker.gasAmountCents)}</span>
            {" gas / "}
            <span className="text-[var(--text-secondary)]">{tracker.periodDays}</span>
            {" days = "}
            <span className="text-[var(--accent-brand-text)]">
              {formatMoney(tracker.averageDailyGasCents)}
            </span>
            {" daily. Period: "}
            <span className="text-[var(--text-secondary)]">
              {shortDate(tracker.periodStartDate)} to {shortDate(tracker.fillDate)}
            </span>
            {"."}
          </>
        ) : (
          "No gas fill logged yet. Use the Gas button after today's fill; the prior fill date is just the anchor."
        )}
      </div>
      {tracker.status === "active" ? (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Previous gas: {shortDate(tracker.previousFillDate)}. Source:{" "}
          {tracker.merchantName}. Store extras stay normal spend.
        </p>
      ) : null}
    </section>
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
                <title>{`${week.startDate} · ${formatMoney(week.cashflowCents)} — open week`}</title>
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
          $0 → $650 → $950+
        </span>
        <span className="text-[var(--text-muted)]">
          Solid line = $1,000 · dashed = median · faded = current week · confetti = $1,500+
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

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00.000Z`));
}
