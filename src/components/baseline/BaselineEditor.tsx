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
  "h-10 rounded-md border border-transparent bg-transparent px-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] focus:border-[var(--accent-primary-border)] focus:bg-[var(--surface-hover)] focus:ring-2 focus:ring-[var(--accent-primary-fill)] md:h-9";
const FIELD_CLASS = `${FIELD_BASE} w-full`;

export function BaselineEditor({ initialData }: BaselineEditorProps) {
  const [expenses, setExpenses] = useState(initialData.expenses);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [pendingFocusExpenseId, setPendingFocusExpenseId] = useState<
    string | null
  >(null);
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
      setPendingFocusExpenseId(result.expense.id);
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
    <main className="min-h-screen px-3 py-5 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <header className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Fixed expenses
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <SaveIndicator state={saveState} error={saveError} />
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isAdding}
              onClick={addExpense}
              type="button"
            >
              <span className="text-base leading-none">+</span>
              <span className="sm:hidden">{isAdding ? "..." : "Add"}</span>
              <span className="hidden sm:inline">
                {isAdding ? "Adding..." : "Add expense"}
              </span>
            </button>
          </div>
        </header>

        <TotalsPanel
          activeCount={activeCount}
          monthlyTotalCents={totals.monthlyTotalCents}
          projectedDailyBaseCents={totals.projectedDailyBaseCents}
          weeklyAverageCents={totals.weeklyAverageCents}
        />

        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
              Recurring expenses
            </h2>
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {activeCount} active
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)]">
            <div className="hidden grid-cols-[minmax(180px,1fr)_120px_100px_145px_64px_40px] gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)] md:grid">
              <div>Name</div>
              <div>Monthly</div>
              <div>Withdrawal day</div>
              <div>Ends</div>
              <div>Active</div>
              <div />
            </div>

            {expenses.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <p className="text-sm font-medium text-[var(--text-secondary)]">
                  No fixed expenses yet.
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Add your rent, utilities, and subscriptions to build your
                  daily fixed cost.
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
                    shouldFocus={pendingFocusExpenseId === expense.id}
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
    <section className="mt-6">
      <details className="group overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-3 py-2.5 marker:hidden hover:bg-[var(--surface-hover)]">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Temporary costs
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {expenses.length} {expenses.length === 1 ? "cost" : "costs"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold tabular-nums">
                +{formatMoney(amortizedTotal)}/day
              </div>
              <div className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                daily impact
              </div>
            </div>
            <span
              aria-hidden="true"
              className="text-xs text-[var(--text-muted)] transition group-open:rotate-180"
            >
              ▾
            </span>
          </div>
        </summary>

        <div className="border-t border-[var(--border-subtle)]">
          {expenses.length === 0 ? (
            <p className="px-3 py-5 text-sm text-[var(--text-tertiary)]">
              No temporary costs. Use Spread this cost on a transaction to add
              one.
            </p>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {expenses.map((expense) => (
                <div
                  className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2"
                  key={expense.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {expense.merchantName}
                    </p>
                    <p className="truncate text-xs text-[var(--text-muted)]">
                      Ends {expense.endDate} ·{" "}
                      {formatMoney(expense.originalAmountCents)} total
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    {formatMoney(expense.todaySliceCents)}/day
                  </p>
                  {expense.sourceTransactionId ? (
                    <button
                      aria-label={`Remove ${expense.merchantName}`}
                      className="h-9 w-9 rounded-md text-lg text-[var(--text-muted)] transition hover:bg-[var(--accent-negative-fill)] hover:text-[var(--accent-negative-text)] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={removingIds.has(expense.id)}
                      onClick={() => remove(expense)}
                      title="Remove temporary cost"
                      type="button"
                    >
                      {removingIds.has(expense.id) ? "…" : "×"}
                    </button>
                  ) : (
                    <span className="w-9" />
                  )}
                </div>
              ))}
            </div>
          )}
          {drifts ? (
            <p className="border-t border-[var(--border-subtle)] px-3 py-2 text-xs font-semibold text-[var(--accent-warning-text)]">
              Fixed-cost components total {formatMoney(componentSum)}, which
              differs from the dashboard value.
            </p>
          ) : null}
          {error ? (
            <p className="border-t border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--accent-negative-text)]">
              {error}
            </p>
          ) : null}
        </div>
      </details>
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
  const [expandedBucketId, setExpandedBucketId] = useState<string | null>(
    initialBuckets.find((bucket) => bucket.status === "active")?.id ?? null,
  );
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
      setExpandedBucketId(result.bucketId);
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
      if (expandedBucketId === bucketId) {
        setExpandedBucketId(null);
      }
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
    <section className="mt-6 pb-8">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            Planned buckets
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Prorated income across a date range
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SaveIndicator state={saveState} error={saveError} />
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            onClick={addBucket}
            type="button"
          >
            <span className="text-base leading-none">+</span> Add bucket
          </button>
        </div>
      </div>

      {buckets.length === 0 ? (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] px-4 py-8 text-center">
          <p className="text-sm font-medium text-[var(--text-secondary)]">
            No prorated income yet.
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Add a bucket (e.g. &quot;Lean Break&quot;) and list the one-time
            amounts to smooth them into daily income.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {buckets.map((bucket) => (
            <BucketCard
              bucket={bucket}
              busy={busy}
              expanded={expandedBucketId === bucket.id}
              key={bucket.id}
              onAddItem={addItem}
              onDeleteBucket={deleteBucket}
              onDeleteItem={deleteItem}
              onToggleArchive={toggleArchive}
              onToggleExpanded={() =>
                setExpandedBucketId((current) =>
                  current === bucket.id ? null : bucket.id,
                )
              }
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
  expanded,
  onToggleExpanded,
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
  expanded: boolean;
  onToggleExpanded: () => void;
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
        "overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)]",
        isArchived ? "opacity-60" : "",
      ].join(" ")}
    >
      <button
        aria-expanded={expanded}
        className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left hover:bg-[var(--surface-hover)] sm:grid-cols-[minmax(0,1fr)_auto_auto]"
        onClick={onToggleExpanded}
        type="button"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{bucket.name}</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            <span className="sm:hidden">
              {formatSignedMoney(bucket.totalCents)} total ·{" "}
              {formatSignedMoney(bucket.dailyRateCents)}/day
            </span>
            <span className="hidden sm:inline">
              {bucket.items.length}{" "}
              {bucket.items.length === 1 ? "item" : "items"} ·{" "}
              {bucket.periodDays} days
            </span>
          </p>
        </div>
        <div className="hidden grid-cols-2 gap-4 text-right sm:grid">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              Total
            </p>
            <p className="text-sm font-semibold tabular-nums">
              {formatSignedMoney(bucket.totalCents)}
            </p>
          </div>
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              Daily
            </p>
            <p className="text-sm font-semibold tabular-nums">
              {formatSignedMoney(bucket.dailyRateCents)}
            </p>
          </div>
        </div>
        <span
          aria-hidden="true"
          className={[
            "text-xs text-[var(--text-muted)] transition",
            expanded ? "rotate-180" : "",
          ].join(" ")}
        >
          ▾
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-[var(--border-subtle)] p-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(160px,1fr)_145px_145px_auto]">
            <label className="block">
              <MobileLabel>Name</MobileLabel>
              <input
                className={FIELD_CLASS}
                onChange={(event) =>
                  onUpdateName(bucket.id, event.target.value)
                }
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
            <div className="flex items-center justify-end gap-1.5">
              <button
                className="h-9 rounded-md px-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                onClick={() => onToggleArchive(bucket.id, !isArchived)}
                type="button"
              >
                {isArchived ? "Unarchive" : "Archive"}
              </button>
              <button
                className="h-9 rounded-md px-2.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--accent-negative-fill)] hover:text-[var(--accent-negative-text)] disabled:opacity-60"
                disabled={busy}
                onClick={() => onDeleteBucket(bucket.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>

          <div className="mt-3 divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
            {bucket.items.map((item) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_112px_36px] items-center gap-2 py-1.5"
                key={item.itemIndex}
              >
                <input
                  className={`${FIELD_BASE} min-w-0 w-full`}
                  onChange={(event) =>
                    onUpdateItem(bucket.id, item.itemIndex, {
                      label: event.target.value,
                    })
                  }
                  placeholder="Item label"
                  type="text"
                  value={item.label}
                />
                <input
                  className={`${FIELD_BASE} w-full text-right tabular-nums`}
                  onChange={(event) =>
                    onUpdateItem(bucket.id, item.itemIndex, {
                      amountCents: parseSignedDollarsToCents(
                        event.target.value,
                      ),
                    })
                  }
                  placeholder="0.00"
                  step="0.01"
                  type="number"
                  value={formatNumberInput(centsToDollars(item.amountCents))}
                />
                <button
                  aria-label={`Delete ${item.label}`}
                  className="h-9 w-9 rounded-md text-lg text-[var(--text-muted)] hover:bg-[var(--accent-negative-fill)] hover:text-[var(--accent-negative-text)]"
                  onClick={() => onDeleteItem(bucket.id, item.itemIndex)}
                  title="Delete bucket item"
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            className="mt-2 h-9 w-full rounded-md border border-dashed border-[var(--border-subtle)] text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
            onClick={() => onAddItem(bucket.id)}
            type="button"
          >
            + Add item
          </button>
        </div>
      ) : null}
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
  const metrics = [
    {
      label: "Monthly recurring",
      mobileLabel: "Monthly",
      value: formatMoney(monthlyTotalCents),
    },
    {
      label: "Weekly equivalent",
      mobileLabel: "Weekly",
      value: formatMoney(weeklyAverageCents),
    },
    {
      label: "Daily fixed",
      mobileLabel: "Daily fixed",
      value: formatMoney(projectedDailyBaseCents),
    },
  ];

  return (
    <section
      aria-label={`${activeCount} active recurring expenses`}
      className="grid grid-cols-3 divide-x divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]"
    >
      {metrics.map((metric) => (
        <div className="min-w-0 px-2.5 py-3 sm:px-4" key={metric.label}>
          <div className="text-[0.58rem] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] sm:text-[0.65rem] sm:tracking-[0.13em]">
            <span className="sm:hidden">{metric.mobileLabel}</span>
            <span className="hidden sm:inline">{metric.label}</span>
          </div>
          <div className="mt-1 truncate text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">
            {metric.value}
          </div>
        </div>
      ))}
    </section>
  );
}

function ExpenseRow({
  expense,
  expired,
  deleting,
  shouldFocus,
  onUpdate,
  onDelete,
}: {
  expense: BaselineExpense;
  expired: boolean;
  deleting: boolean;
  shouldFocus: boolean;
  onUpdate: (id: string, patch: Partial<BaselineExpense>) => void;
  onDelete: (id: string) => void;
}) {
  const [isMobileExpanded, setIsMobileExpanded] = useState(shouldFocus);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const hasDatedExpiration = Boolean(expense.expirationDate);
  const isDatedActive = hasDatedExpiration && !expired;
  const rowClassName = [
    "px-3 py-2 transition md:grid md:min-h-[52px] md:grid-cols-[minmax(180px,1fr)_120px_100px_145px_64px_40px] md:items-center md:gap-2 md:py-1.5 hover:bg-[var(--surface-hover)]",
    expired ? "opacity-45" : "",
    isDatedActive
      ? "bg-[var(--accent-brand-fill)] ring-1 ring-inset ring-[var(--accent-brand-border)]"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (shouldFocus) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [shouldFocus]);

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
          <p className="mt-0.5 text-xs font-medium text-[var(--text-tertiary)]">
            {formatMoney(expense.amountCents)}
            {expense.withdrawalDay ? ` · Day ${expense.withdrawalDay}` : ""}
            {!expense.isActive ? " · inactive" : ""}
          </p>
        </div>
        <button
          className="h-9 shrink-0 rounded-md px-3 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)]"
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
              ref={nameInputRef}
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
                  ? "h-10 w-full rounded-md border border-[var(--accent-brand-border)] bg-[var(--accent-brand-fill)] px-2.5 text-sm text-[var(--accent-brand-text)] outline-none transition focus:ring-2 focus:ring-[var(--accent-brand-fill)] md:h-9"
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
          aria-label={`Delete ${expense.name || "expense"}`}
          className="h-10 rounded-md text-lg font-medium text-[var(--text-muted)] transition hover:bg-[var(--accent-negative-fill)] hover:text-[var(--accent-negative-text)] disabled:cursor-not-allowed disabled:opacity-60 md:h-9 md:w-9 md:justify-self-end"
          disabled={deleting}
          onClick={() => onDelete(expense.id)}
          title="Delete expense"
          type="button"
        >
          <span className="md:hidden">
            {deleting ? "Removing..." : "Delete"}
          </span>
          <span className="hidden md:inline">{deleting ? "…" : "×"}</span>
        </button>
      </div>
    </div>
  );
}

function MobileLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)] md:hidden">
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
    state === "saving"
      ? "Saving..."
      : state === "saved"
        ? "Saved"
        : "Save failed";

  return (
    <div className="text-right">
      <div
        className={[
          "inline-flex items-center gap-1.5 text-xs font-medium",
          state === "error"
            ? "text-[var(--accent-negative-text)]"
            : "text-[var(--text-tertiary)]",
        ].join(" ")}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {label}
      </div>
      {error ? (
        <div className="mt-1 max-w-64 text-xs text-[var(--accent-negative-text)]">
          {error}
        </div>
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
