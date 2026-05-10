"use client";

import { useRouter } from "next/navigation";
import type { DragEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  addManualTransactionAction,
  closeWeekAction,
  refreshDashboardProjectionMaintenanceAction,
  saveEarnSlotAction,
  toggleTransactionStatusAction,
  type SaveEarnSlotInput,
} from "@/app/(protected)/actions";
import { syncTransactionsAction } from "@/app/(protected)/banking/actions";
import { addDaysIso, formatDayLabel } from "@/lib/dashboard/dates";
import { sortDashboardTransactions } from "@/lib/dashboard/transactions";
import type {
  DashboardData,
  DashboardDay,
  DashboardSlot,
  DashboardTransaction,
  SaveState,
} from "@/lib/dashboard/types";
import { centsToDollars, dollarsToCents } from "@/lib/domain/money";
import {
  calculateEarnSlot,
  calculateDayTotals,
  calculateWeekTotals,
  getPayPeriodInfo,
  type JobType,
  type PayType,
  type PaySettings,
} from "@/lib/domain/pay";
import {
  cashflowColorFromTone,
  cashflowDailyColor,
  cashflowDailyTone,
} from "@/lib/domain/legacyRules";
const JOB_OPTIONS: JobType[] = [
  "none",
  "ability",
  "prestige",
  "prestige_ilst",
  "incentive",
  "other",
];
const PAY_OPTIONS: PayType[] = ["none", "regular", "overtime", "unit"];

type DashboardEditorProps = {
  initialData: DashboardData;
};

type TimerMap = Record<string, ReturnType<typeof setTimeout>>;
type VersionMap = Record<string, number>;

