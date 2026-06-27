"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  createExpenseAction,
  deleteExpenseAction,
  saveExpenseAction,
  type SaveExpenseInput,
} from "@/app/(protected)/baseline/actions";
import {
  createAmortizationBucketAction,
  deleteAmortizationBucketAction,
  deleteAmortizationItemAction,
  removeAmortizationAction,
  updateAmortizationBucketAction,
  upsertAmortizationItemAction,
} from "@/app/(protected)/actions";
import type {
  BaselineAmortizedExpense,
  BaselineBucket,
  BaselineBucketItem,
  BaselineData,
  BaselineExpense,
} from "@/lib/baseline/types";
import {
  calculateBaselineTotals,
  isExpenseExpired,
  parseMonthlyAmountToCents,
} from "@/lib/domain/baseline";
import { addDaysIso } from "@/lib/dashboard/dates";
import { centsToDollars } from "@/lib/domain/money";

type SaveState = "idle" | "saving" | "saved" | "error";
type TimerMap = Record<string, ReturnType<typeof setTimeout>>;
type VersionMap = Record<string, number>;

type BaselineEditorProps = {
  initialData: BaselineData;
};

// Width-free base so callers set width explicitly (composing with w-full caused a
// Tailwind precedence conflict that collapsed flex item rows).
const FIELD_BASE =
  "h-11 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:bg-[var(--surface-hover)] focus:ring-2 focus:ring-[var(--surface-hover)]";
const FIELD_CLASS = `${FIELD_BASE} w-full`;

