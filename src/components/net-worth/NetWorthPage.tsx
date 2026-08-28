"use client";

import { useMemo, useState } from "react";

import { centsToDollars } from "@/lib/domain/money";
import { visibleNetWorthPoints } from "@/lib/domain/netWorth";
import type { NetWorthProjectionPoint } from "@/lib/domain/netWorth";
import type { NetWorthPageData } from "@/lib/net-worth/data";

type Timeframe = "1m" | "3m" | "1y" | "3y" | "all";

const TIMEFRAMES: Array<{ id: Timeframe; label: string; weeks: number }> = [
  { id: "1m", label: "1M", weeks: 4 },
  { id: "3m", label: "3M", weeks: 13 },
  { id: "1y", label: "1Y", weeks: 52 },
  { id: "3y", label: "3Y", weeks: 156 },
  { id: "all", label: "All", weeks: Number.POSITIVE_INFINITY },
];

export function NetWorthPage({ initialData }: { initialData: NetWorthPageData }) {
  const [timeframe, setTimeframe] = useState<Timeframe>("all");
  const selected = TIMEFRAMES.find((item) => item.id === timeframe) ?? TIMEFRAMES.at(-1)!;
  const visiblePoints = useMemo(
    () =>
      visibleNetWorthPoints(
        initialData.projectionPoints,
        selected.weeks === Number.POSITIVE_INFINITY
          ? initialData.projectionPoints.at(-1)?.week ?? 0
          : selected.weeks,
      ),
    [initialData.projectionPoints, selected.weeks],
  );
  const endingPoint = visiblePoints.at(-1) ?? initialData.projectionPoints[0];
  const interestShare =
    endingPoint && endingPoint.totalCents > 0
      ? Math.round((endingPoint.interestCents / endingPoint.totalCents) * 100)
      : 0;

  return (
    <div className="min-h-screen px-4 py-5 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <header className="mx-auto mb-5 max-w-7xl border-b border-[var(--border-subtle)] pb-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_300px] lg:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              Bashflow
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
              Net Worth
            </h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Turn weekly surplus into a clean principal versus compounding view.
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Pulling {initialData.projectionSource.closedWeekCount} closed weeks.
              Contribution = cashflow avg{" "}
              {formatMoney(initialData.projectionSource.cashflowAverageCents)} -
              weekly tax{" "}
              {formatMoney(initialData.projectionSource.weeklyTaxDueCents)}.
            </p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]" suppressHydrationWarning>
              {initialData.cashBalanceAsOf
                ? `Cash balance last refreshed ${formatTimestamp(initialData.cashBalanceAsOf)}`
                : "No live balance fetched yet."}
            </p>
          </div>
          <Metric
            label="Current net worth"
            sub={`${formatMoney(initialData.totalAssetValueCents)} assets - ${formatMoney(initialData.totalDebtCents)} debt`}
            tone={initialData.startingBalanceCents >= 0 ? "green" : "red"}
            value={formatMoney(initialData.startingBalanceCents)}
          />
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Weekly contribution"
            sub="Auto-pulled from cashflow surplus"
            tone="green"
            value={formatMoney(initialData.weeklyContributionCents)}
          />
          <Metric
            label="Assumed return"
            sub="Compounded weekly"
            tone="purple"
            value={`${Math.round(initialData.annualReturnRate * 100)}%`}
          />
          <Metric
            label={`${selected.label} projected value`}
            sub={`${interestShare}% from interest`}
            tone="blue"
            value={formatMoney(endingPoint?.totalCents ?? 0)}
          />
          <Metric
            label="Interest earned"
            sub={`${formatMoney(endingPoint?.principalCents ?? 0)} principal`}
            tone="amber"
            value={formatMoney(endingPoint?.interestCents ?? 0)}
          />
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] backdrop-blur-md shadow-[0_18px_50px_rgba(0,0,0,0.25)]">
          <div className="flex flex-col gap-4 border-b border-[var(--border-default)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
                Projection chart
              </h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Principal is the base layer. Interest stacks on top as compounding takes over.
              </p>
            </div>
            <div className="flex w-max rounded-full border border-[var(--border-default)] bg-[var(--surface-overlay)] backdrop-blur-md p-1">
              {TIMEFRAMES.map((item) => (
                <button
                  className={
                    item.id === timeframe
                      ? "rounded-full bg-[var(--accent-brand)] px-3 py-1.5 text-sm font-bold text-white"
                      : "rounded-full px-3 py-1.5 text-sm font-bold text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)]"
                  }
                  key={item.id}
                  onClick={() => setTimeframe(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <StackedProjectionChart
            crossoverWeek={initialData.crossoverWeek}
            points={visiblePoints}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] backdrop-blur-md p-4 text-[var(--text-primary)] shadow-sm">
            <h2 className="text-lg font-bold">Assets</h2>
            <div className="mt-3 divide-y divide-[var(--border-subtle)]">
              {initialData.assets.length === 0 ? (
                <p className="py-6 text-sm text-[var(--text-secondary)]">No assets recorded yet.</p>
              ) : (
                initialData.assets.map((asset) => (
                  <div
                    className="grid grid-cols-[1fr_auto] gap-3 py-3"
                    key={asset.id}
                  >
                    <div>
                      <div className="font-semibold">{asset.name}</div>
                      <div className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                        {asset.category}
                      </div>
                    </div>
                    <div className="font-bold text-[var(--accent-primary-text)]">
                      {formatMoney(asset.valueCents)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--accent-brand)] p-4 text-white shadow-sm">
            <h2 className="text-lg font-bold">Model inputs</h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <InputRow label="Starting balance" value={formatMoney(initialData.startingBalanceCents)} />
              <InputRow label="Weekly contribution" value={formatMoney(initialData.weeklyContributionCents)} />
              <InputRow label="Annual return" value={`${Math.round(initialData.annualReturnRate * 100)}%`} />
              <InputRow label="Horizon" value={`${initialData.horizonYears} years`} />
            </dl>
          </div>
        </section>
      </main>
    </div>
  );
}

function StackedProjectionChart({
  points,
  crossoverWeek,
}: {
  points: NetWorthProjectionPoint[];
  crossoverWeek: number | null;
}) {
  const W = 920;
  const H = 420;
  const PAD = { top: 32, right: 20, bottom: 42, left: 80 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;
  const lastWeek = Math.max(1, points.at(-1)?.week ?? 1);
  const yMin = Math.min(0, ...points.map((point) => point.principalCents));
  const yMaxRaw = Math.max(
    1,
    ...points.map((point) => Math.max(point.totalCents, point.principalCents)),
  );
  const yMax = Math.round(yMaxRaw * 1.1);
  const ySpan = Math.max(1, yMax - yMin);

  const x = (week: number) => PAD.left + (week / lastWeek) * cw;
  const y = (value: number) => PAD.top + ch * (1 - (value - yMin) / ySpan);
  const principalPath = linePath(points, (point) => x(point.week), (point) =>
    y(point.principalCents),
  );
  const totalPath = linePath(points, (point) => x(point.week), (point) =>
    y(point.totalCents),
  );
  const principalArea = areaToBaselinePath(points, x, y, 0, (point) =>
    point.principalCents,
  );
  const interestArea = areaBetweenPath(points, x, y, (point) => point.totalCents, (point) =>
    point.principalCents,
  );
  const yearMarkers = yearlyMarkers(points);
  const visibleCrossover =
    crossoverWeek !== null && crossoverWeek > 0 && crossoverWeek <= lastWeek
      ? closestPoint(points, crossoverWeek)
      : null;
  const labelWeek = Math.min(52, lastWeek);
  const labelPoint = closestPoint(points, labelWeek);

  return (
    <div className="p-3 sm:p-5">
      <svg
        className="h-auto w-full overflow-visible"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        viewBox={`0 0 ${W} ${H}`}
      >
        <title>Net worth stacked projection chart</title>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = yMin + ySpan * ratio;
          const yy = y(value);
          return (
            <g key={ratio}>
              <line
                className="stroke-[var(--chart-grid)]"
                strokeWidth="1"
                x1={PAD.left}
                x2={W - PAD.right}
                y1={yy}
                y2={yy}
              />
              <text
                className="fill-[var(--chart-axis)]"
                fontSize="12"
                fontWeight="700"
                textAnchor="end"
                x={PAD.left - 10}
                y={yy + 4}
              >
                {formatAxisMoney(value)}
              </text>
            </g>
          );
        })}

        <line
          className="stroke-[var(--chart-zero)]"
          strokeDasharray="5 5"
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(0)}
          y2={y(0)}
        />

        <path d={principalArea} fill="rgba(100,116,139,0.24)" />
        <path d={interestArea} fill="rgba(20,184,166,0.32)" />
        <path className="stroke-[var(--chart-principal)]" d={principalPath} fill="none" strokeWidth="2.5" />
        <path d={totalPath} fill="none" stroke="#0f766e" strokeWidth="3" />

        {labelPoint ? (
          <>
            <text
              className="fill-[var(--chart-principal)]"
              fontSize="13"
              fontWeight="800"
              textAnchor="end"
              x={PAD.left - 12}
              y={y(labelPoint.principalCents) + 4}
            >
              Principal
            </text>
            <text
              fill="#0f766e"
              fontSize="13"
              fontWeight="800"
              textAnchor="end"
              x={PAD.left - 12}
              y={y(labelPoint.totalCents) - 6}
            >
              Interest
            </text>
          </>
        ) : null}

        {visibleCrossover ? (
          <g>
            <line
              stroke="#7c3aed"
              strokeDasharray="4 4"
              x1={PAD.left - 6}
              x2={x(visibleCrossover.week)}
              y1={PAD.top + 26}
              y2={y(visibleCrossover.totalCents)}
            />
            <rect
              fill="rgba(124,58,237,0.18)"
              height="34"
              rx="6"
              stroke="rgba(196,181,253,0.6)"
              width="138"
              x={PAD.left}
              y={PAD.top + 8}
            />
            <text
              fill="#ddd6fe"
              fontSize="12"
              fontWeight="900"
              x={PAD.left + 10}
              y={PAD.top + 29}
            >
              Crossover {formatWeekAsYears(visibleCrossover.week)}
            </text>
            <circle
              cx={x(visibleCrossover.week)}
              cy={y(visibleCrossover.totalCents)}
              fill="#7c3aed"
              r="5"
            />
          </g>
        ) : null}

        {yearMarkers.map((point) => (
          <g key={point.week}>
            <circle
              cx={x(point.week)}
              cy={y(point.totalCents)}
              fill="#0f766e"
              r="4"
            >
              <title>{tooltipText(point)}</title>
            </circle>
            <text
              className="fill-[var(--chart-axis)]"
              fontSize="12"
              fontWeight="700"
              textAnchor="middle"
              x={x(point.week)}
              y={H - 16}
            >
              {point.week === 0 ? "0" : `${Math.round(point.week / 52)}y`}
            </text>
          </g>
        ))}

        <text
          fill="#0f766e"
          fontSize="13"
          fontWeight="900"
          textAnchor="end"
          x={W - PAD.right}
          y={Math.max(PAD.top + 16, y(points.at(-1)?.totalCents ?? 0) - 10)}
        >
          {formatMoney(points.at(-1)?.totalCents ?? 0)}
        </text>
      </svg>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm font-bold text-[var(--text-secondary)]">
        <div className="flex flex-wrap gap-4">
          <span className="inline-flex items-center gap-2">
            <span className="h-1 w-8 rounded-full bg-[#475569]" />
            Principal
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-1 w-8 rounded-full bg-[#0f766e]" />
            Interest
          </span>
        </div>
        <span>{formatWeekAsYears(lastWeek)} visible</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "green" | "red" | "amber" | "purple" | "blue";
}) {
  const color =
    tone === "green"
      ? "text-[var(--accent-primary-text)]"
      : tone === "red"
        ? "text-[var(--accent-negative-text)]"
        : tone === "amber"
          ? "text-[var(--accent-warning-text)]"
          : tone === "purple"
            ? "text-[var(--accent-brand-text)]"
            : "text-[var(--accent-brand-text)]";

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] backdrop-blur-md p-4 text-[var(--text-primary)] shadow-sm">
      <div className="text-xs font-black uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        {label}
      </div>
      <div className={`mt-3 text-3xl font-black tracking-tight ${color}`}>
        {value}
      </div>
      <div className="mt-2 text-sm font-medium leading-snug text-[var(--text-secondary)]">{sub}</div>
    </div>
  );
}

function InputRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
      <dt className="text-white/60">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}

