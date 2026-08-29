"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import {
  addDebtAction,
  deleteDebtAction,
  reorderDebtsAction,
  updateDebtAction,
} from "@/app/(protected)/debt/actions";
import { centsToDollars, dollarsToCents } from "@/lib/domain/money";
import {
  formatWeekDuration,
  formatWeekOffsetDateLabel,
} from "@/lib/domain/projection-format";
import type { DebtRow } from "@/lib/domain/projections";
import type {
  CreditCardAccountSnapshot,
  DebtPageData,
} from "@/lib/debt/data";

type ChartRange = "1y" | "3y" | "5y" | "10y" | "full";

const RANGE_WEEKS: Record<ChartRange, number> = {
  "1y": 52,
  "3y": 156,
  "5y": 260,
  "10y": 520,
  full: Number.POSITIVE_INFINITY,
};

// Design tokens (see /DESIGN.md). Every color reads from the [data-theme]
// contract in globals.css, so the whole screen — chart included — reskins by
// swapping one attribute. Nothing here is theme-specific.
const PANEL: CSSProperties = {
  background: "var(--surface-elevated)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-panel)",
  boxShadow: "var(--panel-shadow)",
};

const FIELD: CSSProperties = {
  background: "var(--surface-base)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-control)",
  color: "var(--text-primary)",
};

const BRAND_BUTTON: CSSProperties = {
  background: "var(--accent-brand)",
  color: "#ffffff",
  border: "1px solid var(--accent-brand-border)",
};

function buildChartTicks(yMin: number, yMax: number): number[] {
  const span = Math.max(1, yMax - yMin);
  const roughStep = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceMultiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = niceMultiplier * magnitude;
  const first = Math.ceil(yMin / step) * step;
  const ticks: number[] = [];

  for (let value = first; value <= yMax; value += step) {
    ticks.push(Math.round(value));
  }

  if (!ticks.some((value) => Math.abs(value) < step / 2)) {
    ticks.push(0);
  }

  return Array.from(new Set(ticks))
    .filter((value) => value >= yMin && value <= yMax)
    .sort((a, b) => a - b);
}

