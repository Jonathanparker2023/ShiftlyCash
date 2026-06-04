"use client";

import { useMemo, useState } from "react";

import { centsToDollars } from "@/lib/domain/money";
import { cashflowWeeklyTone } from "@/lib/domain/legacyRules";
import type { TrendsData, TrendsWeek } from "@/lib/trends/data";

type RangeKey = "12w" | "26w" | "ytd" | "all";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "12w", label: "12W" },
  { key: "26w", label: "26W" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
];

const TONE_FILL: Record<string, string> = {
  positive: "#16a34a",
  amber: "#f59e0b",
  negative: "#dc2626",
};

export function TrendsView({ initialData }: { initialData: TrendsData }) {
  const [range, setRange] = useState<RangeKey>("ytd");

  const weeks = useMemo(
    () => filterByRange(initialData.weeks, range),
    [initialData.weeks, range],
  );

  const stats = useMemo(() => {
    const values = weeks.map((w) => w.cashflowCents);
    return {
      count: values.length,
      median: median(values),
      average: values.length
        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        : 0,
    };
  }, [weeks]);

  return (
    <main className="min-h-screen px-4 py-6 text-white sm:px-6 lg:px-8">
      <section className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
              ShiftlyCash
            </p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Trends</h1>
            <p className="mt-1.5 text-sm text-white/65">
              How your weekly cashflow moves over time.
            </p>
          </div>
          <RangeSelector range={range} onChange={setRange} />
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Weekly cashflow
              </h2>
              <p className="mt-0.5 text-xs text-white/55">
                Earnings minus spending minus fixed, per week.
              </p>
            </div>
            <div className="flex gap-5">
              <Stat label="Median" value={formatMoney(stats.median)} />
              <Stat label="Average" value={formatMoney(stats.average)} />
              <Stat label="Weeks" value={String(stats.count)} />
            </div>
          </div>

          {weeks.length === 0 ? (
            <div className="py-16 text-center text-sm text-white/55">
              No weeks in this range yet.
            </div>
          ) : (
            <WeeklyCashflowChart weeks={weeks} medianCents={stats.median} />
          )}
        </section>
      </section>
    </main>
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
    <div className="inline-flex rounded-full border border-white/15 bg-white/[0.06] p-1 backdrop-blur-md">
      {RANGES.map((option) => (
        <button
          key={option.key}
          className={[
            "rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
            range === option.key
              ? "bg-white/15 text-white"
              : "text-white/55 hover:text-white",
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
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-white/45">
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

const VBW = 1000;
const VBH = 280;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

function WeeklyCashflowChart({
  weeks,
  medianCents,
}: {
  weeks: TrendsWeek[];
  medianCents: number;
}) {
  const maxPos = Math.max(0, ...weeks.map((w) => w.cashflowCents));
  const maxNeg = Math.max(0, ...weeks.map((w) => -w.cashflowCents));
  const total = maxPos + maxNeg || 1;
  const plotH = VBH - PAD_TOP - PAD_BOTTOM;
  const zeroY = PAD_TOP + (maxPos / total) * plotH;
  const slot = VBW / weeks.length;
  const barW = Math.min(slot * 0.6, 46);
  const labelEvery = Math.ceil(weeks.length / 12);

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
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={1}
          x1={0}
          x2={VBW}
          y1={zeroY}
          y2={zeroY}
        />
        {/* median guide */}
        {medianCents !== 0 ? (
          <line
            stroke="rgba(255,255,255,0.18)"
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
          const fill = TONE_FILL[cashflowWeeklyTone(week.cashflowCents)];
          const valueY = yFor(week.cashflowCents, zeroY, maxPos, maxNeg, plotH);
          const barH = Math.max(1, Math.abs(valueY - zeroY));
          const barY = week.cashflowCents >= 0 ? valueY : zeroY;

          return (
            <g key={week.weekId}>
              <rect
                fill={fill}
                height={barH}
                opacity={week.status === "active" ? 0.55 : 1}
                rx={3}
                width={barW}
                x={cx - barW / 2}
                y={barY}
              >
                <title>{`${week.startDate} · ${formatMoney(week.cashflowCents)}`}</title>
              </rect>
              {i % labelEvery === 0 ? (
                <text
                  fill="rgba(255,255,255,0.5)"
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
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-white/55">
        <LegendDot color={TONE_FILL.positive} label="On plan" />
        <LegendDot color={TONE_FILL.amber} label="Light" />
        <LegendDot color={TONE_FILL.negative} label="Short" />
        <span className="text-white/40">Dashed line = median · faded bar = current week</span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
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

function filterByRange(weeks: TrendsWeek[], range: RangeKey): TrendsWeek[] {
  if (range === "all") {
    return weeks;
  }
  if (range === "ytd") {
    const latest = weeks.at(-1)?.startDate;
    const year = latest ? latest.slice(0, 4) : "2026";
    return weeks.filter((w) => w.startDate >= `${year}-01-01`);
  }
  const n = range === "12w" ? 12 : 26;
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
