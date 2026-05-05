import Link from "next/link";
import { notFound } from "next/navigation";

import { ReopenWeekButton } from "@/components/history/ReopenWeekButton";
import {
  cashflowDailyTone,
  cashflowWeeklyTone,
  type CashflowTone,
} from "@/lib/domain/legacyRules";
import { centsToDollars } from "@/lib/domain/money";
import type { HistoryDetailDay, SnapshotSummary } from "@/lib/history/types";
import { getHistoryDetailData } from "@/lib/history/data";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ week_id: string }>;
}) {
  const { week_id: weekId } = await params;
  const data = await getHistoryDetailData(weekId);

  if (!data) {
    notFound();
  }

  const dateRange = formatDateRange(data.week.startDate, data.week.endDate);
  const statusLabel = data.week.archivedAt ? "archived" : data.week.status;

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-5 text-zinc-950 sm:px-6 lg:px-8">
      <header className="mx-auto mb-5 flex max-w-7xl flex-col gap-4 border-b border-zinc-200 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
            ShiftlyCash
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Week {data.week.displayWeekNumber}
            </h1>
            <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600">
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-600">{dateRange}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            className="h-9 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
            href="/history"
          >
            Back to History
          </Link>
          {data.week.status === "closed" ? (
            <ReopenWeekButton
              dateRange={dateRange}
              displayWeekNumber={data.week.displayWeekNumber}
              weekId={data.week.id}
            />
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5">
        <section className="grid gap-3 rounded-md border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
          <SummaryMetric label="Earnings" value={formatMoney(data.week.earningsCents)} />
          <SummaryMetric label="Spend" value={formatMoney(data.week.spendCents)} />
          <SummaryMetric label="Base" value={formatMoney(data.week.baseCents)} />
          <SummaryMetric
            label="Cashflow"
            tone={cashflowWeeklyTone(data.week.cashflowCents)}
            value={formatMoney(data.week.cashflowCents)}
          />
          <SummaryMetric
            label="Running balance"
            value={formatMoney(data.week.runningBalanceCents)}
          />
        </section>

        <section className="flex flex-col gap-4 lg:flex-row lg:overflow-x-auto lg:pb-2">
          {data.days.map((day) => (
            <ReadOnlyDayCard day={day} key={day.id} />
          ))}
        </section>

        <SnapshotSection snapshots={data.snapshots} />
      </main>
    </div>
  );
}

function ReadOnlyDayCard({ day }: { day: HistoryDetailDay }) {
  return (
    <article className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm lg:min-w-[320px] lg:flex-1">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{day.label}</h2>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
            {day.date}
          </p>
        </div>
        <span
          className={
            day.spendLocked
              ? "rounded bg-zinc-950 px-2 py-1 text-xs font-semibold text-white"
              : "rounded bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-500"
          }
        >
          {day.spendLocked ? "Locked" : "Unlocked"}
        </span>
      </div>

      <div className="space-y-2">
        {day.slots.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
            No earn slots.
          </div>
        ) : (
          day.slots.map((slot) => (
            <div
              className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm"
              key={slot.id}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-zinc-950">
                  {slot.jobType} / {slot.payType}
                </span>
                <span className="text-zinc-600">{formatQuantity(slot.hoursOrUnits)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs text-zinc-500">
                <span>{slot.label || "No label"}</span>
                <span>slot {slot.slotIndex + 1}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-zinc-200 pt-3 text-sm">
        <Metric label="Earn" value={formatMoney(day.earningsCents)} />
        <Metric label="Spend" value={formatMoney(day.spendCents)} />
        <Metric
          label="Cashflow"
          tone={cashflowDailyTone(day.cashflowCents)}
          value={formatMoney(day.cashflowCents)}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Metric label="Base" value={formatMoney(day.baseCents)} />
        <Metric label="Manual spend" value={formatMoney(day.manualSpendCents)} />
      </div>

      {day.transactions.length > 0 ? (
        <div className="mt-4 border-t border-zinc-200 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
            Transactions
          </h3>
          <div className="mt-2 space-y-2">
            {day.transactions.map((transaction) => (
              <div
                className="rounded-md border border-zinc-200 bg-white p-2 text-xs"
                key={transaction.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-zinc-950">
                      {transaction.merchantName}
                    </p>
                    <p className="text-zinc-500">
                      {transaction.date} · {transaction.source} · {transaction.status}
                    </p>
                  </div>
                  <p className="font-semibold text-zinc-950">
                    {formatMoney(transaction.amountCents)}
                  </p>
                </div>
                {transaction.category ? (
                  <p className="mt-1 text-zinc-500">{transaction.category}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function SnapshotSection({ snapshots }: { snapshots: SnapshotSummary[] }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold">Recovery snapshots</h2>
      <p className="mt-1 text-sm text-zinc-600">
        Snapshots are recovery insurance before and after destructive week operations.
      </p>

      {snapshots.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
          No snapshots captured for this week yet.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {snapshots.map((snapshot) => (
            <details
              className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
              key={snapshot.id}
            >
              <summary className="cursor-pointer text-sm font-medium text-zinc-950">
                {snapshot.snapshotType} · {formatTimestamp(snapshot.createdAt)}
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  {snapshot.dayCount} days, {snapshot.earnSlotCount} slots,{" "}
                  {snapshot.transactionCount} transactions
                </span>
              </summary>
              <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-50">
                {snapshot.payloadJson}
              </pre>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: CashflowTone;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
        {label}
      </p>
      <p
        className={
          tone === "positive"
            ? "mt-1 text-lg font-semibold text-green-600"
            : tone === "amber"
              ? "mt-1 text-lg font-semibold text-amber-700"
            : tone === "negative"
              ? "mt-1 text-lg font-semibold text-red-700"
              : "mt-1 text-lg font-semibold text-zinc-950"
        }
      >
        {value}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: CashflowTone;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.12em] text-zinc-500">
        {label}
      </div>
      <div
        className={
          tone === "positive"
            ? "font-semibold text-green-600"
            : tone === "amber"
              ? "font-semibold text-amber-700"
            : tone === "negative"
              ? "font-semibold text-red-700"
              : "font-semibold text-zinc-950"
        }
      >
        {value}
      </div>
    </div>
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(centsToDollars(value));
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
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

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
