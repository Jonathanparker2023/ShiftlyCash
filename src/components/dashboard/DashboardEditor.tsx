"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import type { CSSProperties, FormEvent } from "react";
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
  moveTransactionToTomorrowAction,
  refreshDashboardProjectionMaintenanceAction,
  renameTransactionAction,
  saveEarnSlotAction,
  snapshotClosedWeekAction,
  toggleTransactionStatusAction,
  type SaveEarnSlotInput,
} from "@/app/(protected)/actions";
import { syncTransactionsAction } from "@/app/(protected)/banking/actions";
import { WeekNetSummary } from "@/components/earnings/WeekNetSummary";
import { addDaysIso } from "@/lib/dashboard/dates";
import {
  sortDashboardTransactions,
  splitDashboardTransactionRows,
} from "@/lib/dashboard/transactions";
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
// Ability is retired — never offered for a NEW shift. An existing Ability slot
// still shows its value via the fallback <option> in JobPicker.
const JOB_OPTIONS: JobType[] = [
  "none",
  "prestige",
  "prestige_ilst",
  "other",
];
const PAY_OPTIONS: PayType[] = ["none", "regular", "overtime", "split", "unit"];
const INCENTIVE_MODE_OPTIONS: IncentiveMode[] = ["rate", "lump_sum"];
const AUTO_SYNC_STORAGE_KEY = "shiftly:lastAutoSyncAt";

export type NextPaycheck = {
  dueDateIso: string;
  netCents: number;
};

// Snapshot shown after a week closes — captured before the refresh swaps in the
// new active week.
type WeekRecap = {
  weekLabel: string;
  cashflowCents: number;
  spendCents: number;
  earningsCents: number;
  gasPerDayCents: number;
  greenLineCents: number | null;
};

type DashboardEditorProps = {
  initialData: DashboardData;
  // "historical" renders a closed week from History using the SAME UI as the
  // live dashboard (read-only until "Edit week" is turned on).
  mode?: "active" | "historical";
  // Upcoming paycheck (date + projected net) for the countdown card. Optional —
  // History doesn't pass it.
  nextPaycheck?: NextPaycheck | null;
};

type TimerMap = Record<string, ReturnType<typeof setTimeout>>;
type VersionMap = Record<string, number>;

const CustomJobsContext = createContext<DashboardCustomJob[]>([]);
// Built-in job keys the user "deleted" (hidden). Dropped from the job picker.
const HiddenBuiltinsContext = createContext<string[]>([]);
// False when viewing a closed week in History before "Edit week" is turned on —
// shift inputs render disabled (identical look, just not editable).
const ShiftsEditableContext = createContext<boolean>(true);