export function DashboardEditor({ initialData }: DashboardEditorProps) {
  const router = useRouter();
  const [days, setDays] = useState(initialData.days);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [closeToast, setCloseToast] = useState<string | null>(null);
  const [pendingTransactionIds, setPendingTransactionIds] = useState<Set<string>>(
    new Set(),
  );
  const [pendingManualDayIds, setPendingManualDayIds] = useState<Set<string>>(
    new Set(),
  );
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [focusedDayIndex, setFocusedDayIndex] = useState(() =>
    Math.max(
      0,
      initialData.days.findIndex((day) => day.date === initialData.todayIso),
    ),
  );
  const [expandedSlotIndex, setExpandedSlotIndex] = useState<number | null>(null);
  const timers = useRef<TimerMap>({});
  const versions = useRef<VersionMap>({});
  const lastSavedAt = useRef<number | null>(null);
  const canCloseWeek = initialData.todayIso >= initialData.week.endDate;
  const nextWeekStart = addDaysIso(initialData.week.endDate, 1);
  const nextWeekEnd = addDaysIso(nextWeekStart, 6);
  const nextWeekInfo = getPayPeriodInfo(nextWeekStart);

  useEffect(() => {
    const scheduledTimers = timers.current;

    return () => {
      Object.values(scheduledTimers).forEach(clearTimeout);
    };
  }, []);

  // Projection maintenance is intentionally post-render. It clears projected
  // spend that has reached today and fills future-day projections without
  // blocking dashboard navigation.
  useEffect(() => {
    const storageKey = `shiftly:projectionMaintenance:${initialData.todayIso}`;

    if (sessionStorage.getItem(storageKey)) {
      return;
    }

    sessionStorage.setItem(storageKey, String(Date.now()));

    let cancelled = false;
    (async () => {
      try {
        const result = await refreshDashboardProjectionMaintenanceAction();

        if (!cancelled && (result.cleaned > 0 || result.projected > 0)) {
          router.refresh();
        }
      } catch {
        // Projection maintenance is best-effort; dashboard reads stay usable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialData.todayIso, router]);

  // Auto-sync Plaid transactions on first dashboard load (fire-and-forget).
  // Throttled by sessionStorage so it only runs once per browser session per
  // 5-minute window, avoiding API spam during navigation.
  useEffect(() => {
    const STORAGE_KEY = "shiftly:lastAutoSyncAt";
    const THROTTLE_MS = 5 * 60 * 1000;
    const last = Number(sessionStorage.getItem(STORAGE_KEY) ?? "0");
    if (Date.now() - last < THROTTLE_MS) return;
    sessionStorage.setItem(STORAGE_KEY, String(Date.now()));

    let cancelled = false;
    (async () => {
      try {
        const result = await syncTransactionsAction();
        if (
          !cancelled &&
          (result.added > 0 || result.modified > 0 || result.normalized > 0)
        ) {
          router.refresh();
        }
      } catch {
        // Silent — no Plaid item linked, expired, or transient error.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const dayTotals = useMemo(
    () =>
      new Map(
        days.map((day) => [
          day.id,
          calculateDayTotals(toDayInput(day), initialData.settings),
        ]),
      ),
    [days, initialData.settings],
  );
  const weekTotals = useMemo(
    () => calculateWeekTotals({ days: days.map(toDayInput) }, initialData.settings),
    [days, initialData.settings],
  );
  const focusedDay = days[focusedDayIndex] ?? days[0];
  const focusedDayTotals = focusedDay ? dayTotals.get(focusedDay.id) : undefined;

  function updateSlot(
    dayId: string,
    slotIndex: number,
    patch: Partial<DashboardSlot>,
  ) {
    const currentSlot = days
      .find((day) => day.id === dayId)
      ?.slots.find((slot) => slot.slotIndex === slotIndex);

    if (!currentSlot) {
      return;
    }

    const nextSlot = normalizeSlotForClient({ ...currentSlot, ...patch });

    setDays((currentDays) =>
      currentDays.map((day) => {
        if (day.id !== dayId) {
          return day;
        }

        return {
          ...day,
          slots: day.slots.map((slot) => {
            if (slot.slotIndex !== slotIndex) {
              return slot;
            }

            return nextSlot;
          }),
        };
      }),
    );

    scheduleSlotSave(nextSlot);
  }

  function reorderSlots(
    dayId: string,
    fromSlotIndex: number,
    toSlotIndex: number,
  ) {
    const day = days.find((currentDay) => currentDay.id === dayId);

    if (!day || day.spendLocked || fromSlotIndex === toSlotIndex) {
      return;
    }

    const activeSlots = day.slots
      .filter((slot) => slot.jobType !== "none")
      .sort((a, b) => a.slotIndex - b.slotIndex);
    const fromPosition = activeSlots.findIndex(
      (slot) => slot.slotIndex === fromSlotIndex,
    );
    const toPosition = activeSlots.findIndex(
      (slot) => slot.slotIndex === toSlotIndex,
    );

    if (fromPosition < 0 || toPosition < 0 || fromPosition === toPosition) {
      return;
    }

    const reorderedActiveSlots = [...activeSlots];
    const [movedSlot] = reorderedActiveSlots.splice(fromPosition, 1);
    reorderedActiveSlots.splice(toPosition, 0, movedSlot);

    const nextSlots = Array.from({ length: 4 }, (_, slotIndex) => {
      const activeSlot = reorderedActiveSlots[slotIndex];

      if (activeSlot) {
        return normalizeSlotForClient({
          ...activeSlot,
          slotIndex,
          source: "user",
        });
      }

      return makeEmptySlot(dayId, slotIndex);
    });

    setExpandedSlotIndex(null);
    setDays((currentDays) =>
      currentDays.map((currentDay) =>
        currentDay.id === dayId
          ? {
              ...currentDay,
              slots: nextSlots,
            }
          : currentDay,
      ),
    );
    nextSlots.forEach(scheduleSlotSave);
  }

  async function toggleTransactionStatus(
    transaction: DashboardTransaction,
    newStatus: "applied" | "excluded",
  ) {
    if (pendingTransactionIds.has(transaction.id)) {
      return;
    }

    const previousDays = days;
    setTransactionError(null);
    setSaveState("saving");
    setPendingTransactionIds((current) => new Set(current).add(transaction.id));
    setDays((currentDays) =>
      currentDays.map((day) =>
        day.id === transaction.dayId
          ? moveTransactionBetweenBuckets(day, transaction, newStatus)
          : day,
      ),
    );

    try {
      await toggleTransactionStatusAction({
        transactionId: transaction.id,
        newStatus,
      });
      lastSavedAt.current = Date.now();
      setSaveState("saved");
      window.setTimeout(() => {
        if (lastSavedAt.current && Date.now() - lastSavedAt.current >= 1150) {
          setSaveState("idle");
        }
      }, 1200);
    } catch (error) {
      setDays(previousDays);
      setSaveState("error");
      setTransactionError(
        error instanceof Error ? error.message : "Unable to update transaction.",
      );
    } finally {
      setPendingTransactionIds((current) => {
        const next = new Set(current);
        next.delete(transaction.id);
        return next;
      });
    }
  }

  async function addManualTransaction(
    day: DashboardDay,
    merchantName: string,
    amountCents: number,
  ) {
    if (pendingManualDayIds.has(day.id)) {
      return;
    }

    const previousDays = days;
    const tempTransaction: DashboardTransaction = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      dayId: day.id,
      merchantName,
      amountCents,
      category: null,
      source: "manual",
      status: "applied",
      date: day.date,
      time: null,
      createdAt: new Date().toISOString(),
    };

    setTransactionError(null);
    setSaveState("saving");
    setPendingManualDayIds((current) => new Set(current).add(day.id));
    setDays((currentDays) =>
      currentDays.map((currentDay) =>
        currentDay.id === day.id
          ? addAppliedTransactionToDay(currentDay, tempTransaction)
          : currentDay,
      ),
    );

    try {
      const result = await addManualTransactionAction({
        dayId: day.id,
        merchantName,
        amountCents,
      });
      setDays((currentDays) =>
        currentDays.map((currentDay) =>
          currentDay.id === day.id
            ? replaceTransaction(currentDay, tempTransaction.id, result.transaction)
            : currentDay,
        ),
      );
      lastSavedAt.current = Date.now();
      setSaveState("saved");
      window.setTimeout(() => {
        if (lastSavedAt.current && Date.now() - lastSavedAt.current >= 1150) {
          setSaveState("idle");
        }
      }, 1200);
    } catch (error) {
      setDays(previousDays);
      setSaveState("error");
      setTransactionError(
        error instanceof Error ? error.message : "Unable to add transaction.",
      );
    } finally {
      setPendingManualDayIds((current) => {
        const next = new Set(current);
        next.delete(day.id);
        return next;
      });
    }
  }

  function clearSlot(slot: DashboardSlot) {
    updateSlot(slot.dayId, slot.slotIndex, {
      jobType: "none",
      payType: "none",
      hoursOrUnits: 0,
      label: "",
    });
  }

  function removeSlot(slot: DashboardSlot) {
    const confirmed = window.confirm("Remove this shift?");

    if (!confirmed) {
      return;
    }

    clearSlot(slot);
    setExpandedSlotIndex(null);
  }

  function addShift(day: DashboardDay) {
    if (day.spendLocked) {
      return;
    }

    const emptySlot = day.slots.find((slot) => slot.jobType === "none");

    if (!emptySlot) {
      return;
    }

    setExpandedSlotIndex(emptySlot.slotIndex);
    updateSlot(day.id, emptySlot.slotIndex, {
      jobType: "ability",
      payType: "regular",
      hoursOrUnits: 0,
      label: "",
    });
  }

  function focusDay(dayIndex: number) {
    setFocusedDayIndex(dayIndex);
    setExpandedSlotIndex(null);
    setTransactionError(null);
  }

  function scheduleSlotSave(slot: DashboardSlot) {
    const key = `slot:${slot.dayId}:${slot.slotIndex}`;
    const version = bumpVersion(key);
    const input: SaveEarnSlotInput = {
      dayId: slot.dayId,
      slotIndex: slot.slotIndex,
      jobType: slot.jobType,
      payType: slot.payType ?? "none",
      hoursOrUnits: slot.hoursOrUnits,
      label: slot.label,
    };

    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(async () => {
      setSaveState("saving");
      setSaveError(null);

      try {
        await saveEarnSlotAction(input);
        // Skip reconcile: local optimistic state is the source of truth while
        // typing. Reconciling here can clobber characters typed between the
        // debounce firing and the network round-trip completing.
        markSaved(key, version);
      } catch (error) {
        markError(error);
      }
    }, 1200);
  }

  function bumpVersion(key: string) {
    const version = (versions.current[key] ?? 0) + 1;
    versions.current[key] = version;
    return version;
  }

  function markSaved(key: string, version: number) {
    if (versions.current[key] !== version) {
      return;
    }

    lastSavedAt.current = Date.now();
    setSaveState("saved");
    window.setTimeout(() => {
      if (lastSavedAt.current && Date.now() - lastSavedAt.current >= 1150) {
        setSaveState("idle");
      }
    }, 1200);
  }

  function markError(error: unknown) {
    setSaveState("error");
    setSaveError(error instanceof Error ? error.message : "Save failed.");
  }

  async function closeWeek() {
    if (!canCloseWeek || isClosing) {
      return;
    }

    const confirmed = window.confirm(
      `Close week ${initialData.week.displayWeekNumber} (${formatRangeForPrompt(
        initialData.week.startDate,
        initialData.week.endDate,
      )}) and start week ${nextWeekInfo.displayWeekNumber} (${formatRangeForPrompt(
        nextWeekStart,
        nextWeekEnd,
      )})? This is final until reopened from History.`,
    );

    if (!confirmed) {
      return;
    }

    setIsClosing(true);
    setCloseError(null);
    setCloseToast(null);

    try {
      await closeWeekAction({ weekId: initialData.week.id });
      setCloseToast("Week closed.");
      router.refresh();
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : "Unable to close week.");
    } finally {
      setIsClosing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0b1220]/10 px-3 py-4 text-[#f8fafc] sm:px-4 lg:px-6">
      {closeError ? (
        <div className="mx-auto mb-5 max-w-7xl rounded-md border border-[#fecaca] bg-[#fff1f2] p-3 text-sm font-medium text-[#b91c1c]">
          {closeError}
        </div>
      ) : null}

      {closeToast ? (
        <div className="mx-auto mb-5 max-w-7xl rounded-md border border-[#bae6fd] bg-[#e0f2fe] p-3 text-sm font-medium text-[#0e7490]">
          {closeToast}
        </div>
      ) : null}

      <main className="mx-auto max-w-7xl">
        <section className="overflow-hidden rounded-xl border border-white/15 bg-black/5 shadow-[0_24px_70px_rgba(8,15,28,0.22)] backdrop-blur-[1px]">
          <div className="h-2 bg-white/10" />
          <div className="p-3 sm:p-4">
          <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(420px,0.9fr)] lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                Week {initialData.week.displayWeekNumber}
              </p>
              <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-white drop-shadow-sm sm:text-3xl">
                {formatFullRange(initialData.week.startDate, initialData.week.endDate)}
                <CalendarIcon />
              </h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <p className="inline-flex rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-sm">
                  {initialData.week.payPeriodRole === "week_1"
                    ? "Week 1 of Pay Period"
                    : "Week 2 of Pay Period"}
                  {" - "}
                  Paycheck {initialData.week.paycheckDueDate ?? "after week 2"}
                </p>
                {saveState === "error" ? (
                  <SaveIndicator state={saveState} error={saveError} />
                ) : null}
              </div>
            </div>

            <div>
              <div className="mb-3 flex justify-start lg:justify-end">
                <span className="inline-flex rounded-full border border-white/25 bg-white/15 px-2 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-sm">
                  Active week
                </span>
              </div>
              <MetricStrip
                cashflowCents={weekTotals.cashflowCents}
                earningsCents={weekTotals.earningsCents}
                medians={initialData.metricMedians}
                spendCents={weekTotals.spendCents}
              />
            </div>
          </div>

          <div className="pb-2">
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {days.map((day, dayIndex) => (
                <WeekStripCell
                  day={day}
                  dayIndex={dayIndex}
                  isFocused={dayIndex === focusedDayIndex}
                  isToday={day.date === initialData.todayIso}
                  key={day.id}
                  projectedDailySpendCents={
                    initialData.spendProjection.projectedDailySpendCents
                  }
                  todayIso={initialData.todayIso}
                  totals={dayTotals.get(day.id)}
                  onFocus={focusDay}
                />
              ))}
            </div>
          </div>

          {focusedDay ? (
            <FocusedDayEditor
              day={focusedDay}
              expandedSlotIndex={expandedSlotIndex}
              isManualTransactionPending={pendingManualDayIds.has(focusedDay.id)}
              pendingTransactionIds={pendingTransactionIds}
              settings={initialData.settings}
              transactionError={transactionError}
              totals={focusedDayTotals}
              onAddShift={addShift}
              onAddManualTransaction={addManualTransaction}
              onRemoveSlot={removeSlot}
              onReorderSlots={reorderSlots}
              onSlotChange={updateSlot}
              onToggleTransactionStatus={toggleTransactionStatus}
              onToggleSlot={(slotIndex) =>
                setExpandedSlotIndex((current) =>
                  current === slotIndex ? null : slotIndex,
                )
              }
            />
          ) : null}

          <div className="mt-4 flex flex-col gap-3 border-t border-white/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-white">
              <span>Total: {weekTotals.wageHours.toFixed(2)}h</span>
              <span>Ability: {formatHoursFromSlots(days, "ability")}h</span>
              <span>
                Prestige:{" "}
                {formatHoursFromSlots(days, ["prestige", "prestige_ilst"])}h
              </span>
            </div>
            <button
              className="h-10 w-full rounded-md bg-[#0b1220] px-5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(16,16,15,0.18)] transition hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:bg-[#d7dee8] disabled:text-[#64748b] disabled:shadow-none sm:w-auto"
              disabled={!canCloseWeek || isClosing}
              onClick={closeWeek}
              title={canCloseWeek ? "Close this week" : "Available after Saturday"}
              type="button"
            >
              {isClosing ? "Closing..." : "Close week"}
            </button>
          </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function MetricStrip({
  earningsCents,
  spendCents,
  cashflowCents,
  medians,
}: {
  earningsCents: number;
  spendCents: number;
  cashflowCents: number;
  medians: DashboardData["metricMedians"];
}) {
  const displayCashflowCents = roundCashflowToNearestFiveDollars(cashflowCents);
  const cashflowTone = cashflowDailyTone(displayCashflowCents);

  return (
    <div className="grid grid-cols-3 gap-2">
      <TopMetric
        accent="green"
        label="Earn"
        trend={buildMedianTrend(earningsCents, medians.earningsCents, "higher")}
        value={formatMoney(earningsCents)}
      />
      <TopMetric
        accent="negative"
        label="Spend"
        tone="negative"
        trend={buildMedianTrend(spendCents, medians.spendCents, "lower")}
        value={formatMoney(spendCents)}
      />
      <TopMetric
        accent={cashflowTone}
        label="Cashflow"
        tone={cashflowTone}
        trend={buildMedianTrend(
          displayCashflowCents,
          medians.cashflowCents,
          "higher",
        )}
        value={formatMoney(displayCashflowCents)}
      />
    </div>
  );
}

type MedianTrend = {
  direction: "up" | "down" | "flat";
  percent: number;
  tone: "positive" | "amber" | "negative";
};

function TopMetric({
  label,
  value,
  tone,
  accent,
  trend,
  className = "",
  dark = false,
}: {
  label: string;
  value: string;
  tone?: "positive" | "amber" | "negative";
  accent?: "green" | "blue" | "positive" | "amber" | "negative";
  trend?: MedianTrend | null;
  className?: string;
  dark?: boolean;
}) {
  const accentClass =
    accent === "green"
      ? "before:bg-green-600"
      : accent === "positive"
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
      className={
        dark
          ? `rounded-md bg-[#0b1220] px-2.5 py-3 text-white shadow-[0_10px_24px_rgba(16,16,15,0.22)] sm:px-4 ${className}`
          : `relative overflow-hidden rounded-md border-2 border-white/35 bg-black/25 px-2.5 py-3 text-white shadow-[0_10px_24px_rgba(8,15,28,0.16)] backdrop-blur-md before:absolute before:inset-x-0 before:top-0 before:h-1 sm:px-4 ${accentClass} ${className}`
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={
            dark
              ? "text-[9px] font-semibold uppercase tracking-[0.12em] text-[#cbd5e1] sm:text-[10px] sm:tracking-[0.14em]"
              : "text-[9px] font-semibold uppercase tracking-[0.12em] text-white/85 sm:text-[10px] sm:tracking-[0.14em]"
          }
        >
          {label}
        </div>
        {trend ? (
          <div
            className={`shrink-0 text-right text-[10px] font-bold uppercase tracking-[0.08em] ${cashflowColorFromTone(
              trend.tone,
            )}`}
          >
            {trend.direction === "up"
              ? "↑"
              : trend.direction === "down"
                ? "↓"
                : "→"}{" "}
            {trend.percent}%
          </div>
        ) : null}
      </div>
      <div
        className={
          dark
            ? "mt-1 text-base font-semibold text-white sm:text-lg"
            : tone
              ? `mt-1 text-base font-semibold sm:text-lg ${cashflowColorFromTone(tone)}`
              : "mt-1 text-base font-semibold text-white sm:text-lg"
        }
      >
        {value}
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-white"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect height="18" rx="3" width="18" x="3" y="4" />
      <path d="M3 10h18" />
    </svg>
  );
}

function WeekStripCell({
  day,
  dayIndex,
  isFocused,
  isToday,
  projectedDailySpendCents,
  todayIso,
  totals,
  onFocus,
}: {
  day: DashboardDay;
  dayIndex: number;
  isFocused: boolean;
  isToday: boolean;
  projectedDailySpendCents: number;
  todayIso: string;
  totals: ReturnType<typeof calculateDayTotals> | undefined;
  onFocus: (dayIndex: number) => void;
}) {
  const earningsCents = totals?.earningsCents ?? 0;
  const spendCents = totals?.spendCents ?? 0;
  const baseCents = totals?.baseCents ?? day.baseCents ?? 0;
  const cashflowCents = totals?.cashflowCents ?? 0;

  const isFutureUnspent =
    day.date >= todayIso
    && spendCents === 0
    && !day.spendLocked
    && projectedDailySpendCents > 0;

  const projectedCashflowCents = isFutureUnspent
    ? earningsCents - projectedDailySpendCents - baseCents
    : null;

  const displayCashflowCents = roundCashflowToNearestFiveDollars(
    projectedCashflowCents ?? cashflowCents,
  );

  return (
    <button
        className={
          isFocused
          ? "min-w-0 rounded-md border-2 border-white/90 bg-black/30 px-1.5 py-2 text-left shadow-[0_10px_24px_rgba(8,15,28,0.18)] backdrop-blur-lg transition focus:outline-none focus:ring-2 focus:ring-white sm:p-3"
          : day.spendLocked
            ? "min-w-0 rounded-md border-2 border-white/30 bg-black/15 px-1.5 py-2 text-left opacity-75 shadow-sm backdrop-blur-md transition hover:border-white/40 focus:outline-none focus:ring-2 focus:ring-white sm:p-3"
            : "min-w-0 rounded-md border-2 border-white/40 bg-black/20 px-1.5 py-2 text-left shadow-sm backdrop-blur-md transition hover:border-white/50 hover:bg-black/25 focus:outline-none focus:ring-2 focus:ring-white sm:p-3"
      }
      onClick={() => onFocus(dayIndex)}
      type="button"
    >
      <div className="flex min-w-0 items-center justify-between gap-1 sm:gap-2">
        <span className="truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-white sm:text-[10px] sm:tracking-[0.14em]">
          {shortDayName(day.date)}
        </span>
        {day.spendLocked ? (
          <span className="hidden rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold text-white sm:inline-flex">
            Locked
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex min-w-0 items-center justify-between gap-1 sm:gap-2">
        <span className="text-base font-semibold text-white sm:text-lg">
          {formatDayOnly(day.date)}
        </span>
        {isToday ? (
          <span className="hidden rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white sm:inline-flex">
            Today
          </span>
        ) : null}
      </div>
      <p
        className={`mt-3 truncate text-xs font-semibold sm:mt-6 sm:text-sm ${cashflowDailyColor(
          displayCashflowCents,
        )} ${isFutureUnspent ? "italic opacity-70" : ""}`}
        title={
          isFutureUnspent
            ? `Projected: assumes $${(projectedDailySpendCents / 100).toFixed(0)} spend (last week ÷ 7)`
            : undefined
        }
      >
        {formatMoney(displayCashflowCents)}
        {isFutureUnspent ? " est." : ""}
      </p>
    </button>
  );
}

function FocusedDayEditor({
  day,
  totals,
  expandedSlotIndex,
  isManualTransactionPending,
  pendingTransactionIds,
  settings,
  transactionError,
  onSlotChange,
  onToggleSlot,
  onToggleTransactionStatus,
  onAddManualTransaction,
  onAddShift,
  onRemoveSlot,
  onReorderSlots,
}: {
  day: DashboardDay;
  totals: ReturnType<typeof calculateDayTotals> | undefined;
  expandedSlotIndex: number | null;
  isManualTransactionPending: boolean;
  pendingTransactionIds: Set<string>;
  settings: PaySettings;
  transactionError: string | null;
  onSlotChange: (
    dayId: string,
    slotIndex: number,
    patch: Partial<DashboardSlot>,
  ) => void;
  onToggleSlot: (slotIndex: number) => void;
  onToggleTransactionStatus: (
    transaction: DashboardTransaction,
    newStatus: "applied" | "excluded",
  ) => void;
  onAddManualTransaction: (
    day: DashboardDay,
    merchantName: string,
    amountCents: number,
  ) => void;
  onAddShift: (day: DashboardDay) => void;
  onRemoveSlot: (slot: DashboardSlot) => void;
  onReorderSlots: (
    dayId: string,
    fromSlotIndex: number,
    toSlotIndex: number,
  ) => void;
}) {
  return (
    <section className="mt-4 rounded-lg border border-white/15 bg-black/15 p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-md">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.08fr)_minmax(210px,0.52fr)_minmax(520px,1.55fr)]">
        <ShiftList
          day={day}
          expandedSlotIndex={expandedSlotIndex}
          settings={settings}
          onAddShift={onAddShift}
          onRemoveSlot={onRemoveSlot}
          onReorderSlots={onReorderSlots}
          onSlotChange={onSlotChange}
          onToggleSlot={onToggleSlot}
        />
        <TotalsPanel day={day} totals={totals} />
        <TransactionDrawer
          day={day}
          error={transactionError}
          isManualTransactionPending={isManualTransactionPending}
          pendingTransactionIds={pendingTransactionIds}
          onAddManualTransaction={onAddManualTransaction}
          onToggleTransactionStatus={onToggleTransactionStatus}
        />
      </div>
    </section>
  );
}

function TransactionDrawer({
  day,
  error,
  isManualTransactionPending,
  pendingTransactionIds,
  onToggleTransactionStatus,
  onAddManualTransaction,
}: {
  day: DashboardDay;
  error: string | null;
  isManualTransactionPending: boolean;
  pendingTransactionIds: Set<string>;
  onToggleTransactionStatus: (
    transaction: DashboardTransaction,
    newStatus: "applied" | "excluded",
  ) => void;
  onAddManualTransaction: (
    day: DashboardDay,
    merchantName: string,
    amountCents: number,
  ) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [merchantName, setMerchantName] = useState("");
  const [amount, setAmount] = useState("");
  const appliedTransactions = sortDashboardTransactions(day.appliedTransactions);
  const excludedTransactions = sortDashboardTransactions(day.excludedTransactions);

  function submitManualTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = dollarsToCents(parsePositiveNumber(amount));

    if (!merchantName.trim() || amountCents <= 0) {
      return;
    }

    onAddManualTransaction(day, merchantName.trim(), amountCents);
    setMerchantName("");
    setAmount("");
    setIsAdding(false);
  }

  return (
    <div className="rounded-md border border-white/15 bg-black/15 p-3 text-white shadow-sm backdrop-blur-md">
      {error ? (
        <div className="mb-3 rounded-md border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-xs font-medium text-[#b91c1c]">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <TransactionColumn
          heading="SPENDING"
          pendingTransactionIds={pendingTransactionIds}
          transactions={appliedTransactions}
          variant="spending"
          onToggle={(transaction) =>
            onToggleTransactionStatus(transaction, "excluded")
          }
        />
        <TransactionColumn
          heading="EXEMPT"
          pendingTransactionIds={pendingTransactionIds}
          transactions={excludedTransactions}
          variant="exempt"
          onToggle={(transaction) =>
            onToggleTransactionStatus(transaction, "applied")
          }
        />
      </div>

      <div className="mt-3 border-t border-dashed border-white/20 pt-3">
        {isAdding ? (
          <form
            className="grid gap-2 sm:grid-cols-[1fr_140px_auto_auto]"
            onSubmit={submitManualTransaction}
          >
            <input
              className="h-10 rounded-md border border-white/20 bg-black/10 px-3 text-sm text-white outline-none transition placeholder:text-white/50 focus:border-white/60 focus:ring-2 focus:ring-white"
              onChange={(event) => setMerchantName(event.target.value)}
              placeholder="Merchant"
              type="text"
              value={merchantName}
            />
            <input
              className="h-10 rounded-md border border-white/20 bg-black/10 px-3 text-sm text-white outline-none transition placeholder:text-white/50 focus:border-white/60 focus:ring-2 focus:ring-white"
              min="0"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Amount"
              step="0.01"
              type="number"
              value={amount}
            />
            <button
              className="h-10 rounded-md bg-[#0b1220] px-3 text-sm font-semibold text-white transition hover:bg-[#1e293b]"
              disabled={isManualTransactionPending}
              type="submit"
            >
              {isManualTransactionPending ? "Saving..." : "Save"}
            </button>
            <button
              className="h-10 rounded-md border border-white/20 bg-white/10 px-3 text-sm font-semibold text-white transition hover:border-white/50 hover:bg-white/15"
              onClick={() => {
                setIsAdding(false);
                setMerchantName("");
                setAmount("");
              }}
              type="button"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            className="h-9 rounded-md border border-dashed border-white/25 bg-black/5 px-3 text-sm font-semibold text-white transition hover:border-white/50 hover:bg-black/10"
            onClick={() => setIsAdding(true)}
            type="button"
          >
            + Add transaction
          </button>
        )}
      </div>
    </div>
  );
}

function TransactionColumn({
  heading,
  pendingTransactionIds,
  transactions,
  variant,
  onToggle,
}: {
  heading: string;
  pendingTransactionIds: Set<string>;
  transactions: DashboardTransaction[];
  variant: "spending" | "exempt";
  onToggle: (transaction: DashboardTransaction) => void;
}) {
  return (
    <div className="min-h-0 rounded-md border border-white/15 bg-black/15 p-3 backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/85">
          {heading}
        </h3>
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold text-white">
          {transactions.length}
        </span>
      </div>

      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {transactions.map((transaction) => (
          <TransactionRowButton
            key={transaction.id}
            transaction={transaction}
            disabled={pendingTransactionIds.has(transaction.id)}
            variant={variant}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function TransactionRowButton({
  transaction,
  disabled,
  variant,
  onToggle,
}: {
  transaction: DashboardTransaction;
  disabled: boolean;
  variant: "spending" | "exempt";
  onToggle: (transaction: DashboardTransaction) => void;
}) {
  return (
    <button
      className="grid w-full grid-cols-[1fr_auto] gap-3 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-left text-sm shadow-sm transition hover:border-white/40 hover:bg-black/15 focus:outline-none focus:ring-2 focus:ring-white"
      disabled={disabled}
      onClick={() => onToggle(transaction)}
      type="button"
    >
      <span className="min-w-0">
        <span
          className={
            variant === "exempt"
              ? "block truncate font-semibold text-[#64748b] line-through"
              : "block truncate font-semibold text-white"
          }
        >
          {transaction.merchantName}
        </span>
      </span>
      <span
        className={
          variant === "exempt"
            ? "font-semibold text-[#94a3b8] line-through"
            : "font-semibold text-[#b91c1c]"
        }
      >
        {formatMoney(transaction.amountCents)}
      </span>
    </button>
  );
}

function ShiftList({
  day,
  expandedSlotIndex,
  settings,
  onSlotChange,
  onToggleSlot,
  onAddShift,
  onRemoveSlot,
  onReorderSlots,
}: {
  day: DashboardDay;
  expandedSlotIndex: number | null;
  settings: PaySettings;
  onSlotChange: (
    dayId: string,
    slotIndex: number,
    patch: Partial<DashboardSlot>,
  ) => void;
  onToggleSlot: (slotIndex: number) => void;
  onAddShift: (day: DashboardDay) => void;
  onRemoveSlot: (slot: DashboardSlot) => void;
  onReorderSlots: (
    dayId: string,
    fromSlotIndex: number,
    toSlotIndex: number,
  ) => void;
}) {
  const [draggedSlotIndex, setDraggedSlotIndex] = useState<number | null>(null);
  const activeSlots = day.slots.filter((slot) => slot.jobType !== "none");

  function handleDrop(targetSlotIndex: number) {
    if (draggedSlotIndex === null || draggedSlotIndex === targetSlotIndex) {
      setDraggedSlotIndex(null);
      return;
    }

    onReorderSlots(day.id, draggedSlotIndex, targetSlotIndex);
    setDraggedSlotIndex(null);
  }

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {activeSlots.length > 0 ? (
          activeSlots.map((slot) => (
            <ShiftRow
              expanded={expandedSlotIndex === slot.slotIndex}
              isDragging={draggedSlotIndex === slot.slotIndex}
              key={`${slot.dayId}-${slot.slotIndex}`}
              locked={day.spendLocked}
              settings={settings}
              slot={slot}
              onDragEnd={() => setDraggedSlotIndex(null)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={() => setDraggedSlotIndex(slot.slotIndex)}
              onDrop={() => handleDrop(slot.slotIndex)}
              onRemove={onRemoveSlot}
              onSlotChange={onSlotChange}
              onToggle={() => onToggleSlot(slot.slotIndex)}
            />
          ))
        ) : (
          <div className="rounded-md border border-dashed border-white/25 bg-black/5 p-4 text-sm text-white/70">
            No shifts logged for this day.
          </div>
        )}
      </div>
      <button
        className="h-10 w-full rounded-md border border-dashed border-white/25 bg-black/5 px-3 text-sm font-semibold text-white transition hover:border-white/50 hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={day.spendLocked || activeSlots.length >= 4}
        onClick={() => onAddShift(day)}
        type="button"
      >
        + Add shift
      </button>
    </div>
  );
}

function ShiftRow({
  slot,
  expanded,
  locked,
  isDragging,
  settings,
  onToggle,
  onSlotChange,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  slot: DashboardSlot;
  expanded: boolean;
  locked: boolean;
  isDragging: boolean;
  settings: PaySettings;
  onToggle: () => void;
  onSlotChange: (
    dayId: string,
    slotIndex: number,
    patch: Partial<DashboardSlot>,
  ) => void;
  onRemove: (slot: DashboardSlot) => void;
  onDragStart: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const rowClassName = [
    "rounded-md border shadow-sm transition",
    shiftBarClass(slot.jobType),
    locked ? "opacity-60" : "",
    isDragging ? "scale-[0.99] opacity-70 ring-2 ring-[#0e7490]" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const shiftAmountLabel = formatShiftAmountValue(slot, settings);
  const shiftQuantityLabel = formatShiftQuantityValue(slot);

  return (
    <div
      className={rowClassName}
      draggable={!locked}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      onDrop={onDrop}
    >
      <button
        className="flex min-h-11 w-full cursor-grab items-center gap-3 px-3 py-2 text-left active:cursor-grabbing disabled:cursor-not-allowed"
        disabled={locked}
        onClick={onToggle}
        type="button"
      >
        <span className="flex shrink-0 items-center gap-2">
          <span className={shiftDotClass(slot.jobType)} />
          <span className="text-sm font-semibold">
            {formatJobLabel(slot.jobType)}
          </span>
          {slot.payType === "regular" || slot.payType === "overtime" ? (
            <span className={payTypeBadgeClass(slot.payType)}>
              {slot.payType === "overtime" ? "OT" : "Reg"}
            </span>
          ) : null}
          {shiftQuantityLabel ? (
            <span className="text-xs font-semibold opacity-90">
              {shiftQuantityLabel}
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-center text-xs font-semibold">
          {slot.label ?? ""}
        </span>
        {shiftAmountLabel ? (
          <span className="shrink-0 text-sm font-medium">
            {shiftAmountLabel}
          </span>
        ) : null}
      </button>

      {expanded && !locked ? (
        <div className="grid gap-3 border-t border-dashed border-white/25 bg-black/15 p-3 backdrop-blur-md sm:grid-cols-2">
          <SelectField
            label="Job"
            value={slot.jobType}
            values={JOB_OPTIONS}
            formatOption={formatJobLabel}
            onChange={(value) =>
              onSlotChange(slot.dayId, slot.slotIndex, {
                jobType: value as JobType,
              })
            }
          />
          {slot.payType === "unit" ? (
            <span aria-hidden className="hidden sm:block" />
          ) : (
            <SelectField
              label="Type"
              value={slot.payType ?? "none"}
              values={PAY_OPTIONS}
              onChange={(value) =>
                onSlotChange(slot.dayId, slot.slotIndex, {
                  payType: value as PayType,
                })
              }
            />
          )}
          <NumberField
            label={slot.payType === "unit" ? "Amount ($)" : "Hours / units"}
            value={slot.hoursOrUnits}
            onChange={(value) =>
              onSlotChange(slot.dayId, slot.slotIndex, {
                hoursOrUnits: value,
              })
            }
          />
          <TextField
            label="Label"
            value={slot.label}
            onChange={(value) =>
              onSlotChange(slot.dayId, slot.slotIndex, { label: value })
            }
          />
          <div className="flex items-center justify-between sm:col-span-2">
            <span className="text-xs text-white/70">
              Auto-saves after edits.
            </span>
            <button
              className="text-xs font-medium text-[#b91c1c] hover:underline"
              onClick={() => onRemove(slot)}
              type="button"
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function shiftBarClass(jobType: JobType): string {
  if (jobType === "ability" || jobType === "incentive") {
    return "border-[#1e3a8a] bg-[#1d4ed8] text-white";
  }

  if (jobType === "prestige" || jobType === "prestige_ilst") {
    return "border-[#d97706] bg-[#facc15] text-[#1f2937]";
  }

  return "border-[#d7dee8] bg-white text-[#0f172a]";
}

function shiftDotClass(jobType: JobType): string {
  if (jobType === "ability" || jobType === "incentive") {
    return "h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.22)]";
  }

  if (jobType === "prestige" || jobType === "prestige_ilst") {
    return "h-2.5 w-2.5 rounded-full bg-[#92400e] shadow-[0_0_0_3px_rgba(146,64,14,0.16)]";
  }

  return "h-2.5 w-2.5 rounded-full bg-[#0e7490] shadow-[0_0_0_3px_rgba(14,116,144,0.16)]";
}

function payTypeBadgeClass(payType: PayType | null | undefined): string {
  if (payType === "overtime") {
    return "rounded-full bg-[#22c55e] px-2 py-0.5 text-[10px] font-bold uppercase text-white";
  }

  return "rounded-full bg-[#dbeafe] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#1d4ed8]";
}

function TotalsPanel({
  day,
  totals,
}: {
  day: DashboardDay;
  totals: ReturnType<typeof calculateDayTotals> | undefined;
}) {
  const earningsCents = totals?.earningsCents ?? 0;
  const spendCents = totals?.spendCents ?? 0;
  const baseCents = totals?.baseCents ?? day.baseCents;
  const cashflowCents = totals?.cashflowCents ?? 0;
  const displayCashflowCents = roundCashflowToNearestFiveDollars(cashflowCents);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-white/15 bg-black/15 p-2.5 text-sm backdrop-blur-md">
        <TotalLine label="Earn" value={formatMoney(earningsCents)} />
        <TotalLine
          label="Spend"
          tone="negative"
          value={formatMoney(spendCents)}
        />
        <TotalLine label="Base" value={formatMoney(baseCents)} />
        <div className="my-2 border-t border-white/20" />
        <TotalLine
          strong
          label="Cashflow"
          tone={cashflowDailyTone(displayCashflowCents)}
          value={formatMoney(displayCashflowCents)}
        />
      </div>
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
  tone?: "positive" | "amber" | "negative";
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className={strong ? "font-semibold text-white" : "text-white/75"}>{label}</span>
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

function SelectField({
  label,
  value,
  values,
  formatOption,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  formatOption?: (value: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-white/80">
        {label}
      </span>
      <select
        className="h-9 w-full rounded-md border border-white/20 bg-[#111827] px-2 text-sm text-white outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {values.map((option) => (
          <option key={option} value={option}>
            {formatOption ? formatOption(option) : capitalize(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  readOnly = false,
}: {
  label: string;
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-white/80">
        {label}
      </span>
      <input
        className="h-10 w-full rounded-md border border-white/20 bg-black/10 px-3 text-sm text-white outline-none transition read-only:bg-white/10 read-only:text-white/60 focus:border-white/60 focus:ring-2 focus:ring-white"
        min="0"
        onChange={(event) => onChange?.(parsePositiveNumber(event.target.value))}
        readOnly={readOnly}
        step="0.01"
        type="number"
        value={formatNumberInput(value)}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-white/80">
        {label}
      </span>
      <input
        className="h-10 w-full rounded-md border border-white/20 bg-black/10 px-3 text-sm text-white outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white"
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />
    </label>
  );
}

function SaveIndicator({
  state,
  error,
}: {
  state: SaveState;
  error: string | null;
}) {
  const label =
    state === "saving"
      ? "Saving..."
      : state === "saved"
        ? "Auto-saved"
        : state === "error"
          ? "Save failed"
          : "Auto-saved";

  return (
    <div
      className={
        state === "error"
          ? "rounded-full bg-[#fff1f2] px-3 py-1 text-xs font-medium text-[#b91c1c]"
          : "rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white"
      }
    >
      {label}
      {error ? <span className="ml-2">{error}</span> : null}
    </div>
  );
}

function moveTransactionBetweenBuckets(
  day: DashboardDay,
  transaction: DashboardTransaction,
  newStatus: "applied" | "excluded",
): DashboardDay {
  const wasApplied = day.appliedTransactions.some(
    (item) => item.id === transaction.id,
  );
  const wasExcluded = day.excludedTransactions.some(
    (item) => item.id === transaction.id,
  );
  const nextTransaction = { ...transaction, status: newStatus };
  const appliedTransactions = day.appliedTransactions.filter(
    (item) => item.id !== transaction.id,
  );
  const excludedTransactions = day.excludedTransactions.filter(
    (item) => item.id !== transaction.id,
  );
  const transactionSpendCents =
    newStatus === "excluded" && wasApplied
      ? day.transactionSpendCents - transaction.amountCents
      : newStatus === "applied" && wasExcluded
        ? day.transactionSpendCents + transaction.amountCents
        : day.transactionSpendCents;

  if (newStatus === "applied") {
    appliedTransactions.push(nextTransaction);
  } else {
    excludedTransactions.push(nextTransaction);
  }

  return {
    ...day,
    transactionSpendCents,
    appliedTransactions: sortDashboardTransactions(appliedTransactions),
    excludedTransactions: sortDashboardTransactions(excludedTransactions),
  };
}

function addAppliedTransactionToDay(
  day: DashboardDay,
  transaction: DashboardTransaction,
): DashboardDay {
  return {
    ...day,
    transactionSpendCents: day.transactionSpendCents + transaction.amountCents,
    appliedTransactions: sortDashboardTransactions([
      ...day.appliedTransactions,
      transaction,
    ]),
  };
}

function replaceTransaction(
  day: DashboardDay,
  tempId: string,
  transaction: DashboardTransaction,
): DashboardDay {
  return {
    ...day,
    appliedTransactions: sortDashboardTransactions(
      day.appliedTransactions.map((item) =>
        item.id === tempId ? transaction : item,
      ),
    ),
  };
}

function toDayInput(day: DashboardDay) {
  return {
    earnSlots: day.slots.map((slot) => ({
      jobType: slot.jobType,
      payType: slot.payType,
      hoursOrUnits: slot.hoursOrUnits,
      label: slot.label,
    })),
    spendCents: day.spendCents + day.transactionSpendCents,
    baseCents: day.baseCents,
  };
}

function normalizeSlotForClient(slot: DashboardSlot): DashboardSlot {
  if (slot.jobType === "none") {
    return {
      ...slot,
      payType: "none",
      hoursOrUnits: 0,
      label: "",
      source: "user",
    };
  }

  if (slot.jobType === "incentive" || slot.jobType === "other") {
    return {
      ...slot,
      payType: "unit",
      hoursOrUnits: Math.max(0, slot.hoursOrUnits),
      source: "user",
    };
  }

  return {
    ...slot,
    payType:
      slot.payType === "regular" || slot.payType === "overtime"
        ? slot.payType
        : "regular",
    hoursOrUnits: Math.max(0, slot.hoursOrUnits),
    source: "user",
  };
}

function makeEmptySlot(dayId: string, slotIndex: number): DashboardSlot {
  return {
    id: null,
    dayId,
    slotIndex,
    jobType: "none",
    payType: "none",
    hoursOrUnits: 0,
    label: "",
    source: "user",
  };
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function formatNumberInput(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatHoursFromSlots(
  days: DashboardDay[],
  jobTypes: JobType | JobType[],
): string {
  const selectedJobTypes = new Set(
    Array.isArray(jobTypes) ? jobTypes : [jobTypes],
  );
  const hours = days.reduce((total, day) => {
    const dayHours = day.slots.reduce((slotTotal, slot) => {
      if (!selectedJobTypes.has(slot.jobType)) {
        return slotTotal;
      }

      return slotTotal + slot.hoursOrUnits;
    }, 0);

    return total + dayHours;
  }, 0);

  return hours.toFixed(2);
}

function formatJobLabel(value: string): string {
  if (value === "prestige") {
    return "Prestige $17";
  }

  if (value === "prestige_ilst") {
    return "Prestige ILST $18";
  }

  return capitalize(value);
}

function formatPlainHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatShiftAmountValue(
  slot: DashboardSlot,
  settings: PaySettings,
): string {
  const earningsCents = calculateEarnSlot(slot, settings).earningsCents;

  if (earningsCents <= 0) {
    return "";
  }

  return formatMoney(earningsCents);
}

function formatShiftQuantityValue(slot: DashboardSlot): string {
  if (slot.payType === "unit") {
    return "";
  }

  return `${formatPlainHours(slot.hoursOrUnits)}h`;
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
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

function roundCashflowToNearestFiveDollars(value: number): number {
  const incrementCents = 500;
  const sign = value < 0 ? -1 : 1;

  return sign * Math.round(Math.abs(value) / incrementCents) * incrementCents;
}

function buildMedianTrend(
  currentCents: number,
  medianCents: number,
  favorableDirection: "higher" | "lower",
): MedianTrend | null {
  if (!Number.isFinite(currentCents) || !Number.isFinite(medianCents)) {
    return null;
  }

  if (Math.abs(medianCents) < 1) {
    return null;
  }

  const delta = currentCents - medianCents;
  const percent = Math.round((Math.abs(delta) / Math.abs(medianCents)) * 100);

  if (percent === 0) {
    return {
      direction: "flat",
      percent,
      tone: "amber",
    };
  }

  const direction = delta > 0 ? "up" : "down";
  const isFavorable =
    favorableDirection === "higher" ? delta > 0 : delta < 0;

  return {
    direction,
    percent,
    tone: isFavorable ? "positive" : "negative",
  };
}

function formatFullRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(end);

  return `${startLabel} - ${endLabel}`;
}

function formatCompactRange(startDate: string, endDate: string): string {
  return `${formatDayLabel(startDate)}-${formatDayOnly(endDate)}`;
}

function formatRangeForPrompt(startDate: string, endDate: string): string {
  return formatCompactRange(startDate, endDate);
}

function formatDayOnly(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function shortDayName(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

