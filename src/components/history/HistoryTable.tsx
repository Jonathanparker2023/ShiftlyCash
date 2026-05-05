"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  reopenWeekAction,
  toggleProjectionExclusionAction,
} from "@/app/(protected)/history/actions";
import { cashflowWeeklyColor } from "@/lib/domain/legacyRules";
import { centsToDollars } from "@/lib/domain/money";
import type {
  HistoryData,
  HistoryWeek,
  ProjectionExclusionField,
} from "@/lib/history/types";

type PendingAction =
  | { kind: "exclude"; weekId: string; field: ProjectionExclusionField }
  | { kind: "reopen"; weekId: string }
  | null;

export function HistoryTable({ initialData }: { initialData: HistoryData }) {
  const router = useRouter();
  const [weeks, setWeeks] = useState(initialData.weeks);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleExclusion(
    week: HistoryWeek,
    field: ProjectionExclusionField,
  ) {
    const previousWeeks = weeks;
    setPendingAction({ kind: "exclude", weekId: week.id, field });
    setError(null);
    setWeeks((currentWeeks) =>
      currentWeeks.map((currentWeek) =>
        currentWeek.id === week.id
          ? {
              ...currentWeek,
              exclusions: {
                ...currentWeek.exclusions,
                [field]: !currentWeek.exclusions[field],
              },
            }
          : currentWeek,
      ),
    );

    try {
      await toggleProjectionExclusionAction({ weekId: week.id, field });
      router.refresh();
    } catch (caughtError) {
      setWeeks(previousWeeks);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update projection flag.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function reopenWeek(week: HistoryWeek) {
    const confirmed = window.confirm(
      `Reopen week ${week.displayWeekNumber} (${formatDateRange(
        week.startDate,
        week.endDate,
      )})? This will discard your current active week and any unsaved data on it. Continue?`,
    );

    if (!confirmed) {
      return;
    }

    setPendingAction({ kind: "reopen", weekId: week.id });
    setError(null);

    try {
      await reopenWeekAction({ weekId: week.id });
      router.push("/");
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to reopen week.",
      );
      setPendingAction(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-5 text-zinc-950 sm:px-6 lg:px-8">
      <header className="mx-auto mb-5 max-w-7xl border-b border-zinc-200 pb-4">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
          ShiftlyCash
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">History</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Closed and archived weeks, with projection exclusions. Excluded values
          are ignored by projection averages, not deleted.
        </p>
      </header>

      {error ? (
        <div className="mx-auto mb-4 max-w-7xl rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <main className="mx-auto max-w-7xl">
        {weeks.length === 0 ? (
          <section className="rounded-md border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
            No closed weeks yet. Once you close your first week, it will appear here.
          </section>
        ) : (
          <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white shadow-sm">
            <table className="min-w-[980px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-100 text-xs uppercase tracking-[0.12em] text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Week #</th>
                  <th className="px-4 py-3 font-semibold">Date range</th>
                  <th className="px-4 py-3 text-right font-semibold">Earnings</th>
                  <th className="px-4 py-3 text-right font-semibold">Spend</th>
                  <th className="px-4 py-3 text-right font-semibold">Base</th>
                  <th className="px-4 py-3 text-right font-semibold">Cashflow</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Running balance
                  </th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr
                    className="border-b border-zinc-100 last:border-0"
                    key={week.id}
                  >
                    <td className="px-4 py-3 font-medium">
                      Week {week.displayWeekNumber}
                      {week.archivedAt ? (
                        <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                          Archived
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {formatDateRange(week.startDate, week.endDate)}
                    </td>
                    <ProjectionCell
                      field="earnings"
                      isPending={isPending(pendingAction, week.id, "earnings")}
                      isExcluded={week.exclusions.earnings}
                      value={week.earningsCents}
                      colorClass="text-emerald-600"
                      week={week}
                      onToggle={toggleExclusion}
                    />
                    <ProjectionCell
                      field="spend"
                      isPending={isPending(pendingAction, week.id, "spend")}
                      isExcluded={week.exclusions.spend}
                      value={week.spendCents}
                      colorClass="text-red-600"
                      week={week}
                      onToggle={toggleExclusion}
                    />
                    <td className="px-4 py-3 text-right font-medium text-zinc-400">
                      {formatMoney(week.baseCents)}
                    </td>
                    <ProjectionCell
                      field="cashflow"
                      isPending={isPending(pendingAction, week.id, "cashflow")}
                      isExcluded={week.exclusions.cashflow}
                      value={week.cashflowCents}
                      colorClass={cashflowWeeklyColor(week.cashflowCents)}
                      week={week}
                      onToggle={toggleExclusion}
                    />
                    <td
                      className={`px-4 py-3 text-right font-semibold ${runningColor(
                        week.runningBalanceCents,
                      )}`}
                    >
                      {formatMoney(week.runningBalanceCents)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          className="h-8 rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium transition hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={pendingAction?.kind === "reopen"}
                          onClick={() => reopenWeek(week)}
                          type="button"
                        >
                          {pendingAction?.kind === "reopen" &&
                          pendingAction.weekId === week.id
                            ? "Reopening..."
                            : "Reopen"}
                        </button>
                        <Link
                          className="h-8 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950"
                          href={`/history/${week.id}`}
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectionCell({
  field,
  isExcluded,
  isPending,
  value,
  colorClass,
  week,
  onToggle,
}: {
  field: ProjectionExclusionField;
  isExcluded: boolean;
  isPending: boolean;
  value: number;
  colorClass: string;
  week: HistoryWeek;
  onToggle: (week: HistoryWeek, field: ProjectionExclusionField) => void;
}) {
  return (
    <td className="px-4 py-3 text-right">
      <button
        className={
          isExcluded
            ? "inline-flex items-center justify-end gap-2 font-medium text-zinc-400 line-through transition hover:text-zinc-600"
            : `inline-flex items-center justify-end gap-2 font-semibold ${colorClass} transition hover:opacity-80`
        }
        disabled={isPending}
        onClick={() => onToggle(week, field)}
        title={`Toggle ${field} projection exclusion`}
        type="button"
      >
        {formatMoney(value)}
        {isExcluded ? (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 no-underline">
            EXCL
          </span>
        ) : null}
      </button>
    </td>
  );
}

function runningColor(cents: number): string {
  return cents < 0 ? "text-red-600" : "text-zinc-950";
}

function isPending(
  pendingAction: PendingAction,
  weekId: string,
  field: ProjectionExclusionField,
) {
  return (
    pendingAction?.kind === "exclude" &&
    pendingAction.weekId === weekId &&
    pendingAction.field === field
  );
}

function formatMoney(value: number): string {
  // Legacy display: round to whole dollars, no decimals.
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(centsToDollars(value)));
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${startDate}T00:00:00.000Z`));
  const end = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${endDate}T00:00:00.000Z`));

  return `${start}-${end}`;
}
