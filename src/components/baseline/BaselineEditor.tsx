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
    <main className="min-h-screen bg-zinc-50 px-4 py-5 text-zinc-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-col gap-3 border-b border-zinc-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
              ShiftlyCash
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Baseline Expenses
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Monthly recurring costs converted into weekly and daily base.
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

        <section className="mt-5 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
          <div className="hidden grid-cols-[minmax(180px,1fr)_150px_160px_90px_88px] gap-3 border-b border-zinc-200 bg-zinc-100 px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-zinc-500 md:grid">
            <div>Name</div>
            <div>Monthly</div>
            <div>Expiration</div>
            <div>Active</div>
            <div className="text-right">Delete</div>
          </div>

          {expenses.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-600">
              No baseline expenses yet.
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
        label="Projected daily base"
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
    <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {sublabel ? (
        <div className="mt-1 text-xs font-medium text-zinc-500">{sublabel}</div>
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
  const hasDatedExpiration = Boolean(expense.expirationDate);
  const isDatedActive = hasDatedExpiration && !expired;
  const rowClassName = [
    "grid gap-3 px-4 py-4 transition md:grid-cols-[minmax(180px,1fr)_150px_160px_90px_88px] md:items-center",
    expired ? "opacity-50" : "",
    isDatedActive ? "bg-amber-50/80 ring-1 ring-inset ring-amber-300" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rowClassName}>
      <label className="block">
        <MobileLabel>Name</MobileLabel>
        <div className="flex items-center gap-2">
          <input
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"
            onChange={(event) =>
              onUpdate(expense.id, { name: event.target.value })
            }
            placeholder="Expense name"
            type="text"
            value={expense.name}
          />
          {expired ? <ExpiredBadge /> : null}
          {isDatedActive ? <ExpiresBadge /> : null}
        </div>
      </label>

      <label className="block">
        <MobileLabel>Monthly</MobileLabel>
        <input
          className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"
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
        <MobileLabel>Expiration</MobileLabel>
        <input
          className={
            isDatedActive
              ? "h-10 w-full rounded-md border border-amber-400 bg-amber-50 px-3 text-sm text-amber-950"
              : "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"
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
        className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium transition hover:border-red-700 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 md:justify-self-end"
        disabled={deleting}
        onClick={() => onDelete(expense.id)}
        type="button"
      >
        {deleting ? "..." : "Delete"}
      </button>
    </div>
  );
}

function MobileLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-zinc-500 md:hidden">
      {children}
    </span>
  );
}

function ExpiredBadge() {
  return (
    <span className="rounded-full border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">
      Expired
    </span>
  );
}

function ExpiresBadge() {
  return (
    <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
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
            ? "text-sm font-medium text-red-700"
            : "text-sm font-medium text-zinc-600"
        }
      >
        {label}
      </div>
      {error ? <div className="max-w-64 text-xs text-red-700">{error}</div> : null}
    </div>
  );
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
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