export function DashboardEditor({
  initialData,
  mode = "active",
  nextPaycheck = null,
}: DashboardEditorProps) {
  const customJobs = initialData.customJobs;
  const isHistorical = mode === "historical";
  const router = useRouter();
  const previousWeekHref = weekReferenceHref(initialData.weekNavigation.previous);
  const nextWeekHref = weekReferenceHref(initialData.weekNavigation.next);
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
  // A closed week opens ALREADY in edit mode so it behaves exactly like the
  // live dashboard. The recovery snapshot is taken best-effort on mount (see
  // the effect below) and never gates editing, so a snapshot hiccup can't lock
  // the week read-only.
  const [editingClosed, setEditingClosed] = useState(isHistorical);
  const [enablingEdit, setEnablingEdit] = useState(false);
  const shiftsEditable = !isHistorical || editingClosed;
  const timers = useRef<TimerMap>({});
  const versions = useRef<VersionMap>({});
  const lastSavedAt = useRef<number | null>(null);
  // Latest pending (debounced) slot save per key — so the History "Save & done"
  // button can flush them immediately instead of waiting on the debounce.
  const pendingSlotInputs = useRef<Map<string, SaveEarnSlotInput>>(new Map());
  const [finishingEdit, setFinishingEdit] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [recap, setRecap] = useState<WeekRecap | null>(null);
  const canCloseWeek = initialData.todayIso >= initialData.week.endDate;

  useEffect(() => {
    const scheduledTimers = timers.current;
    const pending = pendingSlotInputs.current;

    return () => {
      Object.values(scheduledTimers).forEach(clearTimeout);
      // Flush any debounced-but-unsaved slot edits so navigating away (Back to
      // History) before the 1.2s debounce fires doesn't silently drop them.
      for (const [, input] of pending) {
        saveEarnSlotAction(input).catch(() => {});
      }
      pending.clear();
    };
  }, []);

  // Also flush when the app is backgrounded/hidden (installed PWA), since an
  // unmount may not happen before the OS suspends the tab.
  useEffect(() => {
    const flush = () => {
      for (const [, input] of pendingSlotInputs.current) {
        saveEarnSlotAction(input).catch(() => {});
      }
      pendingSlotInputs.current.clear();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // After a refresh (e.g. Save & done), reconcile the grid to server truth so a
  // save that didn't actually persist visibly reverts instead of looking saved.
  // Historical only — the active dashboard keeps its optimistic-typing state.
  useEffect(() => {
    if (!isHistorical) {
      return;
    }
    // Deliberate server->client sync after a refresh (not a render-loop).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDays(initialData.days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData]);

  // Closed weeks open in edit mode (editingClosed initialized true above). Take
  // the recovery snapshot once, best-effort — its success never gates editing,
  // so a snapshot error can't strand the week read-only. Errors surface in the
  // save indicator but the week stays editable.
  useEffect(() => {
    if (!isHistorical) {
      return;
    }
    snapshotClosedWeekAction({ weekId: initialData.week.id }).catch(() => {
      // Non-fatal: the week is still editable; a snapshot retry happens on the
      // next open. Do not block or revert edit mode.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Projection maintenance is intentionally post-render. It clears projected
  // spend that has reached today and fills future-day projections without
  // blocking dashboard navigation.
  useEffect(() => {
    if (isHistorical) {
      return; // historical pages are read-only; never maintain/refresh here
    }
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
  }, [initialData.todayIso, router, isHistorical]);

  // Auto-sync Plaid transactions on first dashboard load (fire-and-forget).
  // Throttled by sessionStorage so it only runs once per browser session per
  // 5-minute window, avoiding API spam during navigation.
  useEffect(() => {
    if (isHistorical) {
      return; // never sync/refresh from a historical page
    }
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
  }, [router, isHistorical]);

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
  // How the week's Spend metric is built. Provably reconciles to
  // weekTotals.spendCents because that total IS manual + transactions (toDayInput
  // sums day.spendCents + day.transactionSpendCents). Categories are a sub-split
  // of the transactions component, with an "Other" remainder so they always add
  // back up to the server transaction total.
  const spendBreakdown = useMemo(() => buildSpendBreakdown(days), [days]);
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
    if (!shiftsEditable) return; // transactions follow the same edit gate as shifts
    if (pendingTransactionIds.has(transaction.id)) {
      return;
    }

    const previousDays = days;
    setTransactionError(null);
    setSaveState("saving");
    setPendingTransactionIds((current) => new Set(current).add(transaction.id));
    if (!transaction.isGasAllocated) {
      setDays((currentDays) =>
        currentDays.map((day) =>
          day.id === transaction.dayId
            ? moveTransactionBetweenBuckets(day, transaction, newStatus)
            : day,
        ),
      );
    }

    try {
      const result = await toggleTransactionStatusAction({
        transactionId: transaction.id,
        newStatus,
      });
      if (result.dashboardData) {
        setDays(result.dashboardData.days);
      }
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
    if (!shiftsEditable) return; // transactions follow the same edit gate as shifts
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
    if (!shiftsEditable) return; // transactions follow the same edit gate as shifts
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
        moveTransactionToDay(currentDays, transaction, targetDay, {
          wasMovedToYesterday: true,
        }),
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

  async function moveTransactionToTomorrow(transaction: DashboardTransaction) {
    if (!shiftsEditable) return; // transactions follow the same edit gate as shifts
    if (!transaction.wasMovedToYesterday) return; // only reverses a yesterday move
    if (pendingTransactionIds.has(transaction.id)) {
      return;
    }

    const previousDays = days;
    const tomorrowIso = addDaysIso(transaction.date, 1);
    const targetDay = days.find((day) => day.date === tomorrowIso);

    setTransactionError(null);
    setSaveState("saving");
    setPendingTransactionIds((current) => new Set(current).add(transaction.id));

    if (targetDay) {
      setDays((currentDays) =>
        moveTransactionToDay(currentDays, transaction, targetDay, {
          wasMovedToYesterday: false,
        }),
      );
    }

    try {
      await moveTransactionToTomorrowAction({ transactionId: transaction.id });
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
    if (!shiftsEditable) return; // transactions follow the same edit gate as shifts
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
    if (!shiftsEditable) return; // transactions follow the same edit gate as shifts
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
    if (!shiftsEditable) return; // transactions follow the same edit gate as shifts
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
      const result = await allocateGasTransactionAction({
        transactionId: transaction.id,
        gasAmountCents,
        previousFillDate,
      });
      setDays(result.dashboardData.days);
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
    if (!shiftsEditable) return; // transactions follow the same edit gate as shifts
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
      wasMovedToYesterday: false,
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
    if (!shiftsEditable) {
      return;
    }
    // Confirmation now happens at the Remove button (two-tap inline) — the old
    // window.confirm here was silently dead on the installed/mobile web app.
    clearSlot(slot);
    setExpandedSlotIndex(null);
    // Persist the removal NOW rather than on the 1.2s debounce — a fast "Back to
    // History" tap would otherwise cancel the pending write and the shift would
    // reappear. flushPendingSaves also covers any other queued edits.
    void flushPendingSaves().catch((error) => markError(error));
  }

  function addShift(day: DashboardDay) {
    if (day.spendLocked || !shiftsEditable) {
      return;
    }

    const emptySlot = day.slots.find((slot) => slot.jobType === "none");

    if (!emptySlot) {
      return;
    }

    setExpandedSlotIndex(emptySlot.slotIndex);
    updateSlot(day.id, emptySlot.slotIndex, {
      jobType: "prestige",
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

  // Turn on editing for a closed week: confirm, save a recovery snapshot, then
  // unlock the shift inputs. Never auto-enabled.
  async function enableClosedEdit() {
    if (editingClosed || enablingEdit) {
      return;
    }
    // No window.confirm here — it's suppressed in installed/mobile web app
    // contexts, which silently blocked editing. The action is deliberate
    // (open a closed week, tap Edit week), a recovery snapshot is saved first,
    // and the in-edit banner explains the forward-ripple.
    setEnablingEdit(true);
    setSaveError(null);
    try {
      await snapshotClosedWeekAction({ weekId: initialData.week.id });
      setEditingClosed(true);
    } catch (error) {
      // Surface loudly — a silent failure here reads as "Edit week does nothing".
      setSaveState("error");
      setSaveError(
        error instanceof Error ? error.message : "Unable to start editing.",
      );
    } finally {
      setEnablingEdit(false);
    }
  }

  function scheduleSlotSave(slot: DashboardSlot) {
    // Synthetic Amortized Income rows are derived, never persisted as earn_slots.
    if (slot.kind === "bucket") {
      return;
    }
    // Read-only history: never write (server also rejects without allowClosedEdit).
    if (!shiftsEditable) {
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
      allowClosedEdit: isHistorical,
    };

    pendingSlotInputs.current.set(key, input);
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(async () => {
      setSaveState("saving");
      setSaveError(null);

      try {
        await saveEarnSlotAction(input);
        pendingSlotInputs.current.delete(key);
        // Skip reconcile: local optimistic state is the source of truth while
        // typing. Reconciling here can clobber characters typed between the
        // debounce firing and the network round-trip completing.
        markSaved(key, version);
      } catch (error) {
        markError(error);
      }
    }, 1200);
  }

  // Flush every pending debounced slot save right now (used by the History
  // "Save & done" button so nothing is lost to the 1.2s debounce).
  async function flushPendingSaves() {
    const entries = Array.from(pendingSlotInputs.current.entries());
    for (const [key] of entries) {
      clearTimeout(timers.current[key]);
    }
    // Attempt every save; delete only those that succeed so failures stay
    // pending + retryable instead of one throw dropping the whole batch.
    const results = await Promise.allSettled(
      entries.map(([key, input]) =>
        saveEarnSlotAction(input).then(() => {
          pendingSlotInputs.current.delete(key);
        }),
      ),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      throw new Error(
        `${failed} edit${failed > 1 ? "s" : ""} didn't save — still editing.`,
      );
    }
  }

  // Finish a History edit session: flush saves, refresh from the server, and
  // drop back to read-only.
  async function finishClosedEdit() {
    if (finishingEdit) {
      return;
    }
    setFinishingEdit(true);
    setSaveState("saving");
    setSaveError(null);
    try {
      await flushPendingSaves();
      setSaveState("saved");
      setEditingClosed(false);
      router.refresh();
    } catch (error) {
      markError(error);
    } finally {
      setFinishingEdit(false);
    }
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

    // Two-tap inline confirm instead of window.confirm (suppressed on installed
    // / mobile web apps). First tap arms; second tap within 5s closes.
    if (!confirmingClose) {
      setConfirmingClose(true);
      window.setTimeout(() => setConfirmingClose(false), 5000);
      return;
    }
    setConfirmingClose(false);

    setIsClosing(true);
    setCloseError(null);
    setCloseToast(null);

    try {
      await closeWeekAction({ weekId: initialData.week.id });
      setCloseToast("Week closed.");
      // Snapshot the just-closed week for the recap BEFORE refresh swaps in the
      // new active week. The weekly target comes from this device's stored value.
      const storedLine = window.localStorage.getItem(GREEN_LINE_KEY);
      const greenLineCents =
        storedLine != null && Number.isFinite(Number(storedLine)) && Number(storedLine) > 0
          ? Number(storedLine)
          : DEFAULT_GREEN_LINE_CENTS;
      const gasPerDayCents = days.some((day) => day.gasSpendCents > 0)
        ? initialData.gasAverageDailyCents
        : 0;
      setRecap({
        weekLabel: `Week of ${formatShortDate(initialData.week.startDate)}`,
        cashflowCents: weekTotals.cashflowCents,
        spendCents: weekTotals.spendCents,
        earningsCents: weekTotals.earningsCents,
        gasPerDayCents,
        greenLineCents,
      });
      router.refresh();
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : "Unable to close week.");
    } finally {
      setIsClosing(false);
    }
  }

  return (
    <CustomJobsContext.Provider value={customJobs}>
    <HiddenBuiltinsContext.Provider value={initialData.hiddenBuiltins}>
    <ShiftsEditableContext.Provider value={shiftsEditable}>
    {recap ? (
      <WeekRecapModal recap={recap} onClose={() => setRecap(null)} />
    ) : null}
    <div
      className={
        isHistorical
          ? "min-h-screen bg-[var(--surface-hover)] px-3 py-4 text-[var(--text-primary)] ring-1 ring-inset ring-amber-300/20 sm:px-4 lg:px-6"
          : "min-h-screen bg-[var(--surface-base)] px-3 py-4 text-[var(--text-primary)] sm:px-4 lg:px-6"
      }
    >
      {isHistorical && editingClosed ? (
        <div className="mx-auto mb-5 max-w-7xl rounded-md border border-amber-300/40 bg-amber-400/15 p-3 text-sm font-medium text-amber-100">
          Editing closed Week {initialData.week.displayWeekNumber}. Changes save
          automatically and recompute this week plus the running balance for
          every later week — no earlier week changes. A recovery snapshot was
          saved first. Tap &ldquo;Save &amp; done&rdquo; when finished.
        </div>
      ) : null}
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
          <div className="p-3 sm:p-4">
          <div className="mb-5 space-y-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="flex items-start gap-2 sm:gap-3">
                <WeekArrowButton
                  direction="previous"
                  href={previousWeekHref}
                  onNavigate={(href) => router.push(href)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:gap-x-8">
                    <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-2xl">
                      Week {initialData.week.displayWeekNumber}
                    </h1>
                    <p className="text-xl font-semibold tracking-tight text-[var(--accent-brand-text)] sm:text-2xl">
                      {formatFullRange(initialData.week.startDate, initialData.week.endDate)}
                    </p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                      {initialData.week.payPeriodRole === "week_1"
                        ? "Week 1 of pay period"
                        : "Week 2 of pay period"}
                    </p>
                    {!isHistorical && saveState === "error" ? (
                      <SaveIndicator state={saveState} error={saveError} />
                    ) : null}
                  </div>
                  {isHistorical ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-full border border-amber-300/40 bg-amber-400/15 px-2 py-1 text-xs font-semibold text-amber-100 shadow-sm">
                        Closed week{editingClosed ? " - editing" : " - read only"}
                      </span>
                      {editingClosed ? (
                        <button
                          className="inline-flex rounded-full border border-[var(--accent-primary-border)] bg-[var(--accent-primary)] px-3 py-1 text-xs font-bold text-[var(--surface-base)] shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70"
                          disabled={finishingEdit}
                          onClick={finishClosedEdit}
                          type="button"
                        >
                          {finishingEdit ? "Saving..." : "Save & done"}
                        </button>
                      ) : (
                        <button
                          className="inline-flex rounded-full border border-[var(--accent-primary-border)] bg-[var(--accent-primary)] px-3 py-1 text-xs font-bold text-[var(--surface-base)] shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70"
                          disabled={enablingEdit}
                          onClick={enableClosedEdit}
                          type="button"
                        >
                          {enablingEdit ? "Saving snapshot..." : "Edit week"}
                        </button>
                      )}
                      {saveState !== "idle" ? (
                        <SaveIndicator state={saveState} error={saveError} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <WeekArrowButton
                  direction="next"
                  href={nextWeekHref}
                  onNavigate={(href) => router.push(href)}
                />
              </div>

              <div className="min-w-0 text-right lg:pb-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  Running balance
                </p>
                <p
                  className={`mt-0.5 text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl ${
                    initialData.week.runningBalanceCents < 0
                      ? "text-[var(--accent-negative-text)]"
                      : "text-[var(--text-primary)]"
                  }`}
                >
                  {formatMoney(initialData.week.runningBalanceCents)}
                </p>
              </div>
            </div>
            <MetricStrip
              cashflowCents={weekTotals.cashflowCents}
              earningsCents={weekTotals.earningsCents}
              medians={initialData.metricMedians}
              spendBreakdown={spendBreakdown}
              spendCents={weekTotals.spendCents}
            />
          </div>

          {!isHistorical && nextPaycheck ? (
            <NextPaycheckCard
              nextPaycheck={nextPaycheck}
              todayIso={initialData.todayIso}
            />
          ) : null}

          {!isHistorical ? (
            <GreenLineBar cashflowCents={weekTotals.cashflowCents} />
          ) : null}

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
              avgDailyFixedCents={Math.round(weekTotals.baseCents / 100 / 7) * 100}
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
              onMoveTransactionToTomorrow={moveTransactionToTomorrow}
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
            {(() => {
              const wage = buildWageJobHours(days);
              return (
                <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 shadow-sm backdrop-blur-md">
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {wage.jobs.map((job) => (
                      <StatLine
                        color={job.color}
                        key={job.key}
                        label={job.label}
                        value={formatHours(job.hours)}
                      />
                    ))}
                    <StatLine label="Total" value={formatHours(wage.total)} />
                  </div>
                </div>
              );
            })()}
            <WeekNetSummary
              abilityNetCents={weekNetTotals.abilityNetCents}
              customNets={customNets}
              hiddenBuiltins={initialData.hiddenBuiltins}
              prestigeNetCents={weekNetTotals.prestigeNetCents}
            />
            {isHistorical ? null : (
              <button
                className={`h-10 w-full rounded-md px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:shadow-none sm:w-auto ${
                  confirmingClose
                    ? "bg-amber-500/90 text-white hover:bg-amber-500"
                    : "bg-[var(--surface-base)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:bg-[var(--surface-hover)]"
                }`}
                disabled={!canCloseWeek || isClosing}
                onClick={closeWeek}
                title={canCloseWeek ? "Close this week" : "Available after Saturday"}
                type="button"
              >
                {isClosing
                  ? "Closing..."
                  : confirmingClose
                    ? "Tap again to close week"
                    : "Close week"}
              </button>
            )}
          </div>
          </div>
        </section>
      </main>
    </div>
    </ShiftsEditableContext.Provider>
    </HiddenBuiltinsContext.Provider>
    </CustomJobsContext.Provider>
  );
}

function MetricStrip({
  earningsCents,
  spendCents,
  cashflowCents,
  medians,
  spendBreakdown,
}: {
  earningsCents: number;
  spendCents: number;
  cashflowCents: number;
  medians: DashboardData["metricMedians"];
  spendBreakdown: SpendBreakdown;
}) {
  const [spendOpen, setSpendOpen] = useState(false);
  const displayCashflowCents = roundCashflowToNearestFiveDollars(cashflowCents);
  const cashflowTone = cashflowWeeklyTone(displayCashflowCents);
  const spendTone = spendWeeklyTone(spendCents, medians.spendCents);
  const earningsTone = earningsWeeklyTone(earningsCents, medians.earningsCents);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        <TopMetric
          accent={earningsTone}
          label="Earn"
          tone={earningsTone}
          trend={buildMedianTrend(earningsCents, medians.earningsCents, "higher")}
          value={formatMoney(earningsCents)}
        />
        <TopMetric
          accent={spendTone}
          expandable
          expanded={spendOpen}
          label="Spend"
          onClick={() => setSpendOpen((open) => !open)}
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
      {spendOpen ? (
        <SpendBreakdownPanel breakdown={spendBreakdown} totalCents={spendCents} />
      ) : null}
    </div>
  );
}

// Read-only breakdown of how the week's Spend metric is computed. Reconciles to
// the cent: categories + Other = transactions, and transactions + manual = Spend.
function SpendBreakdownPanel({
  breakdown,
  totalCents,
}: {
  breakdown: SpendBreakdown;
  totalCents: number;
}) {
  const rows: {
    key: string;
    label: string;
    cents: number;
    muted?: boolean;
    gas?: boolean;
  }[] = [
    ...breakdown.categories.map((category) => ({
      key: category.key,
      label: category.label,
      cents: category.cents,
    })),
  ];
  if (breakdown.gasCents !== 0) {
    rows.push({
      key: "__gas",
      label: "Incl. Gas",
      cents: breakdown.gasCents,
      gas: true,
    });
  }
  if (breakdown.otherCents !== 0) {
    rows.push({
      key: "__other",
      label: "Other transactions",
      cents: breakdown.otherCents,
    });
  }
  if (breakdown.manualCents !== 0) {
    rows.push({
      key: "__manual",
      label: "Manual daily spend",
      cents: breakdown.manualCents,
      muted: true,
    });
  }

  return (
    <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-3 text-sm text-[var(--text-primary)] shadow-sm">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Spend formula · this week
        </span>
        <span className="text-[11px] font-medium text-[var(--text-tertiary)]">
          transactions + manual
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="py-1 text-[var(--text-tertiary)]">
          No spend recorded this week yet.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border-default)]">
          {rows.map((row) => (
            <li
              className="flex items-center justify-between py-1.5"
              key={row.key}
            >
              <span
                className={
                  row.gas
                    ? "font-medium text-sky-500"
                    : row.muted
                      ? "text-[var(--text-secondary)]"
                      : "text-[var(--text-primary)]"
                }
              >
                {row.label}
              </span>
              <span
                className={`font-medium tabular-nums ${row.gas ? "text-sky-500" : ""}`}
              >
                {formatMoney(row.cents)}
                {totalCents > 0 ? (
                  <span className="ml-2 text-[11px] text-[var(--text-tertiary)]">
                    {Math.round((row.cents / totalCents) * 100)}%
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex items-center justify-between border-t-2 border-[var(--border-strong)] pt-2">
        <span className="font-semibold">Spend</span>
        <span className="font-bold tabular-nums">{formatMoney(totalCents)}</span>
      </div>
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
  onClick,
  expandable = false,
  expanded = false,
}: {
  label: string;
  value: string;
  tone?: "positive" | "amber" | "negative";
  accent?: "green" | "blue" | "positive" | "amber" | "negative";
  trend?: MedianTrend | null;
  className?: string;
  dark?: boolean;
  onClick?: () => void;
  expandable?: boolean;
  expanded?: boolean;
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
        ? "before:bg-[var(--accent-primary)]"
        : "before:bg-[var(--border-strong)]";

  const wrapperClass = dark
    ? `rounded-md bg-[var(--surface-base)] px-2.5 py-3 text-[var(--text-primary)] sm:px-4 ${className}`
    : `relative overflow-hidden rounded-md border-2 border-[var(--border-strong)] bg-[var(--surface-elevated)] px-2.5 py-3 text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_24px_rgba(8,15,28,0.12)] before:absolute before:inset-x-0 before:top-0 before:h-1 sm:px-4 ${accentClass} ${className}`;
  const valueClass = dark
    ? "mt-1 text-base font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl lg:text-3xl"
    : tone
      ? `mt-1 text-base font-bold tracking-tight sm:text-2xl lg:text-3xl ${cashflowColorFromTone(tone)}`
      : "mt-1 text-base font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl lg:text-3xl";

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)] sm:text-[10px] sm:tracking-[0.18em]">
          {label}
          {expandable ? (
            <svg
              aria-hidden="true"
              className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          ) : null}
        </div>
        {trend ? (
          <div
            className={`shrink-0 whitespace-nowrap pr-px text-right text-[8px] font-bold uppercase leading-none tracking-[0.02em] sm:text-[9px] md:text-[10px] md:tracking-[0.08em] ${cashflowColorFromTone(
              tone ?? trend.tone,
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
      <div className={valueClass}>{value}</div>
    </>
  );

  if (onClick) {
    return (
      <button
        aria-expanded={expandable ? expanded : undefined}
        className={`${wrapperClass} cursor-pointer text-left transition hover:brightness-[1.04] active:brightness-95`}
        onClick={onClick}
        type="button"
      >
        {inner}
      </button>
    );
  }

  return <div className={wrapperClass}>{inner}</div>;
}

function weekReferenceHref(
  reference: DashboardData["weekNavigation"]["previous"],
): string | null {
  if (!reference) {
    return null;
  }
  return reference.status === "active" ? "/" : `/history/${reference.id}`;
}

function WeekArrowButton({
  direction,
  href,
  onNavigate,
}: {
  direction: "previous" | "next";
  href: string | null;
  onNavigate: (href: string) => void;
}) {
  const label = direction === "previous" ? "Previous week" : "Next week";
  return (
    <button
      aria-label={label}
      className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] text-[var(--text-primary)] transition hover:border-[var(--accent-primary-border)] hover:text-[var(--accent-primary-text)] disabled:cursor-not-allowed disabled:opacity-30"
      disabled={!href}
      onClick={() => {
        if (href) onNavigate(href);
      }}
      title={label}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        {direction === "previous" ? (
          <>
            <path d="m15 18-6-6 6-6" />
            <path d="M9 12h10" />
          </>
        ) : (
          <>
            <path d="m9 18 6-6-6-6" />
            <path d="M5 12h10" />
          </>
        )}
      </svg>
    </button>
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
  // Today's column is marked with a subtle lighter/grayish surface tint instead
  // of a "Today" badge (lighter than the cell in dark mode, soft gray on white).
  const surfaceBg = isToday
    ? "bg-[var(--surface-hover)]"
    : "bg-[var(--surface-elevated)]";
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
          ? `min-w-0 rounded-md border-[3px] ${toneBorderFocused} ${surfaceBg} px-1.5 py-2 text-left ${toneGlowFocused} transition-colors duration-150 focus:outline-none sm:p-3`
          : day.spendLocked
            ? `min-w-0 rounded-md border-2 ${toneBorder} ${surfaceBg} px-1.5 py-2 text-left opacity-75 ${toneGlow} transition focus:outline-none sm:p-3`
            : `min-w-0 rounded-md border-2 ${toneBorder} ${surfaceBg} px-1.5 py-2 text-left ${toneGlow} transition focus:outline-none sm:p-3`
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
  avgDailyFixedCents,
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
  onMoveTransactionToTomorrow,
  onRenameTransaction,
  onAmortizeTransaction,
  onAllocateGasTransaction,
  onAddShift,
  onRemoveSlot,
  onReorderSlots,
}: {
  day: DashboardDay;
  totals: ReturnType<typeof calculateDayTotals> | undefined;
  avgDailyFixedCents: number;
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
  onMoveTransactionToTomorrow: (transaction: DashboardTransaction) => void;
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
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(190px,0.45fr)_minmax(430px,1.3fr)]">
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
        <TotalsPanel avgDailyFixedCents={avgDailyFixedCents} day={day} totals={totals} />
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
          onMoveTransactionToTomorrow={onMoveTransactionToTomorrow}
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
  onMoveTransactionToTomorrow,
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
  onMoveTransactionToTomorrow: (transaction: DashboardTransaction) => void;
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
  // A gas-station source transaction is one database row, but it has two clear
  // display roles: the gas portion is a blue exemption and any non-gas
  // remainder is ordinary spending. The daily gas overlay remains in SPENDING.
  const { spendingTransactions, exemptTransactions } =
    splitDashboardTransactionRows(
      day.appliedTransactions,
      day.excludedTransactions,
    );

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

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <TransactionColumn
          heading="SPENDING"
          gasSpendCents={day.gasSpendCents}
          pendingTransactionIds={pendingTransactionIds}
          transactions={spendingTransactions}
          variant="spending"
          onDelete={onDeleteTransaction}
          onMoveToYesterday={onMoveTransactionToYesterday}
          onMoveToTomorrow={onMoveTransactionToTomorrow}
          onRename={onRenameTransaction}
          onAllocateGas={onAllocateGasTransaction}
          onAmortize={onAmortizeTransaction}
          onToggle={(transaction) =>
            onToggleTransactionStatus(transaction, "excluded")
          }
        />
        <TransactionColumn
          collapsible
          heading="EXEMPT"
          pendingTransactionIds={pendingTransactionIds}
          transactions={exemptTransactions}
          variant="exempt"
          onDelete={onDeleteTransaction}
          onMoveToYesterday={onMoveTransactionToYesterday}
          onMoveToTomorrow={onMoveTransactionToTomorrow}
          onRename={onRenameTransaction}
          onAllocateGas={onAllocateGasTransaction}
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
  onMoveToTomorrow,
  onRename,
  onToggle,
  onAllocateGas,
  onAmortize,
  gasSpendCents,
  collapsible,
}: {
  heading: string;
  pendingTransactionIds: Set<string>;
  transactions: DashboardTransaction[];
  variant: "spending" | "exempt";
  onDelete: (transaction: DashboardTransaction) => void;
  onMoveToYesterday: (transaction: DashboardTransaction) => void;
  onMoveToTomorrow: (transaction: DashboardTransaction) => void;
  onRename: (transaction: DashboardTransaction, merchantName: string) => void;
  onToggle: (transaction: DashboardTransaction) => void;
  onAllocateGas?: (
    transaction: DashboardTransaction,
    gasAmountCents: number,
    previousFillDate: string | null,
  ) => void;
  onAmortize?: (transaction: DashboardTransaction, months: 1 | 3) => void;
  gasSpendCents?: number;
  // Collapsed by default -- a header you tap to reveal the list, so a column
  // you rarely need to look at doesn't sit open in your field of view.
  collapsible?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(!collapsible);
  const showGasRow =
    variant === "spending" && !!gasSpendCents && gasSpendCents > 0;
  const count = transactions.length + (showGasRow ? 1 : 0);
  return (
    <div className="min-h-0 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
      {collapsible ? (
        <button
          className="flex w-full items-center justify-between"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <span className="flex items-center gap-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              {heading}
            </h3>
            <svg
              className={`h-3 w-3 text-[var(--text-tertiary)] transition-transform ${isOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-xs font-semibold text-[var(--text-primary)]">
            {count}
          </span>
        </button>
      ) : (
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            {heading}
          </h3>
          <span className="rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-xs font-semibold text-[var(--text-primary)]">
            {count}
          </span>
        </div>
      )}

      {isOpen ? (
      <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
        {showGasRow ? (
          <div
            className="flex items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2"
            title="Today's exact gas share in the spending ledger."
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-sky-500">
                Gas
              </div>
              <div className="text-[11px] text-[var(--text-tertiary)]">
                Today&apos;s gas share
              </div>
            </div>
            <div className="shrink-0 text-sm font-semibold tabular-nums text-sky-500">
              {formatMoney(gasSpendCents ?? 0)}
            </div>
          </div>
        ) : null}
        {transactions.map((transaction) => (
          <TransactionRowButton
            key={transaction.id}
            transaction={transaction}
            disabled={pendingTransactionIds.has(transaction.id)}
            variant={variant}
            onDelete={onDelete}
            onMoveToYesterday={onMoveToYesterday}
            onMoveToTomorrow={onMoveToTomorrow}
            onRename={onRename}
            onToggle={onToggle}
            onAllocateGas={onAllocateGas}
            onAmortize={onAmortize}
          />
        ))}
      </div>
      ) : null}
    </div>
  );
}

function WeekRecapModal({
  recap,
  onClose,
}: {
  recap: WeekRecap;
  onClose: () => void;
}) {
  const cleared =
    recap.greenLineCents !== null &&
    recap.cashflowCents >= recap.greenLineCents;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Week wrapped
        </p>
        <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
          {recap.weekLabel}
        </h2>
        {recap.greenLineCents !== null ? (
          <p
            className={`mt-2 text-sm font-semibold ${cleared ? "text-emerald-500" : "text-amber-500"}`}
          >
            {cleared
              ? `Cleared your target by ${formatMoney(recap.cashflowCents - recap.greenLineCents)}`
              : `${formatMoney(recap.greenLineCents - recap.cashflowCents)} under target`}
          </p>
        ) : (
          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
            Cashflow {formatMoney(recap.cashflowCents)}
          </p>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <RecapStat label="Earned" value={formatMoney(recap.earningsCents)} />
          <RecapStat label="Spent" value={formatMoney(recap.spendCents)} />
          <RecapStat label="Cashflow" value={formatMoney(recap.cashflowCents)} />
        </div>
        {recap.gasPerDayCents > 0 ? (
          <p className="mt-3 text-xs text-[var(--text-tertiary)]">
            Gas ran {formatMoney(recap.gasPerDayCents)}/day this week.
          </p>
        ) : null}
        <button
          className="mt-5 h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-hover)] text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)]"
          onClick={onClose}
          type="button"
        >
          Nice
        </button>
      </div>
    </div>
  );
}

function RecapStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-base)] px-2 py-2 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

const GREEN_LINE_KEY = "bashflow.greenLineCents";
// Default weekly cashflow target ($900 — the locked plan rule). The bar shows
// with this by default; tap it to change (stored per-device).
const DEFAULT_GREEN_LINE_CENTS = 90_000;

// Your personal weekly cashflow target. Defaults to $900 and always shows the
// bar — it fills green when the week clears the target,
// amber when it hasn't. Device-local for now (no server round-trip).
function GreenLineBar({ cashflowCents }: { cashflowCents: number }) {
  const [greenLineCents, setGreenLineCents] = useState<number>(
    DEFAULT_GREEN_LINE_CENTS,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(GREEN_LINE_KEY);
    if (stored != null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed) && parsed > 0) {
        setGreenLineCents(parsed);
      }
    }
  }, []);

  function saveLine() {
    const dollars = parsePositiveNumber(draft);
    if (dollars <= 0) {
      return;
    }
    const cents = Math.round(dollars * 100);
    setGreenLineCents(cents);
    window.localStorage.setItem(GREEN_LINE_KEY, String(cents));
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 shadow-sm">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Weekly target
        </span>
        <span className="text-xs text-[var(--text-tertiary)]">$</span>
        <input
          className="h-8 w-24 rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] px-2 text-sm font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
          inputMode="decimal"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              saveLine();
            }
          }}
          placeholder="900"
          value={draft}
        />
        <button
          className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={parsePositiveNumber(draft) <= 0}
          onClick={saveLine}
          type="button"
        >
          Set
        </button>
        <button
          className="h-8 rounded-md px-2 text-xs font-semibold text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]"
          onClick={() => setEditing(false)}
          type="button"
        >
          Cancel
        </button>
      </div>
    );
  }

  const cleared = cashflowCents >= greenLineCents;
  const pct =
    greenLineCents > 0
      ? Math.max(0, Math.min(1, cashflowCents / greenLineCents))
      : 0;

  return (
    <button
      className="mb-3 block w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-left shadow-sm transition hover:border-[var(--border-strong)]"
      onClick={() => {
        setDraft(formatCentsForInput(greenLineCents));
        setEditing(true);
      }}
      title="Tap to change your weekly target"
      type="button"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Weekly target
        </span>
        <span className="text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
          {formatMoney(cashflowCents)} / {formatMoney(greenLineCents)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-base)]">
        <div
          className={`h-full rounded-full ${cleared ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {cleared ? (
          <span className="text-emerald-500">
            Cleared by {formatMoney(cashflowCents - greenLineCents)}
          </span>
        ) : (
          <span className="text-amber-500">
            {formatMoney(greenLineCents - cashflowCents)} to go
          </span>
        )}
      </div>
    </button>
  );
}

function NextPaycheckCard({
  nextPaycheck,
  todayIso,
}: {
  nextPaycheck: NextPaycheck;
  todayIso: string;
}) {
  const days = daysBetweenIso(todayIso, nextPaycheck.dueDateIso);
  const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Next check
        </span>
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {formatShortDate(nextPaycheck.dueDateIso)}
        </span>
        <span className="text-xs font-medium text-[var(--text-tertiary)]">
          {when}
        </span>
      </div>
      <span className="shrink-0 text-base font-semibold tabular-nums text-emerald-500">
        ~{formatMoney(nextPaycheck.netCents)}
      </span>
    </div>
  );
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function TransactionRowButton({
  transaction,
  disabled,
  variant,
  onDelete,
  onMoveToYesterday,
  onMoveToTomorrow,
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
  onMoveToTomorrow: (transaction: DashboardTransaction) => void;
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isGasEditing, setIsGasEditing] = useState(false);
  const [gasAmountValue, setGasAmountValue] = useState(
    formatCentsForInput(
      transaction.isGasAllocated
        ? transaction.gasAllocatedCents
        : transaction.originalAmountCents,
    ),
  );
  const isAmortizedExempt = variant === "exempt" && transaction.isAmortized;
  const isGasExempt = variant === "exempt" && transaction.isGasAllocated;
  const rowStyle =
    isAmortizedExempt || isGasExempt
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
    // Previous fill date is always auto-derived server-side (last gas
    // allocation -> last gas-pattern transaction -> day before).
    onAllocateGas?.(transaction, gasAmountCents, null);
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
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={
                isAmortizedExempt
                  ? "truncate font-semibold text-sky-200 line-through"
                  : isGasExempt
                    ? "truncate font-semibold text-sky-200"
                  : variant === "exempt"
                  ? "truncate font-semibold text-[var(--text-muted)] line-through"
                  : "truncate font-semibold text-[var(--text-primary)]"
              }
            >
              {transaction.merchantName}
            </span>
            {isGasExempt ? (
              <span className="shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-500">
                Gas
              </span>
            ) : null}
          </span>
          <span
            className={
              variant === "exempt"
                ? "block text-[10px] font-semibold text-[var(--text-tertiary)]"
                : "block text-[10px] font-semibold text-[var(--text-tertiary)]"
            }
          >
            {formatTransactionTime(transaction.time)}
          </span>
        </span>
        <span
          className={
            isAmortizedExempt
              ? "font-semibold text-sky-200 line-through"
              : isGasExempt
                ? "font-semibold text-sky-200"
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
          {isGasExempt ? (
            <div className="mb-2 rounded-md border border-sky-400/40 bg-sky-500/15 px-2 py-1 text-[10px] font-semibold text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.25)]">
              Gas {formatMoneyExact(transaction.gasAllocatedCents)} averaged across
              your gas history as daily spend; {formatMoneyExact(transaction.gasRemainderCents)} remains ordinary spending.
            </div>
          ) : null}
          {isGasEditing ? (
            <form
              className="mb-2 grid gap-2 rounded-md border border-sky-400/40 bg-sky-500/15 p-2 sm:grid-cols-[1fr_auto]"
              onSubmit={submitGasAllocation}
            >
              <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-200">
                Gas $
                <input
                  className="mt-1 block h-8 w-full rounded-md border border-sky-400/40 bg-[var(--surface-base)] px-2 text-xs font-semibold text-[var(--text-primary)] outline-none focus:border-sky-300"
                  disabled={disabled}
                  inputMode="decimal"
                  onChange={(event) => setGasAmountValue(event.target.value)}
                  value={gasAmountValue}
                />
              </label>
              <div className="flex items-end gap-2">
                <button
                  className="h-8 rounded-md border border-sky-400/40 bg-[var(--surface-base)] px-2.5 text-xs font-semibold text-[var(--text-primary)] transition hover:border-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={disabled || parsePositiveNumber(gasAmountValue) <= 0}
                  type="submit"
                >
                  Save
                </button>
                <button
                  className="h-8 rounded-md px-2.5 text-xs font-semibold text-sky-200 transition hover:text-[var(--text-primary)]"
                  onClick={() => setIsGasEditing(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[10px] text-sky-200 sm:col-span-2">
                Averages across every day since your first fill — your true daily gas cost.
              </p>
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
            {isGasExempt ? "Remove gas" : variant === "exempt" ? "Include" : "Exempt"}
          </button>
          <button
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={() => onMoveToYesterday(transaction)}
            type="button"
          >
            Move to yesterday
          </button>
          {transaction.wasMovedToYesterday ? (
            <button
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onClick={() => onMoveToTomorrow(transaction)}
              type="button"
            >
              Move to tomorrow
            </button>
          ) : null}
          {onAllocateGas &&
          ((variant === "spending" && !transaction.isGasAllocated) ||
            isGasExempt) ? (
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
              {isGasExempt ? "Edit gas" : "Gas"}
            </button>
          ) : null}
          {variant === "spending" &&
          onAmortize &&
          !transaction.isGasAllocated ? (
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
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              confirmingDelete
                ? "border-red-400 bg-red-500/90 text-white hover:bg-red-500"
                : "border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] text-[var(--accent-negative-text)] hover:bg-[var(--surface-hover)]"
            }`}
            disabled={disabled}
            onClick={() => {
              // Two-tap inline confirm (window.confirm is dead on installed apps).
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                window.setTimeout(() => setConfirmingDelete(false), 4000);
                return;
              }
              setConfirmingDelete(false);
              onDelete(transaction);
            }}
            type="button"
          >
            {confirmingDelete ? "Tap again" : "Delete"}
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
  const editable = useContext(ShiftsEditableContext);
  const dragDisabled = day.spendLocked || !editable;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Bucket rows render in the list but must NOT count toward the 4-shift cap,
  // and are never draggable (synthetic, read-only, slotIndex >= 4 -- see
  // reorderSlots above).
  const activeSlots = day.slots.filter((slot) => slot.jobType !== "none");
  const sortableSlots = activeSlots.filter((slot) => slot.kind !== "bucket");
  const bucketSlots = activeSlots.filter((slot) => slot.kind === "bucket");
  const sortableIds = sortableSlots.map((slot) => slot.slotIndex);
  const realActiveCount = sortableSlots.length;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    onReorderSlots(day.id, Number(active.id), Number(over.id));
  }

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {activeSlots.length > 0 ? (
          <DndContext
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            sensors={sensors}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {sortableSlots.map((slot) => (
                <SortableShiftRow
                  disabled={dragDisabled}
                  expanded={expandedSlotIndex === slot.slotIndex}
                  key={`${slot.dayId}-${slot.slotIndex}`}
                  locked={day.spendLocked}
                  settings={settings}
                  slot={slot}
                  onRemove={onRemoveSlot}
                  onSlotChange={onSlotChange}
                  onToggle={() => onToggleSlot(slot.slotIndex)}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : null}
        {bucketSlots.map((slot) => (
          <ShiftRow
            expanded={expandedSlotIndex === slot.slotIndex}
            isDragging={false}
            key={`${slot.dayId}-${slot.slotIndex}`}
            locked={day.spendLocked}
            settings={settings}
            slot={slot}
            onRemove={onRemoveSlot}
            onSlotChange={onSlotChange}
            onToggle={() => onToggleSlot(slot.slotIndex)}
          />
        ))}
        {activeSlots.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--text-secondary)]">
            No shifts logged for this day.
          </div>
        ) : null}
      </div>
      <button
        className="h-10 w-full rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-subtle)]0 hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={day.spendLocked || realActiveCount >= 4 || !editable}
        onClick={() => onAddShift(day)}
        type="button"
      >
        + Add shift
      </button>
    </div>
  );
}

function SortableShiftRow({
  slot,
  expanded,
  locked,
  disabled,
  settings,
  onToggle,
  onSlotChange,
  onRemove,
}: {
  slot: DashboardSlot;
  expanded: boolean;
  locked: boolean;
  disabled: boolean;
  settings: PaySettings;
  onToggle: () => void;
  onSlotChange: (
    dayId: string,
    slotIndex: number,
    patch: Partial<DashboardSlot>,
  ) => void;
  onRemove: (slot: DashboardSlot) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slot.slotIndex, disabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <ShiftRow
      dragAttributes={attributes}
      dragListeners={listeners}
      expanded={expanded}
      isDragging={isDragging}
      locked={locked}
      setNodeRef={setNodeRef}
      settings={settings}
      slot={slot}
      style={style}
      onRemove={onRemove}
      onSlotChange={onSlotChange}
      onToggle={onToggle}
    />
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
  dragAttributes,
  dragListeners,
  setNodeRef,
  style,
}: {
  slot: DashboardSlot;
  expanded: boolean;
  locked: boolean;
  isDragging?: boolean;
  settings: PaySettings;
  onToggle: () => void;
  onSlotChange: (
    dayId: string,
    slotIndex: number,
    patch: Partial<DashboardSlot>,
  ) => void;
  onRemove: (slot: DashboardSlot) => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  setNodeRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
}) {
  const editable = useContext(ShiftsEditableContext);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // In read-only History the row must be truly inert (no expand, no drag, no
  // Remove) — gate on editability, not just the day's spend lock.
  const effectiveLocked = locked || !editable;
  // Synthetic Amortized Income credit: READ-ONLY. No expand, no Remove, not
  // draggable. The amount is formatted DIRECTLY from the signed creditCents,
  // bypassing formatShiftAmountValue (which blanks/clamps non-positive values).
  if (slot.kind === "bucket") {
    return (
      <div
        className={[
          "flex min-h-10 w-full items-center gap-3 rounded-md border px-3 py-1.5 shadow-sm",
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
      ref={setNodeRef}
      style={{ ...customStyle, ...style }}
    >
      <div className="flex min-h-10 w-full items-center gap-1 pl-1 pr-3 py-1.5">
        <button
          aria-label="Drag to reorder"
          className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-current opacity-50 transition hover:opacity-90 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
          disabled={effectiveLocked}
          type="button"
          {...dragAttributes}
          {...dragListeners}
        >
          ⠿
        </button>
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
          disabled={effectiveLocked}
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
      </div>

      {expanded && !effectiveLocked ? (
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
              className={
                confirmingRemove
                  ? "text-xs font-semibold text-red-500 hover:underline"
                  : "text-xs font-medium text-[var(--accent-negative-text)] hover:underline"
              }
              onClick={() => {
                // Two-tap inline confirm (window.confirm is dead on installed apps).
                if (!confirmingRemove) {
                  setConfirmingRemove(true);
                  window.setTimeout(() => setConfirmingRemove(false), 4000);
                  return;
                }
                setConfirmingRemove(false);
                onRemove(slot);
              }}
              type="button"
            >
              {confirmingRemove ? "Tap again to remove" : "Remove"}
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
  avgDailyFixedCents,
}: {
  day: DashboardDay;
  totals: ReturnType<typeof calculateDayTotals> | undefined;
  avgDailyFixedCents: number;
}) {
  const earningsCents = totals?.earningsCents ?? 0;
  const spendCents = totals?.spendCents ?? 0;
  const baseCents = totals?.baseCents ?? day.baseCents;
  // Day's true daily burn: what was spent PLUS the day's share of fixed costs.
  // Fixed is averaged across the week (weekly fixed / 7, rounded) because the
  // per-day baseline moves around; this gives one stable daily number to add.
  const spendPlusFixedCents = spendCents + avgDailyFixedCents;
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
        <div className="flex items-center justify-between gap-3 py-1">
          <span className="text-[var(--text-secondary)]">Spend</span>
          <span className="inline-flex items-baseline gap-1.5 font-semibold tabular-nums">
            <span className="text-[var(--accent-negative-text)]">
              {formatMoney(spendCents)}
            </span>
            <span className="text-[var(--text-tertiary)]">+</span>
            <span className="text-[var(--text-primary)]">
              {formatMoney(avgDailyFixedCents)}
            </span>
            <span className="text-[var(--text-tertiary)]">=</span>
            <span className="text-[var(--accent-negative-text)]">
              {formatMoney(spendPlusFixedCents)}
            </span>
          </span>
        </div>
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
            {formatMoney(baseCents)}
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
  const editable = useContext(ShiftsEditableContext);
  return (
    <label className="space-y-1">
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        {label}
      </span>
      <select
        className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!editable}
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
  const hiddenBuiltins = useContext(HiddenBuiltinsContext);
  const editable = useContext(ShiftsEditableContext);
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
        className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!editable}
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
        {slot.jobType === "ability" || slot.jobType === "ability_incentive" ? (
          <option value={slot.jobType}>{formatJobLabel(slot.jobType)}</option>
        ) : null}
        {JOB_OPTIONS.filter(
          (jobType) =>
            !hiddenBuiltins.includes(jobType) || jobType === slot.jobType,
        ).map((jobType) => (
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
  const editable = useContext(ShiftsEditableContext);
  const locked = readOnly || !editable;
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
        readOnly={locked}
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
  const editable = useContext(ShiftsEditableContext);
  return (
    <label className="space-y-1">
      <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        {label}
      </span>
      <input
        className="h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition read-only:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white"
        onChange={(event) => onChange(event.target.value)}
        readOnly={!editable}
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
  overrides?: Partial<DashboardTransaction>,
): DashboardDay[] {
  const movedTransaction = {
    ...transaction,
    dayId: targetDay.id,
    date: targetDay.date,
    ...overrides,
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
        reconciledNetCents: slot.reconciledNetCents,
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

type SpendBreakdown = {
  categories: { key: string; label: string; cents: number }[];
  transactionsCents: number;
  manualCents: number;
  otherCents: number;
  gasCents: number;
};

// Decompose the week's Spend into the parts that produce it. The displayed Spend
// metric IS manual + transactions (toDayInput sums day.spendCents +
// day.transactionSpendCents), so this provably reconciles. Categories sub-split
// the transactions component; an "Other" remainder keeps them summing to the
// server transaction total even when gas-allocation/rounding shifts a cent.
function buildSpendBreakdown(days: DashboardDay[]): SpendBreakdown {
  let transactionsCents = 0;
  let manualCents = 0;
  let gasCents = 0;
  const byCategory = new Map<string, number>();
  for (const day of days) {
    transactionsCents += day.transactionSpendCents;
    manualCents += day.spendCents;
    gasCents += day.gasSpendCents;
    for (const transaction of day.appliedTransactions) {
      const key = transaction.category ?? "UNCATEGORIZED";
      byCategory.set(key, (byCategory.get(key) ?? 0) + transaction.amountCents);
    }
  }
  const categories = Array.from(byCategory.entries())
    .map(([key, cents]) => ({ key, label: formatTxCategory(key), cents }))
    .filter((category) => category.cents !== 0)
    .sort((a, b) => b.cents - a.cents);
  const categorizedCents = categories.reduce(
    (sum, category) => sum + category.cents,
    0,
  );
  return {
    categories,
    transactionsCents,
    manualCents,
    gasCents,
    // transaction_spend_total already folds in the daily gas slice (the fill's gas
    // is carved out of its source transaction and redistributed across the tank's
    // days), so gas lives inside the transactions component. Surface it as its own
    // "Incl. Gas" row and subtract it from Other so the rows still reconcile.
    otherCents: transactionsCents - categorizedCents - gasCents,
  };
}

function formatTxCategory(category: string): string {
  if (!category || category.toUpperCase() === "UNCATEGORIZED") {
    return "Uncategorized";
  }
  return category
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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

// Round to the nearest half hour; whole numbers show no decimals ("76h", "65.5h").
function formatHours(hours: number): string {
  const rounded = Math.round(hours * 2) / 2;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}h`;
}

// A footer stat row: colored uppercase label + white value (matches WeekNetSummary
// exactly). A label with no color (e.g. "Total") renders white.
function StatLine({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ color: color ?? "var(--text-primary)" }}
      >
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </span>
    </div>
  );
}

// The week's hours readout, one line per job that ACTUALLY has hours this week.
// Built-in Prestige (prestige + ILST) and Ability (ability + incentive variant)
// are each folded into one line; every custom job that has hours gets its own
// line by its name (e.g. "CCF"). Jobs with zero hours are dropped (so Ability
// disappears the moment it's not worked), and Total is the sum of what's shown.
function buildWageJobHours(days: DashboardDay[]): {
  jobs: { key: string; label: string; hours: number; color: string }[];
  total: number;
} {
  const sumTypes = (types: string[]): number => {
    const set = new Set(types);
    return days.reduce(
      (total, day) =>
        total +
        day.slots.reduce(
          (slotTotal, slot) =>
            set.has(slot.jobType) ? slotTotal + slot.hoursOrUnits : slotTotal,
          0,
        ),
      0,
    );
  };

  const jobs: { key: string; label: string; hours: number; color: string }[] =
    [];
  const prestige = sumTypes(["prestige", "prestige_ilst"]);
  if (prestige > 0) {
    jobs.push({
      key: "prestige",
      label: "Prestige",
      hours: prestige,
      color: "#facc15",
    });
  }
  const ability = sumTypes(["ability", "ability_incentive"]);
  if (ability > 0) {
    jobs.push({
      key: "ability",
      label: "Ability",
      hours: ability,
      color: "#1d4ed8",
    });
  }

  const customById = new Map<
    string,
    { label: string; hours: number; color: string }
  >();
  for (const day of days) {
    for (const slot of day.slots) {
      if (
        slot.jobType === "custom" &&
        slot.customJobId &&
        slot.hoursOrUnits > 0
      ) {
        const existing = customById.get(slot.customJobId);
        if (existing) {
          existing.hours += slot.hoursOrUnits;
        } else {
          customById.set(slot.customJobId, {
            label: slot.customName ?? "Custom",
            hours: slot.hoursOrUnits,
            color: slot.customColor ?? "#3b82f6",
          });
        }
      }
    }
  }
  for (const [id, value] of customById) {
    jobs.push({
      key: `custom:${id}`,
      label: value.label,
      hours: value.hours,
      color: value.color,
    });
  }

  const total = jobs.reduce((sum, job) => sum + job.hours, 0);
  return { jobs, total };
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

