"use client";

import { useRouter } from "next/navigation";
import type { DragEvent, FormEvent } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  addManualTransactionAction,
  allocateGasTransactionAction,
  amortizeTransactionAction,
  closeWeekAction,
  deleteTransactionAction,
  moveTransactionToYesterdayAction,
  refreshDashboardProjectionMaintenanceAction,
  renameTransactionAction,
  saveEarnSlotAction,
  toggleTransactionStatusAction,
  type SaveEarnSlotInput,
} from "@/app/(protected)/actions";
import { syncTransactionsAction } from "@/app/(protected)/banking/actions";
import { WeekNetSummary } from "@/components/earnings/WeekNetSummary";
import { addDaysIso, formatDayLabel } from "@/lib/dashboard/dates";
import { sortDashboardTransactions } from "@/lib/dashboard/transactions";
import type {
  DashboardCustomJob,
  DashboardData,
  DashboardDay,
  DashboardSlot,
  DashboardTransaction,
  SaveState,
} from "@/lib/dashboard/types";
import { centsToDollars, dollarsToCents } from "@/lib/domain/money";
import { contrastText, darken } from "@/lib/domain/jobColor";
import {
  calculateEarnSlot,
  calculateDayTotals,
  calculateWeekTotals,
  getPayPeriodInfo,
  netEarningsByBucket,
  type IncentiveMode,
  type JobType,
  type PaySettings,
  type PayType,
} from "@/lib/domain/pay";
import {
  cashflowColorFromTone,
  cashflowDailyColor,
  cashflowDailyTone,
  cashflowWeeklyTone,
  earningsWeeklyTone,
  spendWeeklyTone,
} from "@/lib/domain/legacyRules";
const JOB_OPTIONS: JobType[] = [
  "none",
  "ability",
  "prestige",
  "prestige_ilst",
  "other",
];
const PAY_OPTIONS: PayType[] = ["none", "regular", "overtime", "split", "unit"];
const INCENTIVE_MODE_OPTIONS: IncentiveMode[] = ["rate", "lump_sum"];
const AUTO_SYNC_STORAGE_KEY = "shiftly:lastAutoSyncAt";

type DashboardEditorProps = {
  initialData: DashboardData;
};

type TimerMap = Record<string, ReturnType<typeof setTimeout>>;
type VersionMap = Record<string, number>;

const CustomJobsContext = createContext<DashboardCustomJob[]>([]);