export function DebtPage({ initialData }: { initialData: DebtPageData }) {
  const router = useRouter();
  const [debts, setDebts] = useState<DebtRow[]>(initialData.debts);
  const [chartRange, setChartRange] = useState<ChartRange>("full");
  const [error, setError] = useState<string | null>(null);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  function patchDebtLocal(id: string, patch: Partial<DebtRow>) {
    setDebts((current) =>
      current.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );
  }

  function scheduleDebtSave(
    id: string,
    field: string,
    payload: Parameters<typeof updateDebtAction>[0],
  ) {
    const key = `${id}:${field}`;
    clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(async () => {
      try {
        await updateDebtAction(payload);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed.");
      }
    }, 700);
  }

  async function addDebt() {
    setError(null);
    try {
      const result = await addDebtAction();
      router.refresh();
      setDebts((current) => [
        ...current,
        {
          id: result.debtId,
          name: "New Debt",
          balanceCents: 0,
          minimumPaymentCents: 0,
          aprBps: 0,
          status: "active",
          priorityOrder: result.priorityOrder,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed.");
    }
  }

  async function deleteDebt(id: string) {
    if (!window.confirm("Delete this debt?")) return;
    setDebts((current) => current.filter((d) => d.id !== id));
    try {
      await deleteDebtAction({ debtId: id });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function moveDebt(id: string, direction: "up" | "down") {
    const idx = debts.findIndex((d) => d.id === id);
    if (idx === -1) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= debts.length) return;
    const reordered = [...debts];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
    setDebts(reordered);
    try {
      await reorderDebtsAction({ orderedIds: reordered.map((d) => d.id) });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed.");
    }
  }

  const chartWeekLimit =
    chartRange === "full"
      ? initialData.millionaireBalances.length
      : RANGE_WEEKS[chartRange];
  const visibleBalances = useMemo(
    () => initialData.millionaireBalances.slice(0, chartWeekLimit),
    [chartWeekLimit, initialData.millionaireBalances],
  );
  const visiblePrincipalBalances = useMemo(
    () => initialData.principalMillionaireBalances.slice(0, chartWeekLimit),
    [chartWeekLimit, initialData.principalMillionaireBalances],
  );
  return (
    <div
      className="min-h-screen w-full max-w-[100vw] overflow-x-hidden px-3 py-5 sm:px-6 lg:px-8"
      style={{ background: "var(--surface-base)", color: "var(--text-primary)" }}
    >
      <header
        className="mx-auto mb-5 max-w-7xl pb-4"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_296px] lg:items-start">
          <div className="min-w-0">
            <p
              className="text-xs font-semibold uppercase tracking-[0.18em]"
              style={{ color: "var(--accent-brand-text)" }}
            >
              Bashflow
            </p>
            <h1
              className="mt-1 text-3xl font-semibold"
              style={{ color: "var(--text-primary)", letterSpacing: "-0.03em" }}
            >
              Debt Obligations
            </h1>
            <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              Predict your future. Own your future.
            </p>
            <p
              className="mt-2 text-xs font-semibold uppercase tracking-[0.12em]"
              style={{ color: "var(--text-tertiary)" }}
            >
              Pulling {initialData.projectionSource.closedWeekCount} closed
              weeks from week totals. Rolling window: wk{" "}
              {initialData.projectionSource.recentWeekNumbers.join(", ")}.
            </p>
          </div>
          <Metric
            label="Total debt"
            sub={`${initialData.activeDebtCount} active accounts`}
            tone="red"
            value={formatMoney(initialData.totalActiveDebtCents)}
          />
        </div>
      </header>

      {error ? (
        <div
          className="mx-auto mb-4 max-w-7xl p-3 text-sm font-medium"
          style={{
            background: "var(--accent-negative-fill)",
            border: "1px solid var(--accent-negative-border)",
            borderRadius: "var(--radius-control)",
            color: "var(--accent-negative-text)",
          }}
        >
          {error}
        </div>
      ) : null}

      <main className="mx-auto grid w-full max-w-7xl min-w-0 gap-6">
        <section className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Metric
            label="Earnings avg"
            sub={`${formatMoneyList(initialData.projection.recentEarningsCents)} - ${initialData.projection.recentEarningsCents.length} wks`}
            tone="green"
            value={formatMoney(initialData.projection.avgEarningsCents)}
          />
          <Metric
            label="Cashflow avg"
            sub={`${formatMoneyList(initialData.projection.recentCashflowCents)} - ${initialData.projection.recentCashflowCents.length} wks`}
            tone="green"
            value={formatMoney(initialData.projection.wpcCents)}
          />
          <Metric
            label="Yearly projected gross wage income"
            sub={`grossed from YTD wages ${formatMoney(initialData.projection.ytdWageNetCents)} + avg wages ${formatMoney(initialData.projection.avgWageNetCents)} x ${initialData.projection.weeksRemaining} wks`}
            tone="green"
            value={formatMoney(initialData.projection.ypwiGrossCents)}
          />
          <Metric
            label="Estimated due tax"
            sub={`fed ${formatMoney(initialData.projection.fedLiabilityCents)} + FICA ${formatMoney(initialData.projection.ficaLiabilityCents)} + CT ${formatMoney(initialData.projection.ctLiabilityCents)} - withheld ${formatMoney(initialData.projection.withheldYrCents)} + $160`}
            tone="red"
            value={formatMoney(initialData.projection.estTaxCents)}
          />
          <Metric
            label="Weekly tax due"
            sub="set aside per week"
            tone="red"
            value={formatMoney(initialData.weeklyTaxDueCents)}
          />

          <Metric
            label="Available cash"
            sub={cashBalanceSourceLabel(initialData)}
            tone="purple"
            value={formatMoney(initialData.availableCashCents)}
          />

          <Metric
            label="Yearly projected gross cashflow"
            sub={`YTD ${formatMoney(initialData.projection.ytdCfCents)} + avg ${formatMoney(initialData.projection.wpcCents)} x ${initialData.projection.weeksRemaining} wks`}
            tone="green"
            value={formatMoney(initialData.projection.ypgcCents)}
          />
          <Metric
            label="Yearly projected net cashflow"
            sub={`YPGC ${formatMoney(initialData.projection.ypgcCents)} - bill due ${formatMoney(initialData.projection.estTaxCents)}`}
            tone="green"
            value={formatMoney(initialData.projection.ypncCents)}
          />
          <Metric
            label="Debt-free date"
            sub={`${weeksUntilLabel(initialData.debtFreeDateIso)} - assumes ${formatMoney(initialData.cashAppliedToDebtCents)} cash applied today + ${formatMoney(initialData.projection.wpcCents)}/wk`}
            tone="amber"
            value={formatShortDate(initialData.debtFreeDateIso)}
          />
          <Metric
            label="Millionaire date"
            sub={`on ${formatShortDate(initialData.millionaireDateIso)}${initialData.ageAtMillionaire != null ? ` - you'll be ${initialData.ageAtMillionaire} years old` : ""} - starts at ${formatMoney(initialData.startingNetWorthCents)} net worth - ${formatMoney(initialData.investableWeeklyCashflowCents)}/wk - 10% return`}
            tone="purple"
            value={initialData.millionaireDurationLabel}
          />
        </section>

        <section className="min-w-0 p-4 sm:p-5" style={PANEL}>
          <div className="mb-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2
                className="text-sm font-semibold uppercase tracking-[0.14em]"
                style={{ color: "var(--text-secondary)" }}
              >
                Path to $1M
              </h2>
              <p className="mt-1 text-sm" style={{ color: "var(--text-tertiary)" }}>
                Starts at available cash minus debt, invests post-tax weekly
                cashflow, and compounds at 10%.
              </p>
            </div>
            <div
              className="flex w-full flex-nowrap gap-1 sm:w-auto"
              style={{
                background: "var(--surface-base)",
                border: "1px solid var(--border-default)",
                borderRadius: "9999px",
                padding: "3px",
              }}
            >
              {(["1y", "3y", "5y", "10y", "full"] as ChartRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  className="min-w-0 flex-1 px-2 py-1 text-xs font-medium transition-colors sm:flex-none sm:px-3"
                  style={
                    chartRange === r
                      ? {
                          background: "var(--surface-hover)",
                          color: "var(--text-primary)",
                          borderRadius: "9999px",
                        }
                      : {
                          background: "transparent",
                          color: "var(--text-tertiary)",
                          borderRadius: "9999px",
                        }
                  }
                >
                  {r === "full" ? "$1M" : r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <Chart
            events={initialData.millionairePayoffEvents}
            principalValues={visiblePrincipalBalances}
            values={visibleBalances}
          />
        </section>

        <section className="min-w-0 p-5" style={PANEL}>
          <div className="mb-4">
            <h2
              className="text-sm font-semibold uppercase tracking-[0.14em]"
              style={{ color: "var(--text-secondary)" }}
            >
              Debt breakdown
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-tertiary)" }}>
              Sorted by remaining balance, largest account first.
            </p>
          </div>
          <DebtBreakdown debts={debts} />
        </section>

        <CreditCardAccountsTable accounts={initialData.creditCards} />

        {/* Debts list */}
        <section className="min-w-0 overflow-hidden" style={PANEL}>
          <div
            className="flex items-center justify-between p-3"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <h2
              className="text-sm font-semibold uppercase tracking-[0.14em]"
              style={{ color: "var(--text-secondary)" }}
            >
              Debts ({debts.length})
            </h2>
            <button
              onClick={addDebt}
              className="px-3 py-1.5 text-xs font-semibold transition-colors hover:[background-color:var(--accent-brand-hover)]"
              style={{ ...BRAND_BUTTON, borderRadius: "var(--radius-control)" }}
            >
              + Add debt
            </button>
          </div>
          <div className="w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead
              className="text-xs uppercase tracking-[0.12em]"
              style={{
                background: "var(--surface-hover)",
                color: "var(--text-tertiary)",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <tr>
                <th className="p-3 text-left font-semibold">Order</th>
                <th className="p-3 text-left font-semibold">Name</th>
                <th className="p-3 text-right font-semibold">Balance</th>
                <th className="p-3 text-right font-semibold">Min/mo</th>
                <th className="p-3 text-right font-semibold">APR %</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {debts.map((debt, idx) => (
                <tr
                  key={debt.id}
                  className="border-b last:border-0"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <td className="p-2">
                    <div className="flex flex-col gap-0.5">
                      <button
                        aria-label={`Move ${debt.name} up`}
                        disabled={idx === 0}
                        onClick={() => moveDebt(debt.id, "up")}
                        className="text-xs transition-colors disabled:opacity-30 hover:[color:var(--accent-brand-text)]"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        ^
                      </button>
                      <button
                        aria-label={`Move ${debt.name} down`}
                        disabled={idx === debts.length - 1}
                        onClick={() => moveDebt(debt.id, "down")}
                        className="text-xs transition-colors disabled:opacity-30 hover:[color:var(--accent-brand-text)]"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        v
                      </button>
                    </div>
                  </td>
                  <td className="p-2">
                    <input
                      value={debt.name}
                      className="w-full px-2 py-1 text-sm outline-none transition-colors focus:[border-color:var(--accent-brand)] focus:[box-shadow:0_0_0_3px_var(--accent-ring)]"
                      style={FIELD}
                      onChange={(e) => {
                        const value = e.target.value;
                        patchDebtLocal(debt.id, { name: value });
                        scheduleDebtSave(debt.id, "name", { debtId: debt.id, name: value });
                      }}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={centsToDollars(debt.balanceCents)}
                      className="w-full px-2 py-1 text-right text-sm outline-none transition-colors focus:[border-color:var(--accent-brand)] focus:[box-shadow:0_0_0_3px_var(--accent-ring)]"
                      style={FIELD}
                      onChange={(e) => {
                        const cents = dollarsToCents(parseFloat(e.target.value) || 0);
                        patchDebtLocal(debt.id, {
                          balanceCents: cents,
                          status: cents <= 0 ? "paid" : "active",
                        });
                        scheduleDebtSave(debt.id, "balance", {
                          debtId: debt.id,
                          balanceCents: cents,
                        });
                      }}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={centsToDollars(debt.minimumPaymentCents)}
                      className="w-full px-2 py-1 text-right text-sm outline-none transition-colors focus:[border-color:var(--accent-brand)] focus:[box-shadow:0_0_0_3px_var(--accent-ring)]"
                      style={FIELD}
                      onChange={(e) => {
                        const cents = dollarsToCents(parseFloat(e.target.value) || 0);
                        patchDebtLocal(debt.id, { minimumPaymentCents: cents });
                        scheduleDebtSave(debt.id, "minimumPayment", {
                          debtId: debt.id,
                          minimumPaymentCents: cents,
                        });
                      }}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={(debt.aprBps / 100).toFixed(2)}
                      className="w-full px-2 py-1 text-right text-sm outline-none transition-colors focus:[border-color:var(--accent-brand)] focus:[box-shadow:0_0_0_3px_var(--accent-ring)]"
                      style={FIELD}
                      onChange={(e) => {
                        const bps = Math.round((parseFloat(e.target.value) || 0) * 100);
                        patchDebtLocal(debt.id, { aprBps: bps });
                        scheduleDebtSave(debt.id, "apr", { debtId: debt.id, aprBps: bps });
                      }}
                    />
                  </td>
                  <td className="p-2">
                    <span
                      className="px-2 py-1 text-xs font-semibold"
                      style={
                        debt.status === "paid"
                          ? {
                              background: "var(--accent-primary-fill)",
                              color: "var(--accent-primary-text)",
                              borderRadius: "var(--radius-data)",
                            }
                          : {
                              background: "var(--surface-hover)",
                              color: "var(--text-tertiary)",
                              borderRadius: "var(--radius-data)",
                            }
                      }
                    >
                      {debt.status}
                    </span>
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => deleteDebt(debt.id)}
                      className="text-xs font-medium hover:underline"
                      style={{ color: "var(--accent-negative-text)" }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {debts.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="p-6 text-center text-sm"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    No debts tracked. Click &ldquo;Add debt&rdquo; to start.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function CreditCardAccountsTable({
  accounts,
}: {
  accounts: CreditCardAccountSnapshot[];
}) {
  return (
    <section className="min-w-0 overflow-hidden" style={PANEL}>
      <div className="p-4 sm:p-5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <h2
          className="text-sm font-semibold uppercase tracking-[0.14em]"
          style={{ color: "var(--text-secondary)" }}
        >
          Credit card accounts ({accounts.length})
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-tertiary)" }}>
          Planning balance drives forecasts. Disputed charges remain visible but
          are excluded from debt and spending.
        </p>
      </div>
      <div className="w-full max-w-full overflow-x-auto">
        <table className="w-full min-w-[1180px] text-sm">
          <thead
            className="text-xs uppercase tracking-[0.12em]"
            style={{
              background: "var(--surface-hover)",
              color: "var(--text-tertiary)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <tr>
              <th className="p-3 text-left font-semibold">Card</th>
              <th className="p-3 text-right font-semibold">Planning</th>
              <th className="p-3 text-right font-semibold">Current</th>
              <th className="p-3 text-right font-semibold">Statement</th>
              <th className="p-3 text-right font-semibold">Pending</th>
              <th className="p-3 text-left font-semibold">Due</th>
              <th className="p-3 text-right font-semibold">Limit / available</th>
              <th className="p-3 text-left font-semibold">AutoPay</th>
              <th className="p-3 text-left font-semibold">Verification</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr
                key={account.id}
                className="border-b align-top last:border-0"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <td className="p-3">
                  <div className="font-semibold" style={{ color: "var(--text-primary)" }}>
                    {account.name}
                    {account.lastFour ? ` •${account.lastFour}` : ""}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {account.accountStatus.replaceAll("_", " ")}
                    {account.disputedTotalCents > 0
                      ? ` · ${formatMoney(account.disputedTotalCents)} disputed`
                      : ""}
                  </div>
                  {account.notes ? (
                    <div className="mt-1 max-w-[280px] text-xs" style={{ color: "var(--text-tertiary)" }}>
                      {account.notes}
                    </div>
                  ) : null}
                </td>
                <td className="p-3 text-right font-semibold">
                  {formatMoney(account.planningBalanceCents)}
                </td>
                <td className="p-3 text-right">
                  {formatMaybeMoney(account.rawCurrentBalanceCents)}
                </td>
                <td className="p-3 text-right">
                  {formatMaybeMoney(account.statementBalanceCents)}
                  {account.statementDate ? (
                    <div className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
                      {formatLongDate(account.statementDate)}
                    </div>
                  ) : null}
                </td>
                <td className="p-3 text-right">
                  {formatMaybeMoney(account.pendingTotalCents)}
                </td>
                <td className="p-3">
                  <div>{formatMaybeMoney(account.minimumDueCents)}</div>
                  <div className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {account.dueDate ? formatLongDate(account.dueDate) : "Date unverified"}
                  </div>
                </td>
                <td className="p-3 text-right">
                  <div>{formatMaybeMoney(account.creditLimitCents)}</div>
                  <div className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {formatMaybeMoney(account.availableCreditCents)} available
                  </div>
                </td>
                <td className="p-3">
                  <div className="font-medium">{account.autopayStatus.toUpperCase()}</div>
                  <div className="mt-1 max-w-[180px] text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {[account.autopayMode, account.autopaySourceLabel]
                      .filter(Boolean)
                      .join(" · ") || "Details unverified"}
                  </div>
                </td>
                <td className="p-3">
                  <div className="font-medium">
                    {account.verificationStatus.replaceAll("_", " ")}
                  </div>
                  <div
                    className="mt-1 text-xs"
                    style={{
                      color:
                        account.riskStatus === "open_dispute"
                          ? "var(--accent-negative-text)"
                          : "var(--text-tertiary)",
                    }}
                  >
                    {account.riskStatus.replaceAll("_", " ")}
                  </div>
                </td>
              </tr>
            ))}
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-center" style={{ color: "var(--text-tertiary)" }}>
                  No credit-card audit has been recorded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatMaybeMoney(cents: number | null): string {
  return cents == null ? "Unverified" : formatMoney(cents);
}

function formatLongDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  const day = date.getUTCDate();
  const ordinal =
    day % 100 >= 11 && day % 100 <= 13
      ? "th"
      : day % 10 === 1
        ? "st"
        : day % 10 === 2
          ? "nd"
          : day % 10 === 3
            ? "rd"
            : "th";
  const formatted = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  return formatted.replace(String(day), `${day}${ordinal}`);
}

function Metric({
  label,
  sub,
  value,
  tone,
}: {
  label: string;
  sub?: string;
  value: string;
  tone?: "green" | "red" | "amber" | "purple";
}) {
  const valueColor =
    tone === "green"
      ? "var(--accent-primary-text)"
      : tone === "red"
        ? "var(--accent-negative-text)"
        : tone === "amber" || tone === "purple"
          ? "var(--accent-brand-text)"
          : "var(--text-primary)";
  return (
    <div className="min-h-[132px] min-w-0 p-4" style={PANEL}>
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </div>
      <div
        className="mt-2 text-2xl font-semibold"
        style={{ color: valueColor, letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
      {sub ? (
        <div
          className="mt-2 min-w-0 break-words text-sm leading-snug"
          style={{ color: "var(--text-tertiary)" }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function Chart({
  compact = false,
  events = [],
  principalValues = [],
  values,
}: {
  compact?: boolean;
  events?: Array<{ week: number; name: string; freedCents: number }>;
  principalValues?: number[];
  values: number[];
}) {
  if (values.length === 0) {
    return (
      <div
        className="flex h-64 items-center justify-center text-sm"
        style={{ color: "var(--text-tertiary)" }}
      >
        No data.
      </div>
    );
  }

  const series = values;
  const principalSeries = principalValues.slice(0, series.length);
  const targetCents = 100_000_000;

  const allSeries = [...series, ...principalSeries];
  const min = Math.min(...allSeries);
  const max = Math.max(...allSeries);
  const negativeFloor = min < 0 ? min - Math.max(Math.abs(min) * 0.15, 500_000) : 0;
  const yMin = Math.min(0, negativeFloor);
  const positiveCeiling = Math.max(0, max);
  const yMax =
    Math.max(positiveCeiling + Math.max(positiveCeiling * 0.12, 500_000), 1);

  const W = 800;
  const H = compact ? 220 : 260;
  const PAD = { t: 22, r: 124, b: 28, l: 60 };
  const cw = W - PAD.l - PAD.r;
  const ch = H - PAD.t - PAD.b;
  const px = (i: number) =>
    PAD.l + (i / Math.max(1, series.length - 1)) * cw;
  const py = (v: number) =>
    PAD.t + ch * (1 - (v - yMin) / Math.max(1, yMax - yMin));

  // Find crossover (debt to positive)
  let crossIdx = -1;
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] < 0 && series[i] >= 0) {
      crossIdx = i;
      break;
    }
  }

  // Build paths
  const linePath = series
    .map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(v)}`)
    .join(" ");
  const principalPath = principalSeries
    .map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(v)}`)
    .join(" ");
  const areaPathBetween = (top: number[], bottom: number[]) => {
    const length = Math.min(top.length, bottom.length);
    if (length === 0) return "";

    const topPath = top
      .slice(0, length)
      .map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(v)}`)
      .join(" ");
    const bottomPath = bottom
      .slice(0, length)
      .reverse()
      .map((v, i) => `L${px(length - 1 - i)},${py(v)}`)
      .join(" ");

    return `${topPath} ${bottomPath} Z`;
  };
  const zeroSeries = series.map(() => 0);
  const principalPositive = principalSeries.map((value) => Math.max(0, value));
  const investedPositive = series.map((value) => Math.max(0, value));
  const interestTop = investedPositive.map((value, index) =>
    Math.max(value, principalPositive[index] ?? 0),
  );
  const interestBottom = investedPositive.map((value, index) =>
    Math.min(value, principalPositive[index] ?? 0),
  );
  const debtFloor = principalSeries.map((value) => Math.min(0, value));
  const principalFillPath = areaPathBetween(principalPositive, zeroSeries);
  const interestFillPath = areaPathBetween(interestTop, interestBottom);
  const debtFillPath = areaPathBetween(zeroSeries, debtFloor);

  const zero = py(0);
  const investedTargetIndex = series.findIndex((value) => value >= targetCents);
  const principalTargetIndex = principalSeries.findIndex(
    (value) => value >= targetCents,
  );
  const shouldShowTargetLine = targetCents >= yMin && targetCents <= yMax;

  // Y-axis labels
  const yTicks = buildChartTicks(yMin, yMax);
  const yLabels: React.ReactElement[] = [];
  for (const v of yTicks) {
    const yy = py(v);
    const dollars = centsToDollars(v);
    const lbl =
      Math.abs(dollars) >= 1000
        ? `${dollars < 0 ? "-" : ""}$${Math.abs(Math.round(dollars / 1000))}k`
        : `${dollars < 0 ? "-" : ""}$${Math.abs(Math.round(dollars))}`;
    yLabels.push(
      <g key={`y-${v}`}>
        <text
          x={PAD.l - 8}
          y={yy + 4}
          style={{ fill: "var(--chart-axis)" }}
          fontSize="10"
          textAnchor="end"
          fontFamily="ui-monospace, monospace"
        >
          {lbl}
        </text>
        <line
          x1={PAD.l}
          y1={yy}
          x2={W - PAD.r}
          y2={yy}
          style={{ stroke: "var(--chart-grid)" }}
          strokeWidth="1"
        />
      </g>,
    );
  }

  const xLabels: React.ReactElement[] = [];
  const maxYear = Math.max(1, Math.ceil((series.length - 1) / 52));
  const yearStep = maxYear <= 5 ? 1 : maxYear <= 15 ? 2 : 5;
  for (let year = 0; year <= maxYear; year += yearStep) {
    const wkIdx = Math.min(series.length - 1, year * 52);
    xLabels.push(
      <text
        key={`x-${year}`}
        x={px(wkIdx)}
        y={H - 8}
        style={{ fill: "var(--chart-axis)" }}
        fontSize="10"
        textAnchor="middle"
      >
        {year}y
      </text>,
    );
  }
  if ((maxYear - (maxYear % yearStep)) !== maxYear) {
    const wkIdx = series.length - 1;
    xLabels.push(
      <text
        key="x-end"
        x={px(wkIdx)}
        y={H - 8}
        style={{ fill: "var(--chart-axis)" }}
        fontSize="10"
        textAnchor="middle"
      >
        {formatWeekDuration(series.length - 1)}
      </text>,
    );
  }

  const endVal = series[series.length - 1];
  const endColor = endVal >= 0 ? "var(--chart-invested)" : "var(--chart-debt)";
  const principalEnd = principalSeries[principalSeries.length - 1] ?? 0;
  const interestEarned = endVal - principalEnd;
  const visibleEvents = events.filter(
    (event) => event.week > 0 && event.week < series.length,
  );

  return (
    <div className="relative">
      {/* Total above the chart — sits in HTML so it scales independently of
          the SVG and can never collide with the interest endpoint label. */}
      <div
        className="mb-1 text-center text-sm font-semibold"
        style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
      >
        Total {formatMoney(endVal)}
      </div>
      <svg
        className="h-64 w-full max-w-full"
        preserveAspectRatio="xMidYMid meet"
        viewBox={`0 0 ${W} ${H}`}
      >
        {yLabels}
        {xLabels}
        <line
          x1={PAD.l}
          y1={zero}
          x2={W - PAD.r}
          y2={zero}
          style={{ stroke: "var(--chart-zero)" }}
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        {shouldShowTargetLine ? (
          <>
            <line
              x1={PAD.l}
              y1={py(targetCents)}
              x2={W - PAD.r}
              y2={py(targetCents)}
              style={{ stroke: "var(--chart-target)" }}
              strokeDasharray="6 4"
              strokeWidth="1"
            />
            <text
              x={W - 10}
              y={py(targetCents) - 8}
              style={{ fill: "var(--chart-target)" }}
              fontSize="10"
              fontWeight="700"
              textAnchor="end"
            >
              $1M target
            </text>
          </>
        ) : null}
        {debtFillPath ? <path d={debtFillPath} style={{ fill: "var(--chart-debt-soft)" }} /> : null}
        {principalFillPath ? (
          <path d={principalFillPath} style={{ fill: "var(--chart-principal-soft)" }} />
        ) : null}
        {interestFillPath ? (
          <path d={interestFillPath} style={{ fill: "var(--chart-invested-soft)" }} />
        ) : null}
        {principalPath ? (
          <path
            d={principalPath}
            fill="none"
            style={{ stroke: "var(--chart-principal)" }}
            strokeLinecap="round"
            strokeWidth="2.25"
          />
        ) : null}
        <path
          d={linePath}
          fill="none"
          style={{ stroke: "var(--chart-invested)" }}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {principalTargetIndex >= 0 ? (
          <g>
            <line
              x1={px(principalTargetIndex)}
              y1={PAD.t}
              x2={px(principalTargetIndex)}
              y2={H - PAD.b}
              style={{ stroke: "var(--chart-principal)" }}
              strokeDasharray="3 4"
              strokeWidth="1"
            />
            <circle
              cx={px(principalTargetIndex)}
              cy={py(targetCents)}
              style={{ fill: "var(--chart-principal)", stroke: "var(--chart-dot-stroke)" }}
              r="4"
              strokeWidth="2"
            />
            <text
              x={px(principalTargetIndex) - 4}
              y={py(targetCents) + 16}
              style={{ fill: "var(--text-primary)" }}
              fontSize="10"
              fontWeight="700"
              textAnchor="end"
            >
              principal {formatWeekDuration(principalTargetIndex)}
            </text>
          </g>
        ) : null}
        {investedTargetIndex >= 0 ? (
          <g>
            <line
              x1={px(investedTargetIndex)}
              y1={PAD.t}
              x2={px(investedTargetIndex)}
              y2={H - PAD.b}
              style={{ stroke: "var(--chart-invested)" }}
              strokeDasharray="3 4"
              strokeWidth="1"
            />
            <circle
              cx={px(investedTargetIndex)}
              cy={py(targetCents)}
              style={{ fill: "var(--chart-invested)", stroke: "var(--chart-dot-stroke)" }}
              r="4"
              strokeWidth="2"
            />
            <text
              x={Math.max(PAD.l + 120, px(investedTargetIndex) - 140)}
              y={py(targetCents) - 28}
              style={{ fill: "var(--chart-invested)" }}
              fontSize="10"
              fontWeight="700"
              textAnchor="start"
            >
              invested {formatWeekDuration(investedTargetIndex)}
            </text>
          </g>
        ) : null}
        {visibleEvents.slice(0, compact ? 2 : 5).map((event) => (
          <g key={`${event.name}-${event.week}`}>
            <line
              x1={px(event.week)}
              y1={PAD.t}
              x2={px(event.week)}
              y2={H - PAD.b}
              style={{ stroke: "var(--chart-invested)" }}
              strokeDasharray="4 4"
              strokeWidth="1"
            />
            <text
              x={px(event.week) + 4}
              y={PAD.t + 12}
              style={{ fill: "var(--chart-invested)" }}
              fontSize="9"
              fontWeight="700"
            >
              {event.name} +{formatMoney(event.freedCents)}/wk
            </text>
          </g>
        ))}
        {/* Now dot */}
        <circle
          cx={px(0)}
          cy={py(series[0])}
          r="4"
          style={{ fill: "var(--chart-debt)", stroke: "var(--chart-dot-stroke)" }}
          strokeWidth="2"
        />
        {/* Crossover */}
        {crossIdx > 0 ? (
          <g>
            <circle
              cx={px(crossIdx)}
              cy={zero}
              r="5"
              style={{ fill: "var(--chart-invested)", stroke: "var(--chart-dot-stroke)" }}
              strokeWidth="2"
            />
            <text
              x={px(crossIdx)}
              y={zero - 12}
              style={{ fill: "var(--chart-invested)" }}
              fontSize="11"
              fontWeight="700"
              textAnchor="middle"
              fontFamily="ui-monospace, monospace"
            >
              {formatWeekOffsetDateLabel(crossIdx)}
            </text>
          </g>
        ) : null}
        {/* End markers — two endpoint labels matching their line colors:
            • bottom line (principal) → principal end value
            • top line (invested) → interest earned (invested − principal)
            Total label lives in the HTML above the SVG. */}
        {(() => {
          const xEnd = px(series.length - 1);
          const labelX = W - 10;
          const principalLabelOffset = series.length - 1 <= 260 ? 40 : 24;
          return (
            <>
              {/* Principal endpoint dot + label below the dot */}
              <circle
                cx={xEnd}
                cy={py(principalEnd)}
                r="4"
                style={{ fill: "var(--chart-principal)", stroke: "var(--chart-dot-stroke)" }}
                strokeWidth="2"
              />
              <text
                x={labelX}
                y={py(principalEnd) + principalLabelOffset}
                style={{ fill: "var(--chart-principal)" }}
                fontSize="10"
                fontWeight="700"
                textAnchor="end"
                fontFamily="ui-monospace, monospace"
              >
                {formatMoney(principalEnd)} principal
              </text>

              {/* Invested endpoint dot + interest-earned label above the dot */}
              <circle
                cx={xEnd}
                cy={py(endVal)}
                r="4"
                style={{ fill: endColor, stroke: "var(--chart-dot-stroke)" }}
                strokeWidth="2"
              />
              <text
                x={labelX}
                y={py(endVal) + 18}
                style={{ fill: endColor }}
                fontSize="10"
                fontWeight="700"
                textAnchor="end"
                fontFamily="ui-monospace, monospace"
              >
                +{formatMoney(interestEarned)} interest
              </text>
            </>
          );
        })()}
      </svg>
      <div
        className="mt-2 flex items-center justify-between text-xs font-medium"
        style={{ color: "var(--text-tertiary)" }}
      >
        <span className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4" style={{ background: "var(--chart-principal)" }} /> Principal only
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4" style={{ background: "var(--chart-invested)" }} /> Invested at 10%
          </span>
        </span>
        <span style={{ color: "var(--text-tertiary)" }}>
          {formatWeekDuration(series.length - 1)} projection
        </span>
      </div>
    </div>
  );
}

function DebtBreakdown({ debts }: { debts: DebtRow[] }) {
  const activeDebts = [...debts]
    .filter((debt) => debt.balanceCents > 0)
    .sort((a, b) => b.balanceCents - a.balanceCents);
  const max = Math.max(...activeDebts.map((debt) => debt.balanceCents), 1);

  const totalCents = activeDebts.reduce(
    (sum, debt) => sum + debt.balanceCents,
    0,
  );
  const autoLoanCents = activeDebts
    .filter((debt) => isAutoLoanName(debt.name))
    .reduce((sum, debt) => sum + debt.balanceCents, 0);
  const totalMinusAutoCents = totalCents - autoLoanCents;
  const hasAutoLoan = autoLoanCents > 0;

  return (
    <div className="grid gap-3">
      {activeDebts.map((debt, index) => (
        <div key={debt.id} className="grid gap-2 sm:grid-cols-[180px_1fr_96px] sm:items-center">
          <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {debt.name}
          </div>
          <div
            className="h-3 overflow-hidden rounded-full"
            style={{ background: "var(--surface-hover)" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                background: "var(--accent-brand)",
                opacity: Math.max(0.35, 1 - index * 0.07),
                width: `${Math.max(2, (debt.balanceCents / max) * 100)}%`,
              }}
            />
          </div>
          <div
            className="text-right text-sm font-semibold"
            style={{ color: "var(--text-secondary)" }}
          >
            {formatMoney(debt.balanceCents)}
          </div>
        </div>
      ))}
      <div
        className="mt-2 grid gap-1.5 pt-3 text-sm"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>
            Total
          </span>
          <span className="font-bold" style={{ color: "var(--text-primary)" }}>
            {formatMoney(totalCents)}
          </span>
        </div>
        {hasAutoLoan ? (
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold" style={{ color: "var(--text-tertiary)" }}>
              Total minus auto loan
            </span>
            <span className="font-bold" style={{ color: "var(--accent-primary-text)" }}>
              {formatMoney(totalMinusAutoCents)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Matches the inferDebtType heuristic used by the ledger export so the
// "minus auto loan" math here lines up with what the Foundation system
// considers an auto-loan bucket.
function isAutoLoanName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("auto") || normalized.includes("loan");
}

function cashBalanceSourceLabel(data: DebtPageData): string {
  if (data.cashBalanceAsOf) {
    return `Last refreshed ${formatTimestamp(data.cashBalanceAsOf)}`;
  }

  return "No live balance fetched yet.";
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(centsToDollars(cents)));
}

function formatMoneyList(values: number[]): string {
  if (values.length === 0) {
    return "-";
  }

  return values.map((value) => formatMoney(value)).join(", ");
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00.000Z`));
}

function weeksUntilLabel(iso: string | null): string {
  if (!iso) {
    return "-";
  }

  const target = new Date(`${iso}T00:00:00.000Z`).getTime();
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const weeks = Math.max(0, Math.round((target - today) / (7 * 86_400_000)));

  return `${weeks} wks`;
}