function linePath<T>(
  points: T[],
  x: (point: T) => number,
  y: (point: T) => number,
): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point)} ${y(point)}`)
    .join(" ");
}

function areaToBaselinePath(
  points: NetWorthProjectionPoint[],
  x: (week: number) => number,
  y: (value: number) => number,
  baseline: number,
  topValue: (point: NetWorthProjectionPoint) => number,
): string {
  if (points.length === 0) return "";
  const top = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.week)} ${y(topValue(point))}`)
    .join(" ");
  const bottom = [...points]
    .reverse()
    .map((point) => `L ${x(point.week)} ${y(baseline)}`)
    .join(" ");
  return `${top} ${bottom} Z`;
}

function areaBetweenPath(
  points: NetWorthProjectionPoint[],
  x: (week: number) => number,
  y: (value: number) => number,
  topValue: (point: NetWorthProjectionPoint) => number,
  bottomValue: (point: NetWorthProjectionPoint) => number,
): string {
  if (points.length === 0) return "";
  const top = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.week)} ${y(topValue(point))}`)
    .join(" ");
  const bottom = [...points]
    .reverse()
    .map((point) => `L ${x(point.week)} ${y(bottomValue(point))}`)
    .join(" ");
  return `${top} ${bottom} Z`;
}

function yearlyMarkers(points: NetWorthProjectionPoint[]) {
  const maxWeek = points.at(-1)?.week ?? 0;
  const markers = points.filter((point) => point.week % 52 === 0);
  const final = points.at(-1);
  if (final && final.week !== maxWeek - (maxWeek % 52)) {
    markers.push(final);
  }
  return markers;
}

function closestPoint(points: NetWorthProjectionPoint[], week: number) {
  return points.reduce<NetWorthProjectionPoint | null>((closest, point) => {
    if (!closest) return point;
    return Math.abs(point.week - week) < Math.abs(closest.week - week)
      ? point
      : closest;
  }, null);
}

function tooltipText(point: NetWorthProjectionPoint) {
  const interestShare =
    point.totalCents > 0
      ? Math.round((point.interestCents / point.totalCents) * 100)
      : 0;
  return [
    `Year ${Math.round(point.week / 52)}`,
    `Principal: ${formatMoney(point.principalCents)}`,
    `Interest: ${formatMoney(point.interestCents)}`,
    `Total: ${formatMoney(point.totalCents)}`,
    `${interestShare}% from interest`,
  ].join("\n");
}

function formatWeekAsYears(week: number) {
  if (week < 52) return `${week} wks`;
  const years = Math.floor(week / 52);
  const weeks = week % 52;
  return weeks === 0 ? `${years} yrs` : `${years} yrs ${weeks} wks`;
}

function formatAxisMoney(value: number) {
  const dollars = centsToDollars(value);
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${Math.round(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(centsToDollars(value));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
