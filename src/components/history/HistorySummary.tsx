"use client";

import { cashflowWeeklyColor } from "@/lib/domain/legacyRules";
import { centsToDollars } from "@/lib/domain/money";
import type { HistoryWeek, ProjectionExclusionField } from "@/lib/history/types";

type SummaryStats = {
  closedWeeks: HistoryWeek[];
  totalEarningsCents: number;
  totalSpendCents: number;
  totalCashflowCents: number;
  averageEarningsCents: number | null;
  averageSpendCents: number | null;
  averageCashflowCents: number | null;
  bestWeek: HistoryWeek | null;
  worstWeek: HistoryWeek | null;
};

export function HistorySummary({ weeks }: { weeks: HistoryWeek[] }) {
  const stats = buildSummaryStats(weeks);

  return (
    <section className="mx-auto mb-5 max-w-7xl rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      {weeks.length === 0 ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600">
            No history yet
          </p>
          <p className="mt-2 text-sm text-zinc-700">
            Close your first week from the dashboard to start filling in metrics.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile
            label="Total weeks"
            value={String(stats.closedWeeks.length)}
          />
          <SummaryTile
            label="Total earnings"
            value={formatMoney(stats.totalEarningsCents)}
          />
          <SummaryTile
            label="Total spend"
            value={formatMoney(stats.totalSpendCents)}
          />
          <SummaryTile
            label="Total cashflow"
            toneClass={cashflowWeeklyColor(stats.totalCashflowCents)}
            value={formatMoney(stats.totalCashflowCents)}
          />
          <AverageTile
            cashflowCents={stats.averageCashflowCents}
            earningsCents={stats.averageEarningsCents}
            spendCents={stats.averageSpendCents}
          />
          <WeekExtremeTile kind="Best week" week={stats.bestWeek} />
          <WeekExtremeTile kind="Worst week" week={stats.worstWeek} />
        </div>
      )}
    </section>
  );
}

function buildSummaryStats(weeks: HistoryWeek[]): SummaryStats {
  const closedWeeks = weeks.filter((week) => week.status === "closed");
  const bestWeek = findExtremeWeek(closedWeeks, "best");
  const worstWeek = findExtremeWeek(closedWeeks, "worst");

  return {
    closedWeeks,
    totalEarningsCents: sumIncluded(closedWeeks, "earnings"),
    totalSpendCents: sumIncluded(closedWeeks, "spend"),
    totalCashflowCents: sumIncluded(closedWeeks, "cashflow"),
    averageEarningsCents: averageIncluded(closedWeeks, "earnings"),
    averageSpendCents: averageIncluded(closedWeeks, "spend"),
    averageCashflowCents: averageIncluded(closedWeeks, "cashflow"),
    bestWeek,
    worstWeek,
  };
}

function SummaryTile({
  label,
  value,
  toneClass = "text-zinc-950",
}: {
  label: string;
  value: string;
  toneClass?: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}

function AverageTile({
  earningsCents,
  spendCents,
  cashflowCents,
}: {
  earningsCents: number | null;
  spendCents: number | null;
  cashflowCents: number | null;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 lg:col-span-2">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600">
        Average week
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <AverageLine label="Earn" value={earningsCents} />
        <AverageLine label="Spend" value={spendCents} />
        <AverageLine
          label="Cashflow"
          toneClass={
            cashflowCents === null
              ? "text-zinc-700"
              : cashflowWeeklyColor(cashflowCents)
          }
          value={cashflowCents}
        />
      </div>
    </div>
  );
}

function AverageLine({
  label,
  value,
  toneClass = "text-zinc-950",
}: {
  label: string;
  value: number | null;
  toneClass?: string;
}) {
  const valueClass = value === null ? "text-zinc-700" : toneClass;

  return (
    <div>
      <p className="text-xs text-zinc-600">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${valueClass}`}>
        {value === null ? "-" : formatMoney(value)}
      </p>
    </div>
  );
}

function WeekExtremeTile({
  kind,
  week,
}: {
  kind: "Best week" | "Worst week";
  week: HistoryWeek | null;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600">
        {kind}
      </p>
      {week ? (
        <>
          <p className="mt-2 text-lg font-semibold text-zinc-950">
            Week {week.displayWeekNumber}
          </p>
          <p className="mt-1 text-sm text-zinc-700">
            Ends {formatDate(week.endDate)}
          </p>
          <p
            className={`mt-2 text-xl font-semibold ${cashflowWeeklyColor(
              week.cashflowCents,
            )}`}
          >
            {formatMoney(week.cashflowCents)}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-lg font-semibold text-zinc-700">-</p>
          <p className="mt-1 text-sm text-zinc-600">No closed weeks yet</p>
        </>
      )}
    </div>
  );
}

function sumIncluded(
  weeks: HistoryWeek[],
  field: ProjectionExclusionField,
): number {
  return weeks.reduce((total, week) => {
    if (week.exclusions[field]) {
      return total;
    }

    return total + valueForField(week, field);
  }, 0);
}

function averageIncluded(
  weeks: HistoryWeek[],
  field: ProjectionExclusionField,
): number | null {
  const includedWeeks = weeks.filter((week) => !week.exclusions[field]);
  if (includedWeeks.length === 0) {
    return null;
  }

  return Math.round(sumIncluded(includedWeeks, field) / includedWeeks.length);
}

function valueForField(
  week: HistoryWeek,
  field: ProjectionExclusionField,
): number {
  if (field === "earnings") {
    return week.earningsCents;
  }

  if (field === "spend") {
    return week.spendCents;
  }

  return week.cashflowCents;
}

function findExtremeWeek(
  weeks: HistoryWeek[],
  kind: "best" | "worst",
): HistoryWeek | null {
  return weeks.reduce<HistoryWeek | null>((selected, week) => {
    if (!selected) {
      return week;
    }

    return kind === "best"
      ? week.cashflowCents > selected.cashflowCents
        ? week
        : selected
      : week.cashflowCents < selected.cashflowCents
        ? week
        : selected;
  }, null);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(centsToDollars(value)));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