export function BaselineEditor({ initialData }: BaselineEditorProps) {
  const [expenses, setExpenses] = useState(initialData.expenses);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const timers = useRef<TimerMap>({});
  const versions = useRef<VersionMap>({});
  const lastSavedAt = useRef<number | null>(null);

  useEffect(() => {
    const scheduledTimers = timers.current;

    return () => {
      Object.values(scheduledTimers).forEach(clearTimeout);
    };
  }, []);

  const totals = useMemo(
    () =>
      calculateBaselineTotals(
        expenses.map((expense) => ({
          amountCents: expense.amountCents,
          expirationDate: expense.expirationDate,
          isActive: expense.isActive,
        })),
        initialData.todayIso,
      ),
    [expenses, initialData.todayIso],
  );

  const activeCount = useMemo(
    () =>
      expenses.filter(
        (expense) =>
          expense.isActive &&
          !isExpenseExpired(expense.expirationDate, initialData.todayIso),
      ).length,
    [expenses, initialData.todayIso],
  );

  function updateExpense(id: string, patch: Partial<BaselineExpense>) {
    const currentExpense = expenses.find((expense) => expense.id === id);

    if (!currentExpense) {
      return;
    }

    const nextExpense = { ...currentExpense, ...patch };

    setExpenses((currentExpenses) =>
      currentExpenses.map((expense) =>
        expense.id === id ? { ...expense, ...patch } : expense,
      ),
    );
    scheduleExpenseSave(nextExpense);
  }

  async function addExpense() {
    setIsAdding(true);
    setSaveState("saving");
    setSaveError(null);

    try {
      const result = await createExpenseAction();
      setExpenses((currentExpenses) => [...currentExpenses, result.expense]);
      markImmediateSaved();
    } catch (error) {
      markError(error);
    } finally {
      setIsAdding(false);
    }
  }

  async function deleteExpense(id: string) {
    setDeletingIds((current) => new Set(current).add(id));
    setSaveState("saving");
    setSaveError(null);

    try {
      await deleteExpenseAction({ id });
      setExpenses((currentExpenses) =>
        currentExpenses.filter((expense) => expense.id !== id),
      );
      markImmediateSaved();
    } catch (error) {
      markError(error);
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  function scheduleExpenseSave(expense: BaselineExpense) {
    const key = `expense:${expense.id}`;
    const version = bumpVersion(key);
    const input: SaveExpenseInput = {
      id: expense.id,
      name: expense.name,
      amountCents: expense.amountCents,
      withdrawalDay: expense.withdrawalDay,
      expirationDate: expense.expirationDate,
      isActive: expense.isActive,
      sortOrder: expense.sortOrder,
    };

    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(async () => {
      setSaveState("saving");
      setSaveError(null);

      try {
        const result = await saveExpenseAction(input);

        if (versions.current[key] === version) {
          setExpenses((currentExpenses) =>
            currentExpenses.map((currentExpense) =>
              currentExpense.id === result.expense.id
                ? result.expense
                : currentExpense,
            ),
          );
        }

        markSaved(key, version);
      } catch (error) {
        markError(error);
      }
    }, 500);
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

    markImmediateSaved();
  }

  function markImmediateSaved() {
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

  return (
    <main className="min-h-screen px-4 py-6 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
              ShiftlyCash
            </p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">
              Fixed Expenses
            </h1>
            <p className="mt-1.5 text-sm text-[var(--text-tertiary)]">
              Monthly recurring costs converted into weekly and daily fixed cost.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SaveIndicator state={saveState} error={saveError} />
            <button
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-hover)] px-4 text-sm font-semibold text-[var(--text-primary)] shadow-sm backdrop-blur-md transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isAdding}
              onClick={addExpense}
              type="button"
            >
              <span className="text-base leading-none">+</span>
              {isAdding ? "Adding..." : "Add expense"}
            </button>
          </div>
        </header>

        <TotalsPanel
          activeCount={activeCount}
          monthlyTotalCents={totals.monthlyTotalCents}
          projectedDailyBaseCents={totals.projectedDailyBaseCents}
          weeklyAverageCents={totals.weeklyAverageCents}
        />

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
              Expenses
            </h2>
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {activeCount} active
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] shadow-[0_8px_30px_rgba(0,0,0,0.25)] backdrop-blur-xl">
            <div className="hidden grid-cols-[minmax(200px,1fr)_140px_120px_170px_84px_84px] gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-hover)] px-5 py-3 text-[0.7rem] font-semibold uppercase tracking-[0.13em] text-[var(--text-tertiary)] md:grid">
              <div>Name</div>
              <div>Monthly</div>
              <div>Withdraws</div>
              <div>Expiration</div>
              <div>Active</div>
              <div className="text-right">Delete</div>
            </div>

            {expenses.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <p className="text-sm font-medium text-[var(--text-secondary)]">
                  No fixed expenses yet.
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Add your rent, utilities, and subscriptions to build your daily
                  fixed cost.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {expenses.map((expense) => (
                  <ExpenseRow
                    deleting={deletingIds.has(expense.id)}
                    expense={expense}
                    expired={isExpenseExpired(
                      expense.expirationDate,
                      initialData.todayIso,
                    )}
                    key={expense.id}
                    onDelete={deleteExpense}
                    onUpdate={updateExpense}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <AmortizedExpensesSection
          canonicalDailyCents={initialData.dailyFixedTodayCents}
          initialExpenses={initialData.amortizedExpenses}
          recurringDailyCents={totals.projectedDailyBaseCents}
        />

        <AmortizedIncomeSection
          initialBuckets={initialData.buckets}
          todayIso={initialData.todayIso}
        />
      </section>
    </main>
  );
}

function AmortizedExpensesSection({
  initialExpenses,
  recurringDailyCents,
  canonicalDailyCents,
}: {
  initialExpenses: BaselineAmortizedExpense[];
  recurringDailyCents: number;
  // The dashboard's exact daily-fixed value (from v_day_totals). When present it
  // IS the headline — same source as the dashboard, so they can't disagree.
  canonicalDailyCents: number | null;
}) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Component sum (recompute from current list so a removal updates optimistically).
  const amortizedTotal = expenses.reduce(
    (sum, expense) => sum + expense.todaySliceCents,
    0,
  );
  const componentSum = recurringDailyCents + amortizedTotal;
  // Headline = the dashboard's own value when available; fall back to the sum.
  const headlineDaily = canonicalDailyCents ?? componentSum;
  // If the component sum ever drifts from the canonical value, surface it loudly
  // (within a couple cents of rounding) instead of letting it pass silently.
  const drifts =
    canonicalDailyCents !== null &&
    Math.abs(canonicalDailyCents - componentSum) > 2;

  async function remove(expense: BaselineAmortizedExpense) {
    if (!expense.sourceTransactionId) {
      return;
    }
    setRemovingIds((current) => new Set(current).add(expense.id));
    setError(null);
    try {
      await removeAmortizationAction({
        transactionId: expense.sourceTransactionId,
      });
      setExpenses((list) => list.filter((item) => item.id !== expense.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setRemovingIds((current) => {
        const next = new Set(current);
        next.delete(expense.id);
        return next;
      });
    }
  }

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-col gap-3 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            Amortized Expenses
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            One-time costs spread across days — these add to your daily fixed
            cost and show in the dashboard Fixed breakdown.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Daily fixed today
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            {formatMoney(headlineDaily)}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {formatMoney(recurringDailyCents)} recurring +{" "}
            {formatMoney(amortizedTotal)} amortized
          </div>
          {drifts ? (
            <div className="mt-1 text-xs font-semibold text-[var(--accent-warning-text)]">
              ⚠ components sum to {formatMoney(componentSum)}
            </div>
          ) : null}
        </div>
      </div>

      {expenses.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-5 py-10 text-center">
          <p className="text-sm font-medium text-[var(--text-secondary)]">
            No amortized expenses.
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            On a transaction, tap &quot;Spread this cost&quot; to amortize a
            one-time purchase across months.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] shadow-[0_8px_30px_rgba(0,0,0,0.25)] backdrop-blur-xl">
          <div className="divide-y divide-[var(--border-subtle)]">
            {expenses.map((expense) => (
              <div
                className="flex items-center gap-3 px-5 py-3.5"
                key={expense.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {expense.merchantName}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                    {formatMoney(expense.originalAmountCents)} over{" "}
                    {expense.periodDays}d · {expense.startDate} →{" "}
                    {expense.endDate}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {formatMoney(expense.todaySliceCents)}
                    <span className="text-xs font-normal text-[var(--text-tertiary)]">
                      /day
                    </span>
                  </p>
                </div>
                {expense.sourceTransactionId ? (
                  <button
                    className="h-9 shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent-negative-border)] hover:bg-[var(--accent-negative-fill)] hover:text-[var(--accent-negative-text)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={removingIds.has(expense.id)}
                    onClick={() => remove(expense)}
                    type="button"
                  >
                    {removingIds.has(expense.id) ? "..." : "Remove"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
      {error ? <p className="mt-2 px-1 text-xs text-[var(--accent-negative-text)]">{error}</p> : null}
    </section>
  );
}

// Inclusive day count for [startIso, endIso]; clamps to >= 1 for the optimistic
// UI (the server is the real validator and rejects end-before-start).
function inclusiveDaysBetween(startIso: string, endIso: string): number {
  const ms =
    Date.parse(`${endIso}T00:00:00Z`) - Date.parse(`${startIso}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    return 1;
  }
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

function deriveBucket(
  items: BaselineBucketItem[],
  periodDays: number,
): { totalCents: number; dailyRateCents: number } {
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  return {
    totalCents,
    dailyRateCents: Math.round(totalCents / Math.max(1, periodDays)),
  };
}

function AmortizedIncomeSection({
  initialBuckets,
  todayIso,
}: {
  initialBuckets: BaselineBucket[];
  todayIso: string;
}) {
  const [buckets, setBuckets] = useState(initialBuckets);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timers = useRef<TimerMap>({});

  useEffect(() => {
    const scheduled = timers.current;
    return () => Object.values(scheduled).forEach(clearTimeout);
  }, []);

  function markError(error: unknown) {
    setSaveState("error");
    setSaveError(error instanceof Error ? error.message : "Save failed.");
  }
  function markSaved() {
    setSaveState("saved");
    setSaveError(null);
    window.setTimeout(() => setSaveState("idle"), 1200);
  }

  // Optimistic patch + live recompute of periodDays/total/dailyRate.
  function patchBucket(bucketId: string, patch: Partial<BaselineBucket>) {
    setBuckets((prev) =>
      prev.map((bucket) => {
        if (bucket.id !== bucketId) {
          return bucket;
        }
        const next = { ...bucket, ...patch };
        const periodDays = inclusiveDaysBetween(next.startDate, next.endDate);
        return { ...next, periodDays, ...deriveBucket(next.items, periodDays) };
      }),
    );
  }

  function schedule(key: string, fn: () => Promise<unknown>) {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(async () => {
      setSaveState("saving");
      setSaveError(null);
      try {
        await fn();
        markSaved();
      } catch (error) {
        markError(error);
      }
    }, 600);
  }

  async function addBucket() {
    setBusy(true);
    setSaveState("saving");
    setSaveError(null);
    const startDate = todayIso;
    const endDate = addDaysIso(todayIso, 20); // 21-day default window
    try {
      const result = await createAmortizationBucketAction({
        name: "New bucket",
        startDate,
        endDate,
      });
      setBuckets((prev) => [
        ...prev,
        {
          id: result.bucketId,
          name: "New bucket",
          startDate,
          endDate,
          periodDays: 21,
          status: "active",
          items: [],
          totalCents: 0,
          dailyRateCents: 0,
        },
      ]);
      markSaved();
    } catch (error) {
      markError(error);
    } finally {
      setBusy(false);
    }
  }

  function updateBucketName(bucketId: string, name: string) {
    patchBucket(bucketId, { name });
    schedule(`bucket:${bucketId}:name`, () =>
      updateAmortizationBucketAction({ bucketId, name }),
    );
  }

  function updateBucketDates(
    bucketId: string,
    startDate: string,
    endDate: string,
  ) {
    patchBucket(bucketId, { startDate, endDate });
    schedule(`bucket:${bucketId}:dates`, () =>
      updateAmortizationBucketAction({ bucketId, startDate, endDate }),
    );
  }

  async function deleteBucket(bucketId: string) {
    setBusy(true);
    setSaveState("saving");
    setSaveError(null);
    try {
      await deleteAmortizationBucketAction({ bucketId });
      setBuckets((prev) => prev.filter((bucket) => bucket.id !== bucketId));
      markSaved();
    } catch (error) {
      markError(error);
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(bucketId: string, archived: boolean) {
    const status: BaselineBucket["status"] = archived ? "archived" : "active";
    patchBucket(bucketId, { status });
    setSaveState("saving");
    try {
      await updateAmortizationBucketAction({ bucketId, status });
      markSaved();
    } catch (error) {
      markError(error);
    }
  }

  async function addItem(bucketId: string) {
    const bucket = buckets.find((current) => current.id === bucketId);
    if (!bucket) {
      return;
    }
    const itemIndex = bucket.items.reduce(
      (max, item) => Math.max(max, item.itemIndex + 1),
      0,
    );
    patchBucket(bucketId, {
      items: [
        ...bucket.items,
        { id: `temp:${itemIndex}`, itemIndex, label: "Item", amountCents: 0 },
      ],
    });
    setSaveState("saving");
    try {
      await upsertAmortizationItemAction({
        bucketId,
        itemIndex,
        label: "Item",
        amountCents: 0,
      });
      markSaved();
    } catch (error) {
      markError(error);
    }
  }

  function updateItem(
    bucketId: string,
    itemIndex: number,
    patch: Partial<BaselineBucketItem>,
  ) {
    const bucket = buckets.find((current) => current.id === bucketId);
    if (!bucket) {
      return;
    }
    const nextItems = bucket.items.map((item) =>
      item.itemIndex === itemIndex ? { ...item, ...patch } : item,
    );
    patchBucket(bucketId, { items: nextItems });
    const target = nextItems.find((item) => item.itemIndex === itemIndex);
    if (!target) {
      return;
    }
    schedule(`item:${bucketId}:${itemIndex}`, () =>
      upsertAmortizationItemAction({
        bucketId,
        itemIndex,
        label: target.label.trim() || "Item",
        amountCents: target.amountCents,
      }),
    );
  }

  async function deleteItem(bucketId: string, itemIndex: number) {
    const bucket = buckets.find((current) => current.id === bucketId);
    if (!bucket) {
      return;
    }
    patchBucket(bucketId, {
      items: bucket.items.filter((item) => item.itemIndex !== itemIndex),
    });
    setSaveState("saving");
    try {
      await deleteAmortizationItemAction({ bucketId, itemIndex });
      markSaved();
    } catch (error) {
      markError(error);
    }
  }

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-col gap-3 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            Prorated Income
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            One-time cash prorated evenly as daily &quot;Other&quot; earnings
            across a date range.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator state={saveState} error={saveError} />
          <button
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-hover)] px-4 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            onClick={addBucket}
            type="button"
          >
            <span className="text-base leading-none">+</span> Add bucket
          </button>
        </div>
      </div>

      {buckets.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-5 py-12 text-center">
          <p className="text-sm font-medium text-[var(--text-secondary)]">
            No prorated income yet.
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Add a bucket (e.g. &quot;Lean Break&quot;) and list the one-time
            amounts to smooth them into daily income.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {buckets.map((bucket) => (
            <BucketCard
              bucket={bucket}
              busy={busy}
              key={bucket.id}
              onAddItem={addItem}
              onDeleteBucket={deleteBucket}
              onDeleteItem={deleteItem}
              onToggleArchive={toggleArchive}
              onUpdateDates={updateBucketDates}
              onUpdateItem={updateItem}
              onUpdateName={updateBucketName}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BucketCard({
  bucket,
  busy,
  onUpdateName,
  onUpdateDates,
  onDeleteBucket,
  onToggleArchive,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
}: {
  bucket: BaselineBucket;
  busy: boolean;
  onUpdateName: (bucketId: string, name: string) => void;
  onUpdateDates: (bucketId: string, startDate: string, endDate: string) => void;
  onDeleteBucket: (bucketId: string) => void;
  onToggleArchive: (bucketId: string, archived: boolean) => void;
  onAddItem: (bucketId: string) => void;
  onUpdateItem: (
    bucketId: string,
    itemIndex: number,
    patch: Partial<BaselineBucketItem>,
  ) => void;
  onDeleteItem: (bucketId: string, itemIndex: number) => void;
}) {
  const isArchived = bucket.status === "archived";

  return (
    <div
      className={[
        "rounded-2xl border p-5 shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl transition",
        isArchived
          ? "border-[var(--border-subtle)] bg-[var(--surface-hover)] opacity-60"
          : "border-[var(--border-subtle)] bg-[var(--surface-hover)]",
      ].join(" ")}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="grid flex-1 gap-3 sm:grid-cols-[minmax(160px,1fr)_150px_150px]">
          <label className="block">
            <MobileLabel>Name</MobileLabel>
            <input
              className={FIELD_CLASS}
              onChange={(event) => onUpdateName(bucket.id, event.target.value)}
              placeholder="Bucket name"
              type="text"
              value={bucket.name}
            />
          </label>
          <label className="block">
            <MobileLabel>Start</MobileLabel>
            <input
              className={FIELD_CLASS}
              onChange={(event) =>
                onUpdateDates(
                  bucket.id,
                  event.target.value || bucket.startDate,
                  bucket.endDate,
                )
              }
              type="date"
              value={bucket.startDate}
            />
          </label>
          <label className="block">
            <MobileLabel>End</MobileLabel>
            <input
              className={FIELD_CLASS}
              onChange={(event) =>
                onUpdateDates(
                  bucket.id,
                  bucket.startDate,
                  event.target.value || bucket.endDate,
                )
              }
              type="date"
              value={bucket.endDate}
            />
          </label>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)]"
            onClick={() => onToggleArchive(bucket.id, !isArchived)}
            type="button"
          >
            {isArchived ? "Unarchive" : "Archive"}
          </button>
          <button
            className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent-negative-border)] hover:bg-[var(--accent-negative-fill)] hover:text-[var(--accent-negative-text)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            onClick={() => onDeleteBucket(bucket.id)}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Total" value={formatSignedMoney(bucket.totalCents)} />
        <Stat
          label={`Daily rate · ${bucket.periodDays}d`}
          value={formatSignedMoney(bucket.dailyRateCents)}
        />
        <Stat label="Items" value={String(bucket.items.length)} />
      </div>

      <div className="mt-4 space-y-2">
        {bucket.items.map((item) => (
          <div className="flex items-center gap-2" key={item.itemIndex}>
            <input
              className={`${FIELD_BASE} min-w-0 flex-1`}
              onChange={(event) =>
                onUpdateItem(bucket.id, item.itemIndex, {
                  label: event.target.value,
                })
              }
              placeholder="Label (e.g. Sold laptop)"
              type="text"
              value={item.label}
            />
            <input
              className={`${FIELD_BASE} w-32 shrink-0 text-right tabular-nums`}
              onChange={(event) =>
                onUpdateItem(bucket.id, item.itemIndex, {
                  amountCents: parseSignedDollarsToCents(event.target.value),
                })
              }
              placeholder="0.00"
              step="0.01"
              type="number"
              value={formatNumberInput(centsToDollars(item.amountCents))}
            />
            <button
              aria-label="Delete item"
              className="h-11 w-11 shrink-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] text-base text-[var(--text-tertiary)] transition hover:border-[var(--accent-negative-border)] hover:bg-[var(--accent-negative-fill)] hover:text-[var(--accent-negative-text)]"
              onClick={() => onDeleteItem(bucket.id, item.itemIndex)}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="h-10 w-full rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-hover)] text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)]"
          onClick={() => onAddItem(bucket.id)}
          type="button"
        >
          + Add item
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-4 py-3">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function formatSignedMoney(cents: number): string {
  const magnitude = formatMoney(Math.abs(cents));
  return cents < 0 ? `-${magnitude}` : magnitude;
}

function parseSignedDollarsToCents(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function TotalsPanel({
  monthlyTotalCents,
  weeklyAverageCents,
  projectedDailyBaseCents,
  activeCount,
}: {
  monthlyTotalCents: number;
  weeklyAverageCents: number;
  projectedDailyBaseCents: number;
  activeCount: number;
}) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <TotalCard label="Monthly total" value={formatMoney(monthlyTotalCents)} />
      <TotalCard label="Weekly average" value={formatMoney(weeklyAverageCents)} />
      <TotalCard
        hero
        label="Projected daily fixed"
        sublabel={`Auto-applied to today + future days · ${activeCount} active`}
        value={formatMoney(projectedDailyBaseCents)}
      />
    </section>
  );
}

function TotalCard({
  label,
  value,
  sublabel,
  hero = false,
}: {
  label: string;
  value: string;
  sublabel?: string;
  hero?: boolean;
}) {
  return (
    <div
      className={[
        "relative overflow-hidden rounded-2xl border p-5 shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl transition",
        hero
          ? "border-[var(--border-default)] bg-gradient-to-br from-[var(--surface-hover)] to-[var(--surface-hover)]"
          : "border-[var(--border-subtle)] bg-[var(--surface-hover)]",
      ].join(" ")}
    >
      {hero ? (
        <span className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[var(--surface-hover)] blur-2xl" />
      ) : null}
      <div className="relative">
        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          {label}
        </div>
        <div className="mt-2.5 text-[2rem] font-semibold leading-none tracking-tight tabular-nums">
          {value}
        </div>
        {sublabel ? (
          <div className="mt-2 text-xs font-medium text-[var(--text-tertiary)]">{sublabel}</div>
        ) : null}
      </div>
    </div>
  );
}

function ExpenseRow({
  expense,
  expired,
  deleting,
  onUpdate,
  onDelete,
}: {
  expense: BaselineExpense;
  expired: boolean;
  deleting: boolean;
  onUpdate: (id: string, patch: Partial<BaselineExpense>) => void;
  onDelete: (id: string) => void;
}) {
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const hasDatedExpiration = Boolean(expense.expirationDate);
  const isDatedActive = hasDatedExpiration && !expired;
  const rowClassName = [
    "px-5 py-3.5 transition md:grid md:grid-cols-[minmax(200px,1fr)_140px_120px_170px_84px_84px] md:items-center md:gap-3 md:py-3.5 hover:bg-[var(--surface-hover)]",
    expired ? "opacity-45" : "",
    isDatedActive ? "bg-[var(--accent-brand-fill)] ring-1 ring-inset ring-[var(--accent-brand-border)]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rowClassName}>
      <div className="flex items-center justify-between gap-3 md:hidden">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">
              {expense.name || "Untitled expense"}
            </p>
            {expired ? <ExpiredBadge /> : null}
            {isDatedActive ? <ExpiresBadge /> : null}
          </div>
          <p className="mt-1 text-xs font-medium text-[var(--text-tertiary)]">
            {formatMoney(expense.amountCents)}
            {expense.withdrawalDay ? ` · Day ${expense.withdrawalDay}` : ""}
            {!expense.isActive ? " · inactive" : ""}
          </p>
        </div>
        <button
          className="h-9 shrink-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-hover)] px-3.5 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
          onClick={() => setIsMobileExpanded((current) => !current)}
          type="button"
        >
          {isMobileExpanded ? "Done" : "Edit"}
        </button>
      </div>

      <div
        className={
          isMobileExpanded
            ? "mt-4 grid gap-3.5 md:mt-0 md:contents"
            : "hidden md:contents"
        }
      >
        <label className="block">
          <MobileLabel>Name</MobileLabel>
          <div className="flex items-center gap-2">
            <input
              className={FIELD_CLASS}
              onChange={(event) =>
                onUpdate(expense.id, { name: event.target.value })
              }
              placeholder="Expense name"
              type="text"
              value={expense.name}
            />
            <span className="hidden md:inline-flex">
              {expired ? <ExpiredBadge /> : null}
              {isDatedActive ? <ExpiresBadge /> : null}
            </span>
          </div>
        </label>

        <label className="block">
          <MobileLabel>Monthly</MobileLabel>
          <input
            className={FIELD_CLASS}
            min="0"
            onChange={(event) =>
              onUpdate(expense.id, {
                amountCents: parseMonthlyAmountToCents(
                  parsePositiveNumber(event.target.value),
                ),
              })
            }
            step="0.01"
            type="number"
            value={formatNumberInput(centsToDollars(expense.amountCents))}
          />
        </label>

        <label className="block">
          <MobileLabel>Withdraws</MobileLabel>
          <input
            className={FIELD_CLASS}
            max="31"
            min="1"
            onChange={(event) =>
              onUpdate(expense.id, {
                withdrawalDay: parseWithdrawalDay(event.target.value),
              })
            }
            placeholder="Day"
            step="1"
            type="number"
            value={expense.withdrawalDay ?? ""}
          />
        </label>

        <div className="block">
          <label className="block">
            <MobileLabel>Expiration</MobileLabel>
            <input
              className={
                isDatedActive
                  ? "h-11 w-full rounded-xl border border-[var(--accent-brand-border)] bg-[var(--accent-brand-fill)] px-3.5 text-sm text-[var(--accent-brand-text)] outline-none transition focus:border-[var(--accent-brand-border)] focus:ring-2 focus:ring-[var(--accent-brand-fill)]"
                  : FIELD_CLASS
              }
              onChange={(event) =>
                onUpdate(expense.id, {
                  expirationDate: event.target.value || null,
                })
              }
              type="date"
              value={expense.expirationDate ?? ""}
            />
          </label>
          {hasDatedExpiration ? (
            <button
              className="mt-1.5 text-xs font-semibold text-[var(--accent-brand-text)] underline-offset-2 transition hover:text-[var(--accent-brand-text)] hover:underline"
              onClick={() => onUpdate(expense.id, { expirationDate: null })}
              type="button"
            >
              Make permanent
            </button>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            checked={expense.isActive}
            className="h-4 w-4 accent-[var(--accent-primary)]"
            onChange={(event) =>
              onUpdate(expense.id, { isActive: event.target.checked })
            }
            type="checkbox"
          />
          <span className="md:sr-only">Active</span>
        </label>

        <button
          className="h-11 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3.5 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent-negative-border)] hover:bg-[var(--accent-negative-fill)] hover:text-[var(--accent-negative-text)] disabled:cursor-not-allowed disabled:opacity-60 md:h-9 md:justify-self-end md:px-3"
          disabled={deleting}
          onClick={() => onDelete(expense.id)}
          type="button"
        >
          {deleting ? "..." : "Delete"}
        </button>
      </div>
    </div>
  );
}

function MobileLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-[0.7rem] font-semibold uppercase tracking-[0.13em] text-[var(--text-tertiary)] md:hidden">
      {children}
    </span>
  );
}

function ExpiredBadge() {
  return (
    <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-hover)] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
      Expired
    </span>
  );
}

function ExpiresBadge() {
  return (
    <span className="rounded-full border border-[var(--accent-brand-border)] bg-[var(--accent-brand-fill)] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--accent-brand-text)]">
      Expires
    </span>
  );
}

function SaveIndicator({
  state,
  error,
}: {
  state: SaveState;
  error: string | null;
}) {
  if (state === "idle") {
    return null;
  }

  const dotClass =
    state === "error"
      ? "bg-[var(--accent-negative)]"
      : state === "saving"
        ? "bg-[var(--accent-warning)] animate-pulse"
        : "bg-[var(--accent-primary)]";
  const label =
    state === "saving" ? "Saving..." : state === "saved" ? "Saved" : "Save failed";

  return (
    <div className="text-right">
      <div
        className={[
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur-md",
          state === "error"
            ? "border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] text-[var(--accent-negative-text)]"
            : "border-[var(--border-default)] bg-[var(--surface-hover)] text-[var(--text-secondary)]",
        ].join(" ")}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {label}
      </div>
      {error ? (
        <div className="mt-1 max-w-64 text-xs text-[var(--accent-negative-text)]">{error}</div>
      ) : null}
    </div>
  );
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseWithdrawalDay(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return null;
  }

  return Math.min(31, Math.max(1, parsed));
}

function formatNumberInput(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(centsToDollars(value));
}