export function DashboardEditor({ initialData }: DashboardEditorProps) {
  const customJobs = initialData.customJobs;
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
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
    const THROTTLE_MS = 5 * 60 * 1000;
    const last = Number(sessionStorage.getItem(AUTO_SYNC_STORAGE_KEY) ?? "0");
    if (Date.now() - last < THROTTLE_MS) return;
    sessionStorage.setItem(AUTO_SYNC_STORAGE_KEY, String(Date.now()));

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
          withBucketCredit(
            calculateDayTotals(toDayInput(day), initialData.settings),
            sumBucketCreditCents(day),
          ),
        ]),
      ),
    [days, initialData.settings],
  );
  const weekTotals = useMemo(() => {
    const base = calculateWeekTotals(
      { days: days.map(toDayInput) },
      initialData.settings,
    );
    const creditCents = days.reduce(
      (sum, day) => sum + sumBucketCreditCents(day),
      0,
    );
    return withBucketCredit(base, creditCents);
  }, [days, initialData.settings]);
  const weekNetTotals = useMemo(
    () => netEarningsByBucket(toComputedEarningSlots(days, initialData.settings)),
    [days, initialData.settings],
  );
  // Per-custom-job net for the week: one chip per custom job that has shifts.
  // Derived straight from the week's slots (grouped by job) using the stamped
  // name/color, so the chips ALWAYS reconcile to the Earn total — including a
  // job later deactivated that still holds shifts this week. A job with no
  // shifts shows no chip (so a removed/unused job drops off the bar).
  const customNets = useMemo(() => {
    const byJob = new Map<
      string,
      { id: string; name: string; color: string; netCents: number }
    >();
    for (const day of days) {
      for (const slot of day.slots) {
        if (slot.jobType !== "custom" || !slot.customJobId) {
          continue;
        }
        const earnings = calculateEarnSlot(slot, initialData.settings)
          .earningsCents;
        const existing = byJob.get(slot.customJobId);
        if (existing) {
          existing.netCents += earnings;
        } else {
          byJob.set(slot.customJobId, {
            id: slot.customJobId,
            name: slot.customName ?? "Custom",
            color: slot.customColor ?? "#3b82f6",
            netCents: earnings,
          });
        }
      }
    }
    return Array.from(byJob.values());
  }, [days, initialData.settings]);
  const focusedDay = days[focusedDayIndex] ?? days[0];
  const focusedDayTotals = focusedDay ? dayTotals.get(focusedDay.id) : undefined;

  async function handleManualSync() {
    setSyncStatus(null);
    setIsSyncing(true);

    try {
      const result = await syncTransactionsAction({ forceRefresh: true });
      window.sessionStorage.setItem(AUTO_SYNC_STORAGE_KEY, String(Date.now()));
      setSyncStatus(`Pulled ${result.added} new, ${result.modified} updated`);
      router.refresh();
      window.setTimeout(() => setSyncStatus(null), 4000);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }

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

    const key = `slot:${nextSlot.dayId}:${nextSlot.slotIndex}`;
    if (isIncompleteSplitSlot(nextSlot)) {
      clearTimeout(timers.current[key]);
      setSaveState("idle");
      return;
    }

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

    // Reorder only operates on real (editable) slots. Synthetic bucket rows have
    // slotIndex >= 4 and are never persisted as earn_slots; carry them through
    // untouched so the optimistic UI keeps showing them.
    const bucketSlots = day.slots.filter((slot) => slot.kind === "bucket");
    const activeSlots = day.slots
      .filter((slot) => slot.kind !== "bucket" && slot.jobType !== "none")
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

    const nextSlots = [
      ...Array.from({ length: 4 }, (_, slotIndex) => {
        const activeSlot = reorderedActiveSlots[slotIndex];

        if (activeSlot) {
          return normalizeSlotForClient({
            ...activeSlot,
            slotIndex,
            source: "user",
          });
        }

        return makeEmptySlot(dayId, slotIndex);
      }),
      ...bucketSlots,
    ];

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

  async function deleteTransaction(transaction: DashboardTransaction) {
    if (pendingTransactionIds.has(transaction.id)) {
      return;
    }

    const previousDays = days;
    setTransactionError(null);
    setSaveState("saving");
    setPendingTransactionIds((current) => new Set(current).add(transaction.id));
    setDays((currentDays) =>
      currentDays.map((day) => removeTransactionFromDay(day, transaction.id)),
    );

    try {
      await deleteTransactionAction({ transactionId: transaction.id });
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
        error instanceof Error ? error.message : "Unable to delete transaction.",
      );
    } finally {
      setPendingTransactionIds((current) => {
        const next = new Set(current);
        next.delete(transaction.id);
        return next;
      });
    }
  }

  async function moveTransactionToYesterday(transaction: DashboardTransaction) {
    if (pendingTransactionIds.has(transaction.id)) {
      return;
    }

    const previousDays = days;
    const yesterdayIso = addDaysIso(transaction.date, -1);
    const targetDay = days.find((day) => day.date === yesterdayIso);

    setTransactionError(null);
    setSaveState("saving");
    setPendingTransactionIds((current) => new Set(current).add(transaction.id));

    if (targetDay) {
      setDays((currentDays) =>
        moveTransactionToDay(currentDays, transaction, targetDay),
      );
    }

    try {
      await moveTransactionToYesterdayAction({ transactionId: transaction.id });
      lastSavedAt.current = Date.now();
      setSaveState("saved");
      router.refresh();
      window.setTimeout(() => {
        if (lastSavedAt.current && Date.now() - lastSavedAt.current >= 1150) {
          setSaveState("idle");
        }
      }, 1200);
    } catch (error) {
      setDays(previousDays);
      setSaveState("error");
      setTransactionError(
        error instanceof Error ? error.message : "Unable to move transaction.",
      );
    } finally {
      setPendingTransactionIds((current) => {
        const next = new Set(current);
        next.delete(transaction.id);
        return next;
      });
    }
  }

  async function renameTransaction(
    transaction: DashboardTransaction,
    merchantName: string,
  ) {
    if (pendingTransactionIds.has(transaction.id)) {
      return;
    }

    const trimmed = merchantName.trim();
    if (!trimmed || trimmed === transaction.merchantName) {
      return;
    }

    const previousDays = days;
    setTransactionError(null);
    setSaveState("saving");
    setPendingTransactionIds((current) => new Set(current).add(transaction.id));
    setDays((currentDays) =>
      currentDays.map((day) => renameTransactionInDay(day, transaction.id, trimmed)),
    );

    try {
      await renameTransactionAction({
        transactionId: transaction.id,
        merchantName: trimmed,
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
        error instanceof Error ? error.message : "Unable to rename transaction.",
      );
    } finally {
      setPendingTransactionIds((current) => {
        const next = new Set(current);
        next.delete(transaction.id);
        return next;
      });
    }
  }

  async function amortizeTransaction(
    transaction: DashboardTransaction,
    months: 1 | 3,
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
          ? moveTransactionBetweenBuckets(
              day,
              { ...transaction, isAmortized: true },
              "excluded",
            )
          : day,
      ),
    );

    try {
      await amortizeTransactionAction({
        transactionId: transaction.id,
        months,
      });
      lastSavedAt.current = Date.now();
      setSaveState("saved");
      router.refresh();
      window.setTimeout(() => {
        if (lastSavedAt.current && Date.now() - lastSavedAt.current >= 1150) {
          setSaveState("idle");
        }
      }, 1200);
    } catch (error) {
      setDays(previousDays);
      setSaveState("error");
      setTransactionError(
        error instanceof Error ? error.message : "Unable to amortize transaction.",
      );
    } finally {
      setPendingTransactionIds((current) => {
        const next = new Set(current);
        next.delete(transaction.id);
        return next;
      });
    }
  }

  async function allocateGasTransaction(
    transaction: DashboardTransaction,
    gasAmountCents: number,
    previousFillDate: string | null,
  ) {
    if (pendingTransactionIds.has(transaction.id)) {
      return;
    }

    if (gasAmountCents <= 0 || gasAmountCents > transaction.originalAmountCents) {
      setTransactionError("Gas amount must be above $0 and no more than the transaction.");
      return;
    }

    setTransactionError(null);
    setSaveState("saving");
    setPendingTransactionIds((current) => new Set(current).add(transaction.id));
    try {
      await allocateGasTransactionAction({
        transactionId: transaction.id,
        gasAmountCents,
        previousFillDate,
      });
      lastSavedAt.current = Date.now();
      setSaveState("saved");
      router.refresh();
      window.setTimeout(() => {
        if (lastSavedAt.current && Date.now() - lastSavedAt.current >= 1150) {
          setSaveState("idle");
        }
      }, 1200);
    } catch (error) {
      setSaveState("error");
      setTransactionError(
        error instanceof Error ? error.message : "Unable to allocate gas.",
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
      originalAmountCents: amountCents,
      category: null,
      source: "manual",
      status: "applied",
      isAmortized: false,
      isGasAllocated: false,
      gasAllocatedCents: 0,
      gasRemainderCents: amountCents,
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
      incentiveMode: "none",
      incentiveRate: 0,
      incentiveAmount: 0,
      label: "",
    });
  }

  function focusDay(dayIndex: number) {
    setFocusedDayIndex(dayIndex);
    setExpandedSlotIndex(null);
    setTransactionError(null);
  }

  function scheduleSlotSave(slot: DashboardSlot) {
    // Synthetic Amortized Income rows are derived, never persisted as earn_slots.
    if (slot.kind === "bucket") {
      return;
    }
    const key = `slot:${slot.dayId}:${slot.slotIndex}`;
    const version = bumpVersion(key);
    const input: SaveEarnSlotInput = {
      dayId: slot.dayId,
      slotIndex: slot.slotIndex,
      jobType: slot.jobType,
      payType: slot.payType ?? "none",
      hoursOrUnits: slot.hoursOrUnits,
      regularHours: slot.regularHours,
      overtimeHours: slot.overtimeHours,
      incentiveMode: slot.incentiveMode,
      incentiveRate: slot.incentiveRate,
      incentiveAmount: slot.incentiveAmount,
      label: slot.label,
      customJobId: slot.jobType === "custom" ? slot.customJobId : null,
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
    <CustomJobsContext.Provider value={customJobs}>
    <div className="min-h-screen bg-[var(--surface-base)] px-3 py-4 text-[var(--text-primary)] sm:px-4 lg:px-6">
      {closeError ? (
        <div className="mx-auto mb-5 max-w-7xl rounded-md border border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] p-3 text-sm font-medium text-[var(--accent-negative-text)]">
          {closeError}
        </div>
      ) : null}

      {closeToast ? (
        <div className="mx-auto mb-5 max-w-7xl rounded-md border border-[var(--accent-primary-border)] bg-[var(--accent-primary-fill)] p-3 text-sm font-medium text-[var(--accent-primary-text)]">
          {closeToast}
        </div>
      ) : null}

      <main className="mx-auto max-w-7xl">
        <section className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
          <div className="h-2 bg-[var(--surface-elevated)]" />
          <div className="p-3 sm:p-4">
          <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(420px,0.9fr)] lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                Week {initialData.week.displayWeekNumber}
              </p>
              <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-[var(--text-primary)] drop-shadow-sm sm:text-3xl">
                {formatFullRange(initialData.week.startDate, initialData.week.endDate)}
                <CalendarIcon />
              </h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <p className="inline-flex rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)] shadow-sm">
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
              <div className="mb-3 flex flex-wrap items-center justify-start gap-2 lg:justify-end">
                <span className="inline-flex rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-1 text-xs font-semibold text-[var(--text-primary)] shadow-sm">
                  Active week
                </span>
                <button
                  className="inline-flex rounded-full border border-[var(--accent-primary-border)] bg-[var(--accent-primary)] px-3 py-1 text-xs font-bold text-[var(--surface-base)] shadow-sm transition hover:bg-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={isSyncing}
                  onClick={handleManualSync}
                  type="button"
                >
                  {isSyncing ? "Syncing..." : "Sync now"}
                </button>
                {syncStatus ? (
                  <span className="inline-flex rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)] shadow-sm">
                    {syncStatus}
                  </span>
                ) : null}
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
              onAmortizeTransaction={amortizeTransaction}
              onAllocateGasTransaction={allocateGasTransaction}
              onDeleteTransaction={deleteTransaction}
              onMoveTransactionToYesterday={moveTransactionToYesterday}
              onRenameTransaction={renameTransaction}
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

          <div className="mt-4 flex flex-col gap-3 border-t border-[var(--border-default)] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-[var(--text-primary)]">
              <span>
                Prestige:{" "}
                {formatHoursFromSlots(days, ["prestige", "prestige_ilst"])}h
              </span>
              <span>
                Ability:{" "}
                {formatHoursFromSlots(days, ["ability", "ability_incentive"])}h
              </span>
              <span>Total: {weekTotals.wageHours.toFixed(2)}h</span>
            </div>
            <WeekNetSummary
              abilityNetCents={weekNetTotals.abilityNetCents}
              customNets={customNets}
              prestigeNetCents={weekNetTotals.prestigeNetCents}
            />
            <button
              className="h-10 w-full rounded-md bg-[var(--surface-base)] px-5 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-hover)] disabled:text-[var(--text-muted)] disabled:shadow-none sm:w-auto"
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
    </CustomJobsContext.Provider>
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
  const cashflowTone = cashflowWeeklyTone(displayCashflowCents);
  const spendTone = spendWeeklyTone(spendCents, medians.spendCents);
  const earningsTone = earningsWeeklyTone(earningsCents, medians.earningsCents);

  return (
    <div className="grid grid-cols-3 gap-2">
      <TopMetric
        accent={earningsTone}
        label="Earn"
        tone={earningsTone}
        trend={buildMedianTrend(earningsCents, medians.earningsCents, "higher")}
        value={formatMoney(earningsCents)}
      />
      <TopMetric
        accent={spendTone}
        label="Spend"
        tone={spendTone}
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
        value={formatCashflow(displayCashflowCents)}
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
          ? "before:bg-[var(--accent-warning)]"
          : accent === "negative"
            ? "before:bg-red-600"
      : accent === "blue"
        ? "before:bg-[var(--accent-primary)]"
        : "before:bg-[var(--border-strong)]";

  return (
    <div
      className={
        dark
          ? `rounded-md bg-[var(--surface-base)] px-2.5 py-3 text-[var(--text-primary)] sm:px-4 ${className}`
          : `relative overflow-hidden rounded-md border-2 border-[var(--border-strong)] bg-[var(--surface-elevated)] px-2.5 py-3 text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_24px_rgba(8,15,28,0.12)] before:absolute before:inset-x-0 before:top-0 before:h-1 sm:px-4 ${accentClass} ${className}`
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={
            dark
              ? "text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]"
              : "text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]"
          }
        >
          {label}
        </div>
        {trend ? (
          <div
            className={`shrink-0 whitespace-nowrap pr-px text-right text-[8px] font-bold uppercase leading-none tracking-[0.02em] sm:text-[9px] md:text-[10px] md:tracking-[0.08em] ${cashflowColorFromTone(
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
            ? "mt-1 text-xl font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl lg:text-3xl"
            : tone
              ? `mt-1 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl ${cashflowColorFromTone(tone)}`
              : "mt-1 text-xl font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl lg:text-3xl"
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
      className="h-4 w-4 text-[var(--text-primary)]"
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
    day.date > todayIso
    && spendCents === 0
    && !day.spendLocked
    && projectedDailySpendCents > 0;

  const projectedCashflowCents = isFutureUnspent
    ? earningsCents - projectedDailySpendCents - baseCents
    : null;

  const displayCashflowCents = roundCashflowToNearestFiveDollars(
    projectedCashflowCents ?? cashflowCents,
  );
  const dayTone = cashflowDailyTone(displayCashflowCents);
  const toneBorder =
    dayTone === "positive"
      ? "border-[var(--accent-primary-border)]"
      : dayTone === "amber"
        ? "border-[var(--accent-warning-border)]"
        : "border-[var(--accent-negative-border)]";
  const toneBorderFocused =
    dayTone === "positive"
      ? "border-[var(--accent-primary-border)]"
      : dayTone === "amber"
        ? "border-[var(--accent-warning-border)]"
        : "border-[var(--accent-negative-border)]";
  const toneGlow =
    dayTone === "positive"
      ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
      : dayTone === "amber"
        ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
        : "shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]";
  const toneGlowFocused =
    dayTone === "positive"
      ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]"
      : dayTone === "amber"
        ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]"
        : "shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]";
  const selectedStyle = isFocused
    ? {
        borderColor: "var(--accent-primary)",
        boxShadow:
          "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 1px var(--accent-primary), 0 0 24px -6px rgba(10, 129, 86, 0.45)",
      }
    : undefined;

  return (
    <button
      className={
        isFocused
          ? `min-w-0 rounded-md border-[3px] ${toneBorderFocused} bg-[var(--surface-elevated)] px-1.5 py-2 text-left ${toneGlowFocused} transition-colors duration-150 focus:outline-none sm:p-3`
          : day.spendLocked
            ? `min-w-0 rounded-md border-2 ${toneBorder} bg-[var(--surface-elevated)] px-1.5 py-2 text-left opacity-75 ${toneGlow} transition hover:bg-[var(--surface-elevated)] focus:outline-none sm:p-3`
            : `min-w-0 rounded-md border-2 ${toneBorder} bg-[var(--surface-elevated)] px-1.5 py-2 text-left ${toneGlow} transition hover:bg-[var(--surface-elevated)] focus:outline-none sm:p-3`
      }
      onClick={() => onFocus(dayIndex)}
      style={selectedStyle}
      type="button"
    >
      <div className="flex min-w-0 items-center justify-between gap-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)] sm:text-[10px] sm:tracking-[0.18em]">
        <span className="whitespace-nowrap">
          {shortDayName(day.date)}
          <span className="hidden sm:inline"> {formatDayOnly(day.date)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {isToday ? (
            <span className="hidden rounded-full bg-[var(--surface-hover)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--text-primary)] sm:inline-flex">
              Today
            </span>
          ) : null}
          {day.spendLocked ? (
            <span className="hidden rounded-full bg-[var(--surface-hover)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--text-primary)] sm:inline-flex">
              Locked
            </span>
          ) : null}
        </span>
      </div>
      <p
        className={`mt-2 truncate text-xs font-bold tracking-tight sm:mt-3 sm:text-sm md:text-base lg:text-lg xl:text-xl ${cashflowDailyColor(
          displayCashflowCents,
        )} ${isFutureUnspent ? "italic opacity-70" : ""}`}
      >
        <span className="sm:hidden">{formatCashflowNoSymbol(displayCashflowCents)}</span>
        <span className="hidden sm:inline">{formatCashflow(displayCashflowCents)}</span>
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
  onDeleteTransaction,
  onMoveTransactionToYesterday,
  onRenameTransaction,
  onAmortizeTransaction,
  onAllocateGasTransaction,
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
  onDeleteTransaction: (transaction: DashboardTransaction) => void;
  onMoveTransactionToYesterday: (transaction: DashboardTransaction) => void;
  onRenameTransaction: (
    transaction: DashboardTransaction,
    merchantName: string,
  ) => void;
  onAmortizeTransaction: (
    transaction: DashboardTransaction,
    months: 1 | 3,
  ) => void;
  onAllocateGasTransaction: (
    transaction: DashboardTransaction,
    gasAmountCents: number,
    previousFillDate: string | null,
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
    <section className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
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
          onAllocateGasTransaction={onAllocateGasTransaction}
          onAmortizeTransaction={onAmortizeTransaction}
          onDeleteTransaction={onDeleteTransaction}
          onMoveTransactionToYesterday={onMoveTransactionToYesterday}
          onRenameTransaction={onRenameTransaction}
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
  onDeleteTransaction,
  onMoveTransactionToYesterday,
  onRenameTransaction,
  onAmortizeTransaction,
  onAllocateGasTransaction,
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
  onDeleteTransaction: (transaction: DashboardTransaction) => void;
  onMoveTransactionToYesterday: (transaction: DashboardTransaction) => void;
  onRenameTransaction: (
    transaction: DashboardTransaction,
    merchantName: string,
  ) => void;
  onAmortizeTransaction: (
    transaction: DashboardTransaction,
    months: 1 | 3,
  ) => void;
  onAllocateGasTransaction: (
    transaction: DashboardTransaction,
    gasAmountCents: number,
    previousFillDate: string | null,
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
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-[var(--text-primary)] shadow-sm">
      {error ? (
        <div className="mb-3 rounded-md border border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] px-3 py-2 text-xs font-medium text-[var(--accent-negative-text)]">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <TransactionColumn
          heading="SPENDING"
          pendingTransactionIds={pendingTransactionIds}
          transactions={appliedTransactions}
          variant="spending"
          onDelete={onDeleteTransaction}
          onMoveToYesterday={onMoveTransactionToYesterday}
          onRename={onRenameTransaction}
          onAllocateGas={onAllocateGasTransaction}
          onAmortize={onAmortizeTransaction}
          onToggle={(transaction) =>
            onToggleTransactionStatus(transaction, "excluded")
          }
        />
        <TransactionColumn
          heading="EXEMPT"
          pendingTransactionIds={pendingTransactionIds}
          transactions={excludedTransactions}
          variant="exempt"
          onDelete={onDeleteTransaction}
          onMoveToYesterday={onMoveTransactionToYesterday}
          onRename={onRenameTransaction}
          onToggle={(transaction) =>
            onToggleTransactionStatus(transaction, "applied")
          }
        />
      </div>

      <div className="mt-3 border-t border-dashed border-[var(--border-default)] pt-3">
        {isAdding ? (
          <form
            className="grid gap-2 sm:grid-cols-[1fr_140px_auto_auto]"
            onSubmit={submitManualTransaction}
          >
            <input
              className="h-10 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white"
              onChange={(event) => setMerchantName(event.target.value)}
              placeholder="Merchant"
              type="text"
              value={merchantName}
            />
            <input
              className="h-10 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white"
              min="0"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Amount"
              step="0.01"
              type="number"
              value={amount}
            />
            <button
              className="h-10 rounded-md bg-[var(--surface-base)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
              disabled={isManualTransactionPending}
              type="submit"
            >
              {isManualTransactionPending ? "Saving..." : "Save"}
            </button>
            <button
              className="h-10 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-subtle)]0 hover:bg-[var(--surface-elevated)]"
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
            className="h-9 rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-subtle)]0 hover:bg-[var(--surface-elevated)]"
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
  onDelete,
  onMoveToYesterday,
  onRename,
  onToggle,
  onAllocateGas,
  onAmortize,
}: {
  heading: string;
  pendingTransactionIds: Set<string>;
  transactions: DashboardTransaction[];
  variant: "spending" | "exempt";
  onDelete: (transaction: DashboardTransaction) => void;
  onMoveToYesterday: (transaction: DashboardTransaction) => void;
  onRename: (transaction: DashboardTransaction, merchantName: string) => void;
  onToggle: (transaction: DashboardTransaction) => void;
  onAllocateGas?: (
    transaction: DashboardTransaction,
    gasAmountCents: number,
    previousFillDate: string | null,
  ) => void;
  onAmortize?: (transaction: DashboardTransaction, months: 1 | 3) => void;
}) {
  return (
    <div className="min-h-0 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          {heading}
        </h3>
        <span className="rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-xs font-semibold text-[var(--text-primary)]">
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
            onDelete={onDelete}
            onMoveToYesterday={onMoveToYesterday}
            onRename={onRename}
            onToggle={onToggle}
            onAllocateGas={onAllocateGas}
            onAmortize={onAmortize}
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
  onDelete,
  onMoveToYesterday,
  onRename,
  onToggle,
  onAllocateGas,
  onAmortize,
}: {
  transaction: DashboardTransaction;
  disabled: boolean;
  variant: "spending" | "exempt";
  onDelete: (transaction: DashboardTransaction) => void;
  onMoveToYesterday: (transaction: DashboardTransaction) => void;
  onRename: (transaction: DashboardTransaction, merchantName: string) => void;
  onToggle: (transaction: DashboardTransaction) => void;
  onAllocateGas?: (
    transaction: DashboardTransaction,
    gasAmountCents: number,
    previousFillDate: string | null,
  ) => void;
  onAmortize?: (transaction: DashboardTransaction, months: 1 | 3) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(transaction.merchantName);
  const [isGasEditing, setIsGasEditing] = useState(false);
  const [gasAmountValue, setGasAmountValue] = useState(
    formatCentsForInput(
      transaction.isGasAllocated
        ? transaction.gasAllocatedCents
        : transaction.originalAmountCents,
    ),
  );
  const [previousGasDate, setPreviousGasDate] = useState("");
  const isAmortizedExempt = variant === "exempt" && transaction.isAmortized;
  const rowStyle = isAmortizedExempt
    ? {
        backgroundColor: "rgba(37, 99, 235, 0.12)",
        borderColor: "rgba(96, 165, 250, 0.48)",
      }
    : undefined;

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    onRename(transaction, trimmed);
    setIsRenaming(false);
  }

  function submitGasAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const gasAmountCents = dollarsToCents(parsePositiveNumber(gasAmountValue));
    onAllocateGas?.(
      transaction,
      gasAmountCents,
      previousGasDate.trim() || null,
    );
    setIsGasEditing(false);
  }

  return (
    <div
      className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-sm shadow-sm transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)]"
      style={rowStyle}
    >
      <button
        className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={() => setIsExpanded((current) => !current)}
        type="button"
      >
        <span className="min-w-0">
          <span
            className={
              isAmortizedExempt
                ? "block truncate font-semibold text-sky-200 line-through"
                : variant === "exempt"
                ? "block truncate font-semibold text-[var(--text-muted)] line-through"
                : "block truncate font-semibold text-[var(--text-primary)]"
            }
          >
            {transaction.merchantName}
          </span>
          <span
            className={
              variant === "exempt"
                ? "block text-[10px] font-semibold text-[var(--text-tertiary)]"
                : "block text-[10px] font-semibold text-[var(--text-tertiary)]"
            }
          >
            {formatTransactionTime(transaction.time)}
            {transaction.isGasAllocated ? (
              <span className="ml-1 text-[var(--accent-warning-text)]">
                Gas spread
              </span>
            ) : null}
          </span>
        </span>
        <span
          className={
            isAmortizedExempt
              ? "font-semibold text-sky-200 line-through"
              : variant === "exempt"
              ? "font-semibold text-[var(--text-tertiary)] line-through"
              : "font-semibold text-red-600"
          }
        >
          {formatTransactionAmount(transaction.amountCents, variant)}
        </span>
      </button>

      {isExpanded ? (
        <div className="border-t border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2">
          {transaction.isGasAllocated ? (
            <div className="mb-2 rounded-md border border-[var(--accent-warning-border)] bg-[var(--accent-warning-fill)] px-2 py-1 text-[10px] font-semibold text-[var(--accent-warning-text)]">
              Gas {formatMoneyExact(transaction.gasAllocatedCents)} spread as daily
              spend; {formatMoneyExact(transaction.gasRemainderCents)} stays here.
            </div>
          ) : null}
          {isGasEditing ? (
            <form
              className="mb-2 grid gap-2 rounded-md border border-[var(--accent-warning-border)] bg-[var(--accent-warning-fill)] p-2 sm:grid-cols-[110px_1fr_auto]"
              onSubmit={submitGasAllocation}
            >
              <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-warning-text)]">
                Gas $
                <input
                  className="mt-1 block h-8 w-full rounded-md border border-[var(--accent-warning-border)] bg-[var(--surface-base)] px-2 text-xs font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                  disabled={disabled}
                  inputMode="decimal"
                  onChange={(event) => setGasAmountValue(event.target.value)}
                  value={gasAmountValue}
                />
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-warning-text)]">
                Previous gas
                <input
                  className="mt-1 block h-8 w-full rounded-md border border-[var(--accent-warning-border)] bg-[var(--surface-base)] px-2 text-xs font-semibold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)]"
                  disabled={disabled}
                  onChange={(event) => setPreviousGasDate(event.target.value)}
                  placeholder="Auto"
                  type="date"
                  value={previousGasDate}
                />
              </label>
              <div className="flex items-end gap-2">
                <button
                  className="h-8 rounded-md border border-[var(--accent-warning-border)] bg-[var(--surface-base)] px-2.5 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={disabled || parsePositiveNumber(gasAmountValue) <= 0}
                  type="submit"
                >
                  Save
                </button>
                <button
                  className="h-8 rounded-md px-2.5 text-xs font-semibold text-[var(--accent-warning-text)] transition hover:text-[var(--text-primary)]"
                  onClick={() => setIsGasEditing(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
          {isRenaming ? (
            <form className="mb-2 flex gap-2" onSubmit={submitRename}>
              <input
                className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white/30"
                disabled={disabled}
                onChange={(event) => setRenameValue(event.target.value)}
                value={renameValue}
              />
              <button
                className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || !renameValue.trim()}
                type="submit"
              >
                Save
              </button>
              <button
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
                onClick={() => {
                  setRenameValue(transaction.merchantName);
                  setIsRenaming(false);
                }}
                type="button"
              >
                Cancel
              </button>
            </form>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onClick={() => {
                setRenameValue(transaction.merchantName);
                setIsRenaming(true);
              }}
              type="button"
            >
              Rename
            </button>
            <button
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={() => onToggle(transaction)}
            type="button"
          >
            {variant === "exempt" ? "Include" : "Exempt"}
          </button>
          <button
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={() => onMoveToYesterday(transaction)}
            type="button"
          >
            Move to yesterday
          </button>
          {variant === "spending" && onAllocateGas ? (
            <button
              className="rounded-md border border-[var(--accent-warning-border)] bg-[var(--accent-warning-fill)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-warning-text)] transition hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onClick={() => {
                const next = !isGasEditing;
                if (next) {
                  setGasAmountValue(
                    formatCentsForInput(
                      transaction.isGasAllocated
                        ? transaction.gasAllocatedCents
                        : transaction.originalAmountCents,
                    ),
                  );
                }
                setIsGasEditing(next);
                setIsRenaming(false);
              }}
              title="Spread the gas part as daily spend; any extra stays on this day."
              type="button"
            >
              {transaction.isGasAllocated ? "Edit gas" : "Gas"}
            </button>
          ) : null}
          {variant === "spending" && onAmortize ? (
            <>
              <button
                className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
                onClick={() => onAmortize(transaction, 1)}
                title="Spread this cost across fixed costs over 1 month, then expire."
                type="button"
              >
                Amort 1mo
              </button>
              <button
                className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
                onClick={() => onAmortize(transaction, 3)}
                title="Spread this cost across fixed costs over 3 months, then expire."
                type="button"
              >
                Amort 3mo
              </button>
            </>
          ) : null}
          <button
            className="rounded-md border border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-negative-text)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={() => {
              if (window.confirm(`Delete ${transaction.merchantName}?`)) {
                onDelete(transaction);
              }
            }}
            type="button"
          >
            Delete
          </button>
          </div>
        </div>
      ) : null}
    </div>
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
  // Bucket rows render in the list but must NOT count toward the 4-shift cap.
  const activeSlots = day.slots.filter((slot) => slot.jobType !== "none");
  const realActiveCount = activeSlots.filter(
    (slot) => slot.kind !== "bucket",
  ).length;

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
          <div className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--text-secondary)]">
            No shifts logged for this day.
          </div>
        )}
      </div>
      <button
        className="h-10 w-full rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-subtle)]0 hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={day.spendLocked || realActiveCount >= 4}
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
  // Synthetic Amortized Income credit: READ-ONLY. No expand, no Remove, not
  // draggable. The amount is formatted DIRECTLY from the signed creditCents,
  // bypassing formatShiftAmountValue (which blanks/clamps non-positive values).
  if (slot.kind === "bucket") {
    return (
      <div
        className={[
          "flex min-h-11 w-full items-center gap-3 rounded-md border px-3 py-2 shadow-sm",
          shiftBarClass(slot.jobType),
          locked ? "opacity-60" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="flex shrink-0 items-center gap-2">
          <span className={shiftDotClass(slot.jobType)} />
          <span className="text-sm font-semibold">Other</span>
          <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-80">
            Amortized
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-center text-xs font-semibold">
          {slot.label}
        </span>
        <span className="shrink-0 text-sm font-medium tabular-nums">
          {formatBucketCreditAmount(slot.creditCents ?? 0)}
        </span>
      </div>
    );
  }

  const isCustom = slot.jobType === "custom";
  const customStyle =
    isCustom && slot.customColor
      ? {
          backgroundColor: slot.customColor,
          borderColor: darken(slot.customColor),
          color: contrastText(slot.customColor),
        }
      : undefined;
  const rowClassName = [
    "rounded-md border shadow-sm transition",
    isCustom ? "" : shiftBarClass(slot.jobType),
    locked ? "opacity-60" : "",
    isDragging ? "scale-[0.99] opacity-70 ring-2 ring-[var(--accent-primary)]" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const shiftAmountLabel = formatShiftAmountValue(slot, settings);
  const shiftQuantityLabel = formatShiftQuantityValue(slot);

  return (
    <div
      className={rowClassName}
      style={customStyle}
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
          <span
            className={shiftDotClass(slot.jobType)}
            style={
              isCustom && slot.customColor
                ? { backgroundColor: contrastText(slot.customColor) }
                : undefined
            }
          />
          <span className="text-sm font-semibold">
            {isCustom ? (slot.customName ?? "Custom") : formatJobLabel(slot.jobType)}
          </span>
          {slot.payType === "regular" ||
          slot.payType === "overtime" ||
          slot.payType === "split" ? (
            <span className={payTypeBadgeClass(slot.payType)}>
              {formatPayBadge(slot.payType)}
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
        <div className="grid gap-3 border-t border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] p-3 sm:grid-cols-2">
          <JobPicker slot={slot} onSlotChange={onSlotChange} />
          {slot.payType === "unit" ? (
            <span aria-hidden className="hidden sm:block" />
          ) : (
            <SelectField
              label="Type"
              value={slot.payType ?? "none"}
              values={PAY_OPTIONS}
              formatOption={formatPayOptionLabel}
              onChange={(value) =>
                onSlotChange(
                  slot.dayId,
                  slot.slotIndex,
                  normalizePayTypePatch(slot, value as PayType),
                )
              }
            />
          )}
          {slot.payType === "split" ? (
            <>
              <NumberField
                label="Regular hours"
                value={slot.regularHours}
                onChange={(value) =>
                  onSlotChange(slot.dayId, slot.slotIndex, {
                    regularHours: value,
                    hoursOrUnits: value + slot.overtimeHours,
                  })
                }
              />
              <NumberField
                label="OT hours"
                value={slot.overtimeHours}
                onChange={(value) =>
                  onSlotChange(slot.dayId, slot.slotIndex, {
                    overtimeHours: value,
                    hoursOrUnits: slot.regularHours + value,
                  })
                }
              />
            </>
          ) : (
            <NumberField
              label={slot.payType === "unit" ? "Amount ($)" : "Hours / units"}
              value={slot.hoursOrUnits}
              onChange={(value) =>
                onSlotChange(slot.dayId, slot.slotIndex, {
                  hoursOrUnits: value,
                })
              }
            />
          )}
          {isAbilityShift(slot.jobType) ? (
            <>
              <SelectField
                label="Incentive"
                value={slot.incentiveMode === "lump_sum" ? "lump_sum" : "rate"}
                values={INCENTIVE_MODE_OPTIONS}
                formatOption={formatIncentiveModeLabel}
                onChange={(value) =>
                  onSlotChange(slot.dayId, slot.slotIndex, {
                    incentiveMode: value as IncentiveMode,
                    incentiveRate: value === "rate" ? slot.incentiveRate : 0,
                    incentiveAmount:
                      value === "lump_sum" ? slot.incentiveAmount : 0,
                  })
                }
              />
              <NumberField
                label={
                  slot.incentiveMode === "lump_sum"
                    ? "Incentive lump ($)"
                    : "Incentive rate ($/h)"
                }
                value={
                  slot.incentiveMode === "lump_sum"
                    ? slot.incentiveAmount
                    : slot.incentiveRate
                }
                onChange={(value) =>
                  onSlotChange(
                    slot.dayId,
                    slot.slotIndex,
                    slot.incentiveMode === "lump_sum"
                      ? { incentiveAmount: value }
                      : { incentiveRate: value },
                  )
                }
              />
            </>
          ) : null}
          <TextField
            label="Label"
            value={slot.label}
            onChange={(value) =>
              onSlotChange(slot.dayId, slot.slotIndex, { label: value })
            }
          />
          <div className="flex items-center justify-between sm:col-span-2">
            <span className="text-xs text-[var(--text-secondary)]">
              Auto-saves after edits.
            </span>
            <button
              className="text-xs font-medium text-[var(--accent-negative-text)] hover:underline"
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

// DOMAIN COLORS — DO NOT THEME-SWEEP THESE.
// Ability = deep blue, Prestige = yellow/amber, Other = neutral.
// The colors carry shift-TYPE meaning, not theme semantics. They live
// outside the design token system on purpose. If you want to retune
// them, change the hex values here directly. Do not swap to var(--accent-*).
function shiftBarClass(jobType: JobType): string {
  if (isAbilityShift(jobType) || jobType === "incentive") {
    return "border-[#1e3a8a] bg-[#1d4ed8] text-white";
  }

  if (jobType === "prestige" || jobType === "prestige_ilst") {
    return "border-[#d97706] bg-[#facc15] text-[#1f2937]";
  }

  return "border-[#d7dee8] bg-white text-[#0f172a]";
}

function shiftDotClass(jobType: JobType): string {
  if (isAbilityShift(jobType) || jobType === "incentive") {
    return "h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.22)]";
  }

  if (jobType === "prestige" || jobType === "prestige_ilst") {
    return "h-2.5 w-2.5 rounded-full bg-[#92400e] shadow-[0_0_0_3px_rgba(146,64,14,0.16)]";
  }

  return "h-2.5 w-2.5 rounded-full bg-[#0e7490] shadow-[0_0_0_3px_rgba(14,116,144,0.16)]";
}

function payTypeBadgeClass(payType: PayType | null | undefined): string {
  if (payType === "split") {
    return "rounded-full bg-[var(--text-primary)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--surface-base)]";
  }

  if (payType === "overtime") {
    return "rounded-full bg-[var(--accent-primary)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--text-primary)]";
  }

  return "rounded-full bg-[var(--text-primary)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--surface-base)]";
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
  const [showBaseBreakdown, setShowBaseBreakdown] = useState(false);
  const breakdown = day.baseBreakdown;
  const breakdownSumCents = breakdown.reduce(
    (sum, item) => sum + item.appliedCents,
    0,
  );
  // Tolerate sub-cent aggregate-vs-per-expense rounding (the day's base is an
  // aggregate round; the breakdown is a sum of per-expense rounds). A real gap
  // — e.g. a past day whose stamped baseline differs from today's expenses —
  // still surfaces.
  const reconciles = Math.abs(breakdownSumCents - baseCents) <= 2;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-2.5 text-sm">
        <TotalLine label="Earn" value={formatMoney(earningsCents)} />
        <TotalLine
          label="Spend"
          tone="negative"
          value={formatMoney(spendCents)}
        />
        <button
          aria-expanded={showBaseBreakdown}
          className="flex w-full items-center justify-between gap-3 py-1 text-left transition hover:opacity-80 disabled:cursor-default disabled:hover:opacity-100"
          disabled={breakdown.length === 0}
          onClick={() => setShowBaseBreakdown((open) => !open)}
          type="button"
        >
          <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
            Fixed
            {breakdown.length > 0 ? (
              <span
                className={`text-[10px] transition ${showBaseBreakdown ? "rotate-90" : ""}`}
              >
                ▸
              </span>
            ) : null}
          </span>
          <span className="font-semibold text-[var(--text-primary)] tabular-nums">
            {formatMoneyExact(baseCents)}
          </span>
        </button>
        {showBaseBreakdown && breakdown.length > 0 ? (
          <BaseBreakdown
            baseCents={baseCents}
            breakdown={breakdown}
            reconciles={reconciles}
            sumCents={breakdownSumCents}
          />
        ) : null}
        <div className="my-2 border-t border-[var(--border-default)]" />
        <TotalLine
          strong
          label="Cashflow"
          tone={cashflowDailyTone(displayCashflowCents)}
          value={formatCashflow(displayCashflowCents)}
        />
      </div>
    </div>
  );
}

function BaseBreakdown({
  breakdown,
  sumCents,
  baseCents,
  reconciles,
}: {
  breakdown: DashboardDay["baseBreakdown"];
  sumCents: number;
  baseCents: number;
  reconciles: boolean;
}) {
  return (
    <div className="mt-1 mb-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] p-2 text-xs">
      <ul className="space-y-1.5">
        {breakdown.map((item) => (
          <li
            key={`${item.itemKind}:${item.itemId}`}
            className="flex items-start justify-between gap-3"
          >
            <span className="min-w-0">
              <span className="block truncate text-[var(--text-primary)]">
                {item.itemName}
              </span>
              <span className="block text-[10px] text-[var(--text-tertiary)]">
                {item.itemKind === "amortized"
                  ? `${formatMoneyExact(item.originalAmountCents)} over ${item.periodDays}d → ${formatMoneyExact(item.dailyAllocCents)}/day`
                  : `${formatMoneyExact(item.originalAmountCents)}/mo → ${formatMoneyExact(item.dailyAllocCents)}/day`}
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-[var(--text-primary)]">
              {formatMoneyExact(item.appliedCents)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-[var(--border-default)] pt-1.5">
        <span
          className={
            reconciles
              ? "text-[10px] text-[var(--text-tertiary)]"
              : "text-[10px] font-semibold text-[var(--accent-warning)]"
          }
        >
          {reconciles
            ? "Sum matches Fixed ✓"
            : `Sum ${formatMoneyExact(sumCents)} ≠ Fixed ${formatMoneyExact(baseCents)}`}
        </span>
        <a
          className="text-[10px] font-semibold text-[var(--accent-primary)] hover:underline"
          href="/baseline"
        >
          Edit in Fixed →
        </a>
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
      <span className={strong ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>{label}</span>
      <span
        className={
          tone
            ? `font-semibold ${cashflowColorFromTone(tone)}`
            : strong
              ? "font-semibold text-[var(--text-primary)]"
              : "font-medium text-[var(--text-primary)]"
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
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        {label}
      </span>
      <select
        className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white"
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

// Job dropdown: built-in job types + the user's custom jobs (from context).
// Selecting a custom job stamps its rates/color onto the slot so the client
// calc + colored bar work immediately; switching back to a built-in clears them.
function JobPicker({
  slot,
  onSlotChange,
}: {
  slot: DashboardSlot;
  onSlotChange: (
    dayId: string,
    slotIndex: number,
    patch: Partial<DashboardSlot>,
  ) => void;
}) {
  const customJobs = useContext(CustomJobsContext);
  const value =
    slot.jobType === "custom" && slot.customJobId
      ? `custom:${slot.customJobId}`
      : slot.jobType;

  function handleChange(raw: string) {
    if (raw.startsWith("custom:")) {
      const jobId = raw.slice("custom:".length);
      const job = customJobs.find((current) => current.id === jobId);
      // job is undefined when re-selecting a deactivated job (not in the active
      // list) — keep the slot's already-stamped rate/color so pricing survives.
      onSlotChange(slot.dayId, slot.slotIndex, {
        jobType: "custom",
        customJobId: jobId,
        customRegularRateCents: job?.regularRateCents ?? slot.customRegularRateCents,
        customOvertimeRateCents: job?.otRateCents ?? slot.customOvertimeRateCents,
        customColor: job?.color ?? slot.customColor,
        customName: job?.name ?? slot.customName,
        payType:
          slot.payType === "split" || slot.payType === "overtime"
            ? slot.payType
            : "regular",
      });
    } else {
      onSlotChange(slot.dayId, slot.slotIndex, {
        jobType: raw as JobType,
        customJobId: null,
        customRegularRateCents: undefined,
        customOvertimeRateCents: undefined,
        customColor: undefined,
        customName: undefined,
      });
    }
  }

  return (
    <label className="space-y-1">
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        Job
      </span>
      <select
        className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white"
        onChange={(event) => handleChange(event.target.value)}
        value={value}
      >
        {/* If this slot points at a deactivated custom job (not in the active
            list), keep it selectable so the dropdown shows its name, not blank. */}
        {slot.jobType === "custom" &&
        slot.customJobId &&
        !customJobs.some((job) => job.id === slot.customJobId) ? (
          <option value={`custom:${slot.customJobId}`}>
            {`${slot.customName ?? "Custom"} (inactive)`}
          </option>
        ) : null}
        {JOB_OPTIONS.map((jobType) => (
          <option key={jobType} value={jobType}>
            {formatJobLabel(jobType)}
          </option>
        ))}
        {customJobs.length > 0 ? (
          <optgroup label="Custom jobs">
            {customJobs.map((job) => (
              <option key={job.id} value={`custom:${job.id}`}>
                {job.name}
              </option>
            ))}
          </optgroup>
        ) : null}
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
  const [draftValue, setDraftValue] = useState(() => formatNumberInput(value));
  const [isEditing, setIsEditing] = useState(false);
  const displayValue = isEditing ? draftValue : formatNumberInput(value);

  function updateDraft(nextValue: string) {
    setDraftValue(nextValue);
    if (nextValue.trim() === "") return;

    const parsed = Number(nextValue);
    if (Number.isFinite(parsed)) onChange?.(Math.max(0, parsed));
  }

  function commitDraft() {
    setIsEditing(false);
    const parsed = Number(draftValue);
    const nextValue = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setDraftValue(formatNumberInput(nextValue));
    onChange?.(nextValue);
  }

  return (
    <label className="space-y-1">
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        {label}
      </span>
      <input
        className="h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition read-only:bg-[var(--surface-elevated)] read-only:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white"
        inputMode="decimal"
        min="0"
        onBlur={commitDraft}
        onChange={(event) => updateDraft(event.target.value)}
        onFocus={() => {
          setDraftValue(formatNumberInput(value));
          setIsEditing(true);
        }}
        readOnly={readOnly}
        step="0.01"
        type="text"
        value={displayValue}
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
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        {label}
      </span>
      <input
        className="h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white"
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
          ? "rounded-full bg-[var(--accent-negative-fill)] px-3 py-1 text-xs font-medium text-[var(--accent-negative-text)]"
          : "rounded-full bg-[var(--surface-elevated)] px-3 py-1 text-xs font-medium text-[var(--text-primary)]"
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

function removeTransactionFromDay(
  day: DashboardDay,
  transactionId: string,
): DashboardDay {
  const removedAppliedTransaction = day.appliedTransactions.find(
    (transaction) => transaction.id === transactionId,
  );

  return {
    ...day,
    transactionSpendCents: removedAppliedTransaction
      ? day.transactionSpendCents - removedAppliedTransaction.amountCents
      : day.transactionSpendCents,
    appliedTransactions: day.appliedTransactions.filter(
      (transaction) => transaction.id !== transactionId,
    ),
    excludedTransactions: day.excludedTransactions.filter(
      (transaction) => transaction.id !== transactionId,
    ),
  };
}

function renameTransactionInDay(
  day: DashboardDay,
  transactionId: string,
  merchantName: string,
): DashboardDay {
  return {
    ...day,
    appliedTransactions: day.appliedTransactions.map((transaction) =>
      transaction.id === transactionId
        ? { ...transaction, merchantName }
        : transaction,
    ),
    excludedTransactions: day.excludedTransactions.map((transaction) =>
      transaction.id === transactionId
        ? { ...transaction, merchantName }
        : transaction,
    ),
  };
}

function moveTransactionToDay(
  days: DashboardDay[],
  transaction: DashboardTransaction,
  targetDay: DashboardDay,
): DashboardDay[] {
  const movedTransaction = {
    ...transaction,
    dayId: targetDay.id,
    date: targetDay.date,
  };

  return days.map((day) => {
    const dayWithoutTransaction = removeTransactionFromDay(day, transaction.id);

    if (day.id !== targetDay.id) {
      return dayWithoutTransaction;
    }

    if (transaction.status === "excluded") {
      return {
        ...dayWithoutTransaction,
        excludedTransactions: sortDashboardTransactions([
          ...dayWithoutTransaction.excludedTransactions,
          movedTransaction,
        ]),
      };
    }

    return {
      ...dayWithoutTransaction,
      transactionSpendCents:
        dayWithoutTransaction.transactionSpendCents +
        movedTransaction.amountCents,
      appliedTransactions: sortDashboardTransactions([
        ...dayWithoutTransaction.appliedTransactions,
        movedTransaction,
      ]),
    };
  });
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
    // Exclude synthetic bucket rows: their signed credit is added explicitly
    // (see sumBucketCreditCents) so it isn't clamped to >=0 by calculateEarnSlot.
    earnSlots: day.slots
      .filter((slot) => slot.kind !== "bucket")
      .map((slot) => ({
        jobType: slot.jobType,
        payType: slot.payType,
        hoursOrUnits: slot.hoursOrUnits,
        regularHours: slot.regularHours,
        overtimeHours: slot.overtimeHours,
        incentiveMode: slot.incentiveMode,
        incentiveRate: slot.incentiveRate,
        incentiveAmount: slot.incentiveAmount,
        label: slot.label,
        customRegularRateCents: slot.customRegularRateCents,
        customOvertimeRateCents: slot.customOvertimeRateCents,
      })),
    spendCents: day.spendCents + day.transactionSpendCents,
    baseCents: day.baseCents,
  };
}

// Sum of a day's Amortized Income daily credits (SIGNED cents). Added on top of
// calculateDayTotals so the displayed earnings/cashflow match the server view
// exactly (including negative-net buckets, which calculateEarnSlot would clamp).
function sumBucketCreditCents(day: DashboardDay): number {
  return day.slots.reduce(
    (sum, slot) =>
      slot.kind === "bucket" ? sum + (slot.creditCents ?? 0) : sum,
    0,
  );
}

// Apply the signed bucket credit to earnings + cashflow. Mirrors how the server
// v_day_totals adds the credit to earnings_total and cashflow_total only.
function withBucketCredit<T extends ReturnType<typeof calculateDayTotals>>(
  totals: T,
  creditCents: number,
): T {
  if (creditCents === 0) {
    return totals;
  }
  return {
    ...totals,
    earningsCents: totals.earningsCents + creditCents,
    cashflowCents: totals.cashflowCents + creditCents,
  };
}

function toComputedEarningSlots(days: DashboardDay[], settings: PaySettings) {
  return days.flatMap((day) =>
    day.slots.map((slot) => ({
      jobType: slot.jobType,
      computedEarningsCents: calculateEarnSlot(slot, settings).earningsCents,
    })),
  );
}

function normalizeSlotForClient(slot: DashboardSlot): DashboardSlot {
  if (slot.jobType === "none") {
    return {
      ...slot,
      payType: "none",
      hoursOrUnits: 0,
      regularHours: 0,
      overtimeHours: 0,
      incentiveMode: "none",
      incentiveRate: 0,
      incentiveAmount: 0,
      label: "",
      source: "user",
    };
  }

  if (slot.jobType === "incentive" || slot.jobType === "other") {
    return {
      ...slot,
      payType: "unit",
      hoursOrUnits: Math.max(0, slot.hoursOrUnits),
      regularHours: 0,
      overtimeHours: 0,
      incentiveMode: "none",
      incentiveRate: 0,
      incentiveAmount: 0,
      source: "user",
    };
  }

  const incentiveMode =
    isAbilityShift(slot.jobType)
      ? slot.incentiveMode === "lump_sum"
        ? "lump_sum"
        : "rate"
      : "none";

  if (slot.payType === "split") {
    const regularHours = Math.max(0, slot.regularHours);
    const overtimeHours = Math.max(0, slot.overtimeHours);

    return {
      ...slot,
      regularHours,
      overtimeHours,
      hoursOrUnits: regularHours + overtimeHours,
      incentiveMode,
      incentiveRate:
        incentiveMode === "rate" ? Math.max(0, slot.incentiveRate) : 0,
      incentiveAmount:
        incentiveMode === "lump_sum" ? Math.max(0, slot.incentiveAmount) : 0,
      source: "user",
    };
  }

  const hoursOrUnits = Math.max(0, slot.hoursOrUnits);

  return {
    ...slot,
    payType:
      slot.payType === "regular" || slot.payType === "overtime"
        ? slot.payType
        : "regular",
    hoursOrUnits,
    regularHours: slot.payType === "overtime" ? 0 : hoursOrUnits,
    overtimeHours: slot.payType === "overtime" ? hoursOrUnits : 0,
    incentiveMode,
    incentiveRate:
      incentiveMode === "rate" ? Math.max(0, slot.incentiveRate) : 0,
    incentiveAmount:
      incentiveMode === "lump_sum" ? Math.max(0, slot.incentiveAmount) : 0,
    source: "user",
  };
}

function normalizePayTypePatch(
  slot: DashboardSlot,
  payType: PayType,
): Partial<DashboardSlot> {
  if (payType === "split") {
    return {
      payType,
      hoursOrUnits: slot.hoursOrUnits,
      regularHours: slot.payType === "overtime" ? 0 : slot.hoursOrUnits,
      overtimeHours: slot.payType === "overtime" ? slot.hoursOrUnits : 0,
    };
  }

  if (payType === "regular" || payType === "overtime") {
    const hoursOrUnits =
      slot.payType === "split"
        ? slot.regularHours + slot.overtimeHours
        : slot.hoursOrUnits;

    return {
      payType,
      hoursOrUnits,
      regularHours: payType === "regular" ? hoursOrUnits : 0,
      overtimeHours: payType === "overtime" ? hoursOrUnits : 0,
    };
  }

  return {
    payType,
    hoursOrUnits: slot.hoursOrUnits,
    regularHours: 0,
    overtimeHours: 0,
  };
}

function isIncompleteSplitSlot(slot: DashboardSlot): boolean {
  return (
    slot.payType === "split" &&
    (slot.regularHours <= 0 || slot.overtimeHours <= 0)
  );
}

function makeEmptySlot(dayId: string, slotIndex: number): DashboardSlot {
  return {
    id: null,
    dayId,
    slotIndex,
    jobType: "none",
    payType: "none",
    hoursOrUnits: 0,
    regularHours: 0,
    overtimeHours: 0,
    incentiveMode: "none",
    incentiveRate: 0,
    incentiveAmount: 0,
    label: "",
    source: "user",
  };
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value.replace(/[$,]/g, "").trim());
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
  if (value === "ability_incentive") {
    return "Ability";
  }

  if (value === "prestige" || value === "prestige_ilst") {
    return "Prestige";
  }

  return capitalize(value);
}

function isAbilityShift(jobType: JobType): boolean {
  return jobType === "ability" || jobType === "ability_incentive";
}

function formatIncentiveModeLabel(value: string): string {
  if (value === "lump_sum") {
    return "Lump sum";
  }

  return "Rate";
}

function formatPlainHours(value: number): string {
  return value.toFixed(1);
}

function formatPayBadge(payType: PayType): string {
  if (payType === "overtime") {
    return "OT";
  }

  if (payType === "split") {
    return "Split";
  }

  return "Reg";
}

function formatPayOptionLabel(payType: string): string {
  if (payType === "split") {
    return "Split (Reg + OT)";
  }

  return capitalize(payType);
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

// Sign-aware, whole-dollar amount for a synthetic Amortized Income credit row.
// Bypasses calculateEarnSlot/formatShiftAmountValue, which blank out and clamp
// non-positive values — a negative daily slice must render as a real negative.
function formatBucketCreditAmount(creditCents: number): string {
  const magnitude = formatMoney(Math.abs(creditCents));
  return creditCents < 0 ? `-${magnitude}` : magnitude;
}

function formatShiftQuantityValue(slot: DashboardSlot): string {
  if (slot.payType === "unit") {
    return "";
  }

  if (slot.payType === "split") {
    return `${formatPlainHours(slot.hoursOrUnits)}h`;
  }

  return `${formatPlainHours(slot.hoursOrUnits)}h`;
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Format a transaction's timestamp for chronological display in the
// transaction row. Returns "—" when time is missing so the row layout
// stays consistent. Accepts ISO timestamps (Plaid datetime) and bare
// HH:MM/HH:MM:SS strings (manual entries).
function formatTransactionTime(time: string | null): string {
  const raw = time?.trim();
  if (!raw) return "—";

  // ISO timestamp path
  const isoMs = Date.parse(raw);
  if (Number.isFinite(isoMs)) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(isoMs));
  }

  // Bare HH:MM or HH:MM:SS (assume 24h)
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match) {
    const hour24 = Number(match[1]);
    const minute = match[2];
    const period = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return `${hour12}:${minute} ${period}`;
  }

  // 12-hour format already
  const twelve = raw.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (twelve) {
    return `${twelve[1]}:${twelve[2]} ${twelve[3].toUpperCase()}`;
  }

  return raw;
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

// Same rounding as formatMoney but no currency symbol — used in the mobile
// week-strip day squares where the $ caused number clipping.
function formatMoneyNoSymbol(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(centsToDollars(value)));
}

// Exact to-the-cent currency. Used for fixed-cost figures and the breakdown,
// where whole-dollar rounding would break the penny-level reconciliation.
function formatMoneyExact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centsToDollars(value));
}

function formatCentsForInput(value: number): string {
  return centsToDollars(Math.max(0, value)).toFixed(2);
}

// Cashflow shows an explicit sign: "+$40" when positive (matching the "-$10"
// that the currency formatter already produces for negatives). Zero stays "$0".
function formatCashflow(value: number): string {
  const base = formatMoney(value);
  return value > 0 ? `+${base}` : base;
}

function formatCashflowNoSymbol(value: number): string {
  const base = formatMoneyNoSymbol(value);
  return value > 0 ? `+${base}` : base;
}

function formatTransactionAmount(
  amountCents: number,
  variant: "spending" | "exempt",
): string {
  if (variant === "exempt" && amountCents < 0) {
    return `+${formatMoney(Math.abs(amountCents))}`;
  }

  return formatMoney(amountCents);
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

