"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

import {
  applyPendingTransactionAction,
  createLinkTokenAction,
  exchangePublicTokenAction,
  excludePendingTransactionAction,
  syncTransactionsAction,
} from "@/app/(protected)/banking/actions";
import { centsToDollars } from "@/lib/domain/money";
import type {
  BankingData,
  BankingDayOption,
  PendingTransaction,
} from "@/lib/banking/types";

type ActionState = "idle" | "loading" | "success" | "error";

export function BankingClient({ initialData }: { initialData: BankingData }) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<ActionState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<Record<string, string>>({});
  const shouldOpenLink = useRef(false);
  const isConfigured = initialData.config.isConfigured;
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken, metadata) => {
      setStatus("loading");
      setMessage("Saving bank connection...");

      try {
        await exchangePublicTokenAction({
          publicToken,
          institutionName: metadata.institution?.name ?? null,
        });
        setStatus("success");
        setMessage("Bank connected.");
        router.refresh();
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Unable to connect bank.");
      }
    },
  });

  useEffect(() => {
    if (shouldOpenLink.current && ready) {
      shouldOpenLink.current = false;
      open();
    }
  }, [open, ready, linkToken]);

  async function connectBank() {
    setStatus("loading");
    setMessage("Creating Plaid Link session...");

    try {
      const result = await createLinkTokenAction();
      shouldOpenLink.current = true;
      setLinkToken(result.linkToken);
      setStatus("idle");
      setMessage(null);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to start Plaid Link.");
    }
  }

  async function syncNow() {
    setStatus("loading");
    setMessage("Syncing transactions...");

    try {
      const result = await syncTransactionsAction();
      setStatus("success");
      setMessage(
        `Synced ${result.added} added, ${result.modified} modified, ${result.removed} removed transactions.`,
      );
      window.location.reload();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to sync transactions.");
    }
  }

  async function applyPending(transaction: PendingTransaction) {
    const dayId = selectedDays[transaction.id] ?? transaction.dayId;

    if (!dayId) {
      setStatus("error");
      setMessage("Choose a day before applying this transaction.");
      return;
    }

    setStatus("loading");
    setMessage("Applying transaction...");

    try {
      await applyPendingTransactionAction({
        transactionId: transaction.id,
        dayId,
      });
      window.location.reload();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to apply transaction.");
    }
  }

  async function excludePending(transaction: PendingTransaction) {
    setStatus("loading");
    setMessage("Excluding transaction...");

    try {
      await excludePendingTransactionAction({ transactionId: transaction.id });
      window.location.reload();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to exclude transaction.");
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-5 text-zinc-950 sm:px-6 lg:px-8">
      <header className="mx-auto mb-5 flex max-w-7xl flex-col gap-4 border-b border-zinc-200 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
            ShiftlyCash
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Banking</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Connect Plaid, sync transactions, and review anything that should not
            auto-apply.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className="h-10 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            disabled={!isConfigured || status === "loading"}
            onClick={connectBank}
            type="button"
          >
            Connect bank
          </button>
          <button
            className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium transition hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!isConfigured || status === "loading" || initialData.items.length === 0}
            onClick={syncNow}
            type="button"
          >
            Sync now
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5">
        {!isConfigured ? (
          <section className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm">
            <h2 className="font-semibold">Plaid is not configured</h2>
            <p className="mt-1">
              Add these server-only env vars before connecting a bank:{" "}
              {initialData.config.missing.join(", ")}.
            </p>
          </section>
        ) : null}

        {message ? (
          <section
            className={
              status === "error"
                ? "rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700"
                : "rounded-md border border-zinc-200 bg-white p-3 text-sm font-medium text-zinc-700"
            }
          >
            {message}
          </section>
        ) : null}

        <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Connected items</h2>
          {initialData.items.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600">No banks connected yet.</p>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {initialData.items.map((item) => (
                <div
                  className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                  key={item.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {item.institutionName ?? "Plaid item"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500" suppressHydrationWarning>
                        {item.lastSyncedAt
                          ? `Last synced ${formatTimestamp(item.lastSyncedAt)}`
                          : "Not synced yet"}
                      </p>
                    </div>
                    <span className={statusBadgeClass(item.status)}>{item.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <PendingTransactionsTable
          dayOptions={initialData.dayOptions}
          pendingTransactions={initialData.pendingTransactions}
          selectedDays={selectedDays}
          onApply={applyPending}
          onExclude={excludePending}
          onSelectedDayChange={(transactionId, dayId) =>
            setSelectedDays((current) => ({ ...current, [transactionId]: dayId }))
          }
        />
      </main>
    </div>
  );
}

function PendingTransactionsTable({
  dayOptions,
  pendingTransactions,
  selectedDays,
  onApply,
  onExclude,
  onSelectedDayChange,
}: {
  dayOptions: BankingDayOption[];
  pendingTransactions: PendingTransaction[];
  selectedDays: Record<string, string>;
  onApply: (transaction: PendingTransaction) => void;
  onExclude: (transaction: PendingTransaction) => void;
  onSelectedDayChange: (transactionId: string, dayId: string) => void;
}) {
  const dayLabels = useMemo(
    () => new Map(dayOptions.map((day) => [day.id, `${day.label} (${day.date})`])),
    [dayOptions],
  );

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold">Pending review</h2>
      {pendingTransactions.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">No pending transactions.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[900px] w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-[0.12em] text-zinc-500">
              <tr>
                <th className="py-2 pr-3 font-semibold">Date</th>
                <th className="py-2 pr-3 font-semibold">Merchant</th>
                <th className="py-2 pr-3 text-right font-semibold">Amount</th>
                <th className="py-2 pr-3 font-semibold">Reason</th>
                <th className="py-2 pr-3 font-semibold">Day</th>
                <th className="py-2 pr-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingTransactions.map((transaction) => (
                <tr
                  className="border-b border-zinc-100 last:border-0"
                  key={transaction.id}
                >
                  <td className="py-3 pr-3 text-zinc-600">
                    <div>{transaction.date}</div>
                    {transaction.time ? (
                      <div className="text-xs text-zinc-400">
                        {formatTransactionTime(transaction.time)}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 font-medium">{transaction.merchantName}</td>
                  <td className="py-3 pr-3 text-right font-medium">
                    {formatMoney(transaction.amountCents)}
                  </td>
                  <td className="py-3 pr-3 text-zinc-600">
                    {transaction.reviewReason ?? "review"}
                  </td>
                  <td className="py-3 pr-3">
                    <select
                      className="h-9 min-w-48 rounded-md border border-zinc-300 bg-white px-2 text-sm"
                      onChange={(event) =>
                        onSelectedDayChange(transaction.id, event.target.value)
                      }
                      value={selectedDays[transaction.id] ?? transaction.dayId ?? ""}
                    >
                      <option value="">Choose day</option>
                      {dayOptions.map((day) => (
                        <option key={day.id} value={day.id}>
                          {dayLabels.get(day.id)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex gap-2">
                      <button
                        className="h-8 rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium transition hover:border-zinc-950"
                        onClick={() => onApply(transaction)}
                        type="button"
                      >
                        Apply
                      </button>
                      <button
                        className="h-8 rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-600 transition hover:border-red-700 hover:text-red-700"
                        onClick={() => onExclude(transaction)}
                        type="button"
                      >
                        Exclude
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function statusBadgeClass(status: string): string {
  if (status === "active") {
    return "rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700";
  }

  if (status === "login_required") {
    return "rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700";
  }

  return "rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700";
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(centsToDollars(value));
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTransactionTime(value: string): string {
  const timestamp = Date.parse(value);

  if (Number.isFinite(timestamp)) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  return value;
}
