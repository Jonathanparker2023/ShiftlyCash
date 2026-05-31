"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  createExpenseAction,
  deleteExpenseAction,
  saveExpenseAction,
  type SaveExpenseInput,
} from "@/app/(protected)/baseline/actions";
import type { BaselineData, BaselineExpense } from "@/lib/baseline/types";
import {
  calculateBaselineTotals,
  isExpenseExpired,
  parseMonthlyAmountToCents,
} from "@/lib/domain/baseline";
import { centsToDollars } from "@/lib/domain/money";

type SaveState = "idle" | "saving" | "saved" | "error";
type TimerMap = Record<string, ReturnType<typeof setTimeout>>;
type VersionMap = Record<string, number>;

type BaselineEditorProps = {
  initialData: BaselineData;
};

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
    <main className="min-h-screen px-4 py-5 text-white sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-white/70">
              ShiftlyCash
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Fixed Expenses
            </h1>
            <p className="mt-1 text-sm text-white/75">
              Monthly recurring costs converted into weekly and daily fixed cost.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SaveIndicator state={saveState} error={saveError} />
            <button
              className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isAdding}
              onClick={addExpense}
              type="button"
            >
              {isAdding ? "Adding..." : "Add expense"}
            </button>
          </div>
        </header>

        <TotalsPanel
          monthlyTotalCents={totals.monthlyTotalCents}
          projectedDailyBaseCents={totals.projectedDailyBaseCents}
          weeklyAverageCents={totals.weeklyAverageCents}
        />

        <section className="mt-5 overflow-hidden rounded-md border border-white/10 bg-black/20 backdrop-blur-md shadow-sm">
          <div className="hidden grid-cols-[minmax(180px,1fr)_130px_140px_160px_90px_88px] gap-3 border-b border-white/10 bg-white/10 px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-white/70 md:grid">
            <div>Name</div>
            <div>Monthly</div>
            <div>Withdraws</div>
            <div>Expiration</div>
            <div>Active</div>
            <div className="text-right">Delete</div>
          </div>

          {expenses.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-white/75">
              No fixed expenses yet.
            </div>
          ) : (
            <div className="divide-y divide-zinc-200">
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
        </section>
      </section>
    </main>
  );
}

function TotalsPanel({
  monthlyTotalCents,
  weeklyAverageCents,
  projectedDailyBaseCents,
}: {
  monthlyTotalCents: number;
  weeklyAverageCents: number;
  projectedDailyBaseCents: number;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-3">
      <TotalCard label="Monthly total" value={formatMoney(monthlyTotalCents)} />
      <TotalCard label="Weekly average" value={formatMoney(weeklyAverageCents)} />
      <TotalCard
        label="Projected daily fixed"
        sublabel="Auto-applied to today + future days"
        value={formatMoney(projectedDailyBaseCents)}
      />
    </section>
  );
}

function TotalCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 backdrop-blur-md p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-[0.12em] text-white/70">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {sublabel ? (
        <div className="mt-1 text-xs font-medium text-white/70">{sublabel}</div>
      ) : null}
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
    "px-4 py-3 transition md:grid md:grid-cols-[minmax(180px,1fr)_130px_140px_160px_90px_88px] md:items-center md:gap-3 md:py-4",
    expired ? "opacity-50" : "",
    isDatedActive ? "bg-amber-500/15 ring-1 ring-inset ring-amber-300/60" : "",
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
          <p className="mt-1 text-xs font-medium text-white/70">
            {formatMoney(expense.amountCents)}
            {expense.withdrawalDay ? ` · Day ${expense.withdrawalDay}` : ""}
            {!expense.isActive ? " · inactive" : ""}
          </p>
        </div>
        <button
          className="h-9 shrink-0 rounded-md border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/20"
          onClick={() => setIsMobileExpanded((current) => !current)}
          type="button"
        >
          {isMobileExpanded ? "Done" : "Edit"}
        </button>
      </div>

      <div
        className={
          isMobileExpanded
            ? "mt-3 grid gap-3 md:mt-0 md:contents"
            : "hidden md:contents"
        }
      >
        <label className="block">
          <MobileLabel>Name</MobileLabel>
          <div className="flex items-center gap-2">
            <input
              className="h-10 w-full rounded-md border border-white/20 bg-black/20 backdrop-blur-md px-3 text-sm"
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
            className="h-10 w-full rounded-md border border-white/20 bg-black/20 backdrop-blur-md px-3 text-sm"
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
            className="h-10 w-full rounded-md border border-white/20 bg-black/20 backdrop-blur-md px-3 text-sm"
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

        <label className="block">
          <MobileLabel>Expiration</MobileLabel>
          <input
            className={
              isDatedActive
                ? "h-10 w-full rounded-md border border-amber-300/60 bg-amber-500/15 px-3 text-sm text-amber-100"
                : "h-10 w-full rounded-md border border-white/20 bg-black/20 backdrop-blur-md px-3 text-sm"
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

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            checked={expense.isActive}
            className="h-4 w-4"
            onChange={(event) =>
              onUpdate(expense.id, { isActive: event.target.checked })
            }
            type="checkbox"
          />
          Active
        </label>

        <button
          className="h-10 rounded-md border border-white/20 bg-black/20 backdrop-blur-md px-3 text-sm font-medium transition hover:border-red-300 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60 md:justify-self-end"
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
    <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-white/70 md:hidden">
      {children}
    </span>
  );
}

function ExpiredBadge() {
  return (
    <span className="rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs font-medium text-white/75">
      Expired
    </span>
  );
}

function ExpiresBadge() {
  return (
    <span className="rounded-full border border-amber-300/60 bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-200">
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
  const label =
    state === "saving"
      ? "Saving..."
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? "Save failed"
          : "Idle";

  return (
    <div className="text-right">
      <div
        className={
          state === "error"
            ? "text-sm font-medium text-red-300"
            : "text-sm font-medium text-white/75"
        }
      >
        {label}
      </div>
      {error ? <div className="max-w-64 text-xs text-red-300">{error}</div> : null}
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
