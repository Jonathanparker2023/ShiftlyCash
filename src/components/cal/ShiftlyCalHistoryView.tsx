import Link from "next/link";

import type {
  CalHistoryWeek,
  ShiftlyCalHistoryData,
} from "@/lib/cal/data";
import type { CalTargets } from "@/lib/cal/types";

export function ShiftlyCalHistoryView({
  data,
}: {
  data: ShiftlyCalHistoryData;
}) {
  return (
    <div className="space-y-4">
      <SummaryPanel data={data} />
      <section className="overflow-hidden rounded-xl border border-white/15 bg-black/15 shadow-[0_24px_70px_rgba(8,15,28,0.22)] backdrop-blur-md">
        <div className="h-2 bg-white/10" />
        <div className="p-3 sm:p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
            Week history
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            Logged weeks
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[860px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-white/15 bg-white/10 text-xs uppercase tracking-[0.12em] text-white/70">
                <tr>
                  <th className="px-4 py-3 font-semibold">Week</th>
                  <th className="px-4 py-3 text-right font-semibold">Avg cal</th>
                  <th className="px-4 py-3 text-right font-semibold">Protein</th>
                  <th className="px-4 py-3 text-right font-semibold">Fiber</th>
                  <th className="px-4 py-3 text-right font-semibold">Days</th>
                  <th className="px-4 py-3 text-right font-semibold">Weight</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.weeks.map((week) => (
                  <HistoryWeekRow
                    key={week.weekStartIso}
                    targets={data.targets}
                    week={week}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryPanel({ data }: { data: ShiftlyCalHistoryData }) {
  return (
    <section className="rounded-xl border border-white/15 bg-black/15 p-4 shadow-[0_24px_70px_rgba(8,15,28,0.22)] backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
            History metrics
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            Averages across logged weeks
          </h2>
        </div>
        <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm font-semibold text-white/80">
          {data.summary.weekCount} logged weeks
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Avg weekly cal"
          value={`${data.summary.avgWeeklyCalories.toLocaleString()} cal`}
        />
        <MetricTile
          label="Avg weekly protein"
          value={`${data.summary.avgWeeklyProteinG.toLocaleString()}g`}
        />
        <MetricTile
          label="Avg weekly fiber"
          value={`${data.summary.avgWeeklyFiberG.toLocaleString()}g`}
        />
        <MetricTile
          label="Avg weekly weight lost"
          value={formatWeightChange(data.summary.avgWeeklyWeightDeltaLbs)}
        />
      </div>
    </section>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border-2 border-white/30 bg-black/25 p-4 shadow-sm backdrop-blur-md">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/85">
        {label}
      </p>
      <p className="mt-3 rounded-md bg-black/25 px-2 py-1 text-2xl font-black leading-none tracking-tight text-white shadow-sm ring-1 ring-white/20 sm:text-3xl">
        {value}
      </p>
    </div>
  );
}

function HistoryWeekRow({
  targets,
  week,
}: {
  targets: CalTargets;
  week: CalHistoryWeek;
}) {
  const calDelta =
    targets.tdeeCalories === null
      ? null
      : week.avgDailyLogged.calories - targets.tdeeCalories;

  return (
    <tr className="border-b border-white/10 last:border-0">
      <td className="px-4 py-3 font-semibold text-white">
        {formatDateRange(week.weekStartIso, week.weekEndIso)}
      </td>
      <td className="px-4 py-3 text-right">
        <span className="font-semibold text-white">
          {week.avgDailyLogged.calories.toLocaleString()} cal
        </span>
        {calDelta !== null ? (
          <span className="ml-2 text-xs font-semibold text-white/60">
            {formatSigned(calDelta)}
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right font-semibold text-white/85">
        {week.avgDailyLogged.proteinG.toLocaleString()}g/day
      </td>
      <td className="px-4 py-3 text-right font-semibold text-white/85">
        {week.avgDailyLogged.fiberG.toLocaleString()}g/day
      </td>
      <td className="px-4 py-3 text-right text-white/80">
        {week.daysLogged}/7
      </td>
      <td className="px-4 py-3 text-right font-semibold text-white/85">
        {week.weightDeltaLbs === null
          ? "--"
          : `${formatSigned(week.weightDeltaLbs)} lbs`}
      </td>
      <td className="px-4 py-3">
        <Link
          className="rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          href={`/cal/history/${week.weekStartIso}`}
        >
          View
        </Link>
      </td>
    </tr>
  );
}

function formatDateRange(startIso: string, endIso: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(new Date(`${startIso}T00:00:00.000Z`))} - ${formatter.format(
    new Date(`${endIso}T00:00:00.000Z`),
  )}`;
}

function formatSigned(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  })}`;
}

function formatWeightChange(value: number | null): string {
  if (value === null) return "--";
  if (value < 0) return `${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  })} lbs lost`;
  if (value > 0) return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  })} lbs gained`;
  return "0 lbs";
}
