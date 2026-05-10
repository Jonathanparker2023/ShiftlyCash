"use client";

import { useMemo, useState } from "react";

import {
  cashflowColorFromTone,
  cashflowDailyTone,
  cashflowWeeklyTone,
  type CashflowTone,
} from "@/lib/domain/legacyRules";
import { centsToDollars } from "@/lib/domain/money";
import type {
  HistoryDetailData,
  HistoryDetailDay,
  HistoryDetailSlot,
  HistoryDetailTransaction,
  SnapshotSummary,
} from "@/lib/history/types";

export function HistoryWeekView({ data }: { data: HistoryDetailData }) {
  const [focusedDayIndex, setFocusedDayIndex] = useState(() =>
    Math.max(0, data.days.findIndex((day) => day.dayIndex === 6)),
  );
  const focusedDay = data.days[focusedDayIndex] ?? data.days[0];

  const metrics = useMemo(
    () => [
      {
        label: "Earnings",
        value: formatMoney(data.week.earningsCents),
        accent: "positive" as const,
      },
      {
        label: "Spend",
        value: formatMoney(data.week.spendCents),
        accent: "negative" as const,
      },
      {
        label: "Base",
        value: formatMoney(data.week.baseCents),
        accent: "blue" as const,
      },
      {
        label: "Cashflow",
        value: formatMoney(data.week.cashflowCents),
        accent: cashflowWeeklyTone(data.week.cashflowCents),
        tone: cashflowWeeklyTone(data.week.cashflowCents),
      },
      {
        label: "Running balance",
        value: formatMoney(data.week.runningBalanceCents),
        accent: "green" as const,
      },
    ],
    [data.week],
  );

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <section className="rounded-md border border-white/20 bg-black/15 p-4 shadow-[0_14px_36px_rgba(8,15,28,0.24)] backdrop-blur-md">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {metrics.map((metric) => (
            <TopMetric
              accent={metric.accent}
              key={metric.label}
              label={metric.label}
              tone={metric.tone}
              value={metric.value}
            />
          ))}
        </div>
      </section>

      <section className="overflow-x-auto rounded-md border border-white/20 bg-black/15 p-4 shadow-[0_14px_36px_rgba(8,15,28,0.24)] backdrop-blur-md">
        <div className="grid min-w-[760px] grid-cols-7 gap-2 sm:gap-3">
          {data.days.map((day, index) => (
            <WeekStripCell
              day={day}
              isFocused={index === focusedDayIndex}
              key={day.id}
              onFocus={() => setFocusedDayIndex(index)}
            />
          ))}
        </div>
      </section>

      {focusedDay ? <FocusedDayPanel day={focusedDay} /> : null}

      <SnapshotSection snapshots={data.snapshots} />
    </main>
  );
}

function TopMetric({
  label,
  value,
  tone,
  accent,
}: {
  label: string;
  value: string;
  tone?: CashflowTone;
  accent?: "green" | "blue" | "positive" | "amber" | "negative";
}) {
  const accentClass =
    accent === "green" || accent === "positive"
      ? "before:bg-green-600"
      : accent === "amber"
        ? "before:bg-amber-500"
        : accent === "negative"
          ? "before:bg-red-600"
          : accent === "blue"
            ? "before:bg-[#7e22ce]"
            : "before:bg-[#cbd5e1]";

  return (
    <div
      className={`relative overflow-hidden rounded-md border-2 border-white/35 bg-black/25 px-3 py-3 text-white shadow-[0_10px_24px_rgba(8,15,28,0.16)] backdrop-blur-md before:absolute before:inset-x-0 before:top-0 before:h-1 ${accentClass}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/85">
        {label}
      </p>
      <p
        className={
          tone
            ? `mt-1 text-lg font-semibold ${cashflowColorFromTone(tone)}`
            : "mt-1 text-lg font-semibold text-white"
        }
      >
        {value}
      </p>
    </div>
  );
}

function WeekStripCell({
  day,
  isFocused,
  onFocus,
}: {
  day: HistoryDetailDay;
  isFocused: boolean;
  onFocus: () => void;
}) {
  return (
    <button
      className={
        isFocused
          ? "min-w-0 rounded-md border-2 border-white/90 bg-black/30 px-2 py-2 text-left shadow-[0_10px_24px_rgba(8,15,28,0.18)] backdrop-blur-lg transition focus:outline-none focus:ring-2 focus:ring-white sm:p-3"
          : day.spendLocked
            ? "min-w-0 rounded-md border-2 border-white/30 bg-black/15 px-2 py-2 text-left opacity-80 shadow-sm backdrop-blur-md transition hover:border-white/40 focus:outline-none focus:ring-2 focus:ring-white sm:p-3"
            : "min-w-0 rounded-md border-2 border-white/40 bg-black/20 px-2 py-2 text-left shadow-sm backdrop-blur-md transition hover:border-white/50 hover:bg-black/25 focus:outline-none focus:ring-2 focus:ring-white sm:p-3"
      }
      onClick={onFocus}
      type="button"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
          {shortDayName(day.date)}
        </span>
        {day.spendLocked ? (
          <span className="hidden rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold text-white sm:inline-flex">
            Locked
          </span>
        ) : null}
      </div>
      <div className="mt-3 text-2xl font-semibold text-white">
        {dayOfMonth(day.date)}
      </div>
      <div
        className={`mt-5 text-base font-bold ${cashflowColorFromTone(
          cashflowDailyTone(day.cashflowCents),
        )}`}
      >
        {formatMoney(day.cashflowCents)}
      </div>
    </button>
  );
}

function FocusedDayPanel({ day }: { day: HistoryDetailDay }) {
  return (
    <section className="rounded-md border border-white/20 bg-black/15 p-4 shadow-[0_14px_36px_rgba(8,15,28,0.24)] backdrop-blur-md">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-white px-3 py-1 text-sm font-bold uppercase text-[#0b1220]">
            {shortDayName(day.date)}
          </span>
          <div>
            <h2 className="text-2xl font-semibold text-white">
              {formatLongDate(day.date)}
            </h2>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
              Read-only history
            </p>
          </div>
        </div>
        {day.spendLocked ? (
          <span className="rounded-full border border-white/20 bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-white">
            Locked
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.55fr_1.45fr]">
        <section className="space-y-2">
          {day.slots.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/20 bg-black/15 p-3 text-sm text-white/60">
              No earn slots.
            </div>
          ) : (
            day.slots.map((slot) => <ShiftRow key={slot.id} slot={slot} />)
          )}
        </section>

        <TotalsPanel day={day} />

        <TransactionPanel transactions={day.transactions} />
      </div>
    </section>
  );
}

function ShiftRow({ slot }: { slot: HistoryDetailSlot }) {
  return (
    <div className={historyShiftBarClass(slot.jobType)}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold">
          {formatJobLabel(slot.jobType)}
        </span>
        {slot.payType === "regular" ||
        slot.payType === "overtime" ||
        slot.payType === "split" ? (
          <span className={payTypeBadgeClass(slot.payType)}>
            {formatPayBadge(slot.payType)}
          </span>
        ) : null}
        <span className="shrink-0 text-xs font-semibold opacity-90">
          {formatQuantity(slot.hoursOrUnits)}h
        </span>
        <span className="min-w-0 flex-1 truncate text-center text-xs font-semibold">
          {slot.label || ""}
        </span>
      </div>
    </div>
  );
}

function TotalsPanel({ day }: { day: HistoryDetailDay }) {
  return (
    <div className="rounded-md border border-white/15 bg-black/15 p-3 text-sm backdrop-blur-md">
      <TotalLine label="Earn" value={formatMoney(day.earningsCents)} />
      <TotalLine
        label="Spend"
        tone="negative"
        value={formatMoney(day.spendCents)}
      />
      <TotalLine label="Base" value={formatMoney(day.baseCents)} />
      <div className="my-2 border-t border-white/20" />
      <TotalLine
        strong
        label="Cashflow"
        tone={cashflowDailyTone(day.cashflowCents)}
        value={formatMoney(day.cashflowCents)}
      />
    </div>
  );
}

function TotalLine({
  label,
  value,
  tone,
  strong = false,
}: {
  label: string;
  value: string;
  tone?: CashflowTone;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className={strong ? "font-semibold text-white" : "text-white/75"}>
        {label}
      </span>
      <span
        className={
          tone
            ? `font-semibold ${cashflowColorFromTone(tone)}`
            : strong
              ? "font-semibold text-white"
              : "font-medium text-white"
        }
      >
        {value}
      </span>
    </div>
  );
}

function TransactionPanel({
  transactions,
}: {
  transactions: HistoryDetailTransaction[];
}) {
  return (
    <section className="rounded-md border border-white/15 bg-black/15 p-3 shadow-sm backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/80">
          Transactions
        </h3>
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold text-white">
          {transactions.length}
        </span>
      </div>

      {transactions.length === 0 ? (
        <p className="rounded-md border border-dashed border-white/15 bg-black/15 p-3 text-sm text-white/60">
          No transactions for this day.
        </p>
      ) : (
        <div className="space-y-2">
          {transactions.map((transaction) => (
            <div
              className="rounded-md border border-white/15 bg-black/15 p-3 text-xs text-white shadow-sm"
              key={transaction.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {transaction.merchantName}
                  </p>
                  <p className="mt-1 text-white/60">
                    {transaction.date}
                    {transaction.time ? ` ${transaction.time}` : ""} /{" "}
                    {transaction.source} / {transaction.status}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold">
                  {formatMoney(transaction.amountCents)}
                </p>
              </div>
              {transaction.category ? (
                <p className="mt-2 text-white/60">{transaction.category}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SnapshotSection({ snapshots }: { snapshots: SnapshotSummary[] }) {
  return (
    <section className="rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_14px_36px_rgba(8,15,28,0.24)] backdrop-blur-md">
      <h2 className="text-base font-semibold text-white">Recovery snapshots</h2>
      <p className="mt-1 text-sm text-white/65">
        Snapshots are recovery insurance before and after destructive week operations.
      </p>

      {snapshots.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-white/15 bg-black/15 p-4 text-sm text-white/60">
          No snapshots captured for this week yet.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {snapshots.map((snapshot) => (
            <details
              className="rounded-md border border-white/15 bg-black/15 p-3 text-white"
              key={snapshot.id}
            >
              <summary className="cursor-pointer text-sm font-medium">
                {snapshot.snapshotType} / {formatTimestamp(snapshot.createdAt)}
                <span className="ml-2 text-xs font-normal text-white/60">
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

function historyShiftBarClass(jobType: string): string {
  const base = "rounded-md border p-3 text-sm shadow-sm";

  if (jobType === "ability" || jobType === "incentive") {
    return `${base} border-[#1e3a8a] bg-[#1d4ed8] text-white`;
  }

  if (jobType === "prestige" || jobType === "prestige_ilst") {
    return `${base} border-[#d97706] bg-[#facc15] text-[#1f2937]`;
  }

  return `${base} border-white/20 bg-white/15 text-white`;
}

function payTypeBadgeClass(payType: string): string {
  if (payType === "split") {
    return "rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-[#0f172a]";
  }

  if (payType === "overtime") {
    return "rounded-full bg-[#22c55e] px-2 py-0.5 text-[10px] font-bold uppercase text-white";
  }

  return "rounded-full bg-[#dbeafe] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#1d4ed8]";
}

function formatPayBadge(payType: string): string {
  if (payType === "overtime") return "OT";
  if (payType === "split") return "Split";
  return "Reg";
}

function formatJobLabel(jobType: string): string {
  if (jobType === "prestige" || jobType === "prestige_ilst") {
    return "Prestige";
  }

  return capitalize(jobType);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(centsToDollars(value)));
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function shortDayName(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function dayOfMonth(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatLongDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
