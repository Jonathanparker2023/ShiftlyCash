"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

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
import type { DebtPageData } from "@/lib/debt/data";

type ChartRange = "1y" | "3y" | "5y" | "10y" | "full";

const RANGE_WEEKS: Record<ChartRange, number> = {
  "1y": 52,
  "3y": 156,
  "5y": 260,
  "10y": 520,
  full: Number.POSITIVE_INFINITY,
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
    <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden  px-3 py-5 text-white sm:px-6 lg:px-8">
      <header className="mx-auto mb-5 max-w-7xl border-b border-white/15 pb-4">
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_296px] lg:items-start">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">
              ShiftlyCash
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
              Debt Obligations
            </h1>
            <p className="mt-2 text-sm text-white/75">
              Predict your future. Own your future.
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/60">
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
        <div className="mx-auto mb-4 max-w-7xl rounded-md border border-red-300/60 bg-red-500/15 p-3 text-sm font-medium text-red-300">
          {error}
        </div>
      ) : null}

      <main className="mx-auto grid w-full max-w-7xl min-w-0 gap-5">
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
            label="Yearly projected wage income"
            sub={`YTD ${formatMoney(initialData.projection.ytdEarningsCents)} + avg ${formatMoney(initialData.projection.avgEarningsCents)} x ${initialData.projection.weeksRemaining} wks`}
            tone="green"
            value={formatMoney(initialData.projection.ypwiNetCents)}
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
            sub={`${weeksUntilLabel(initialData.debtFreeDateIso)} at ${formatMoney(initialData.projection.wpcCents)}/wk gross`}
            tone="amber"
            value={formatShortDate(initialData.debtFreeDateIso)}
          />
          <Metric
            label="Millionaire date"
            sub={`on ${formatShortDate(initialData.millionaireDateIso)} - ${formatMoney(initialData.investableWeeklyCashflowCents)}/wk - 10% return`}
            tone="purple"
            value={initialData.millionaireDurationLabel}
          />
          <Metric
            label="Age at millionaire"
            sub={`on ${formatShortDate(initialData.millionaireDateIso)}`}
            tone="purple"
            value={initialData.ageAtMillionaire?.toString() ?? "-"}
          />
        </section>

        <section className="min-w-0 rounded-md border border-white/15 bg-black/15 backdrop-blur-md p-3 shadow-lg shadow-black/20 sm:p-4">
          <div className="mb-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-white/85">
                Path to $1M
              </h2>
              <p className="mt-1 text-sm text-white/70">
                Starts at negative debt, invests post-tax weekly cashflow, and
                compounds at 10%.
              </p>
            </div>
            <div className="flex w-full flex-nowrap gap-1 sm:w-auto">
              {(["1y", "3y", "5y", "10y", "full"] as ChartRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  className={
                    chartRange === r
                      ? "min-w-0 flex-1 rounded bg-zinc-950 px-2 py-1 text-xs font-semibold text-white sm:flex-none sm:px-3"
                      : "min-w-0 flex-1 rounded border border-white/20 px-2 py-1 text-xs font-medium text-white/70 hover:bg-white/10 sm:flex-none sm:px-3"
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

        <section className="min-w-0 rounded-md border border-white/15 bg-black/15 backdrop-blur-md p-4 shadow-lg shadow-black/20">
          <div className="mb-4">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-white/85">
              Debt breakdown
            </h2>
            <p className="mt-1 text-sm text-white/70">
              Sorted by remaining balance, largest account first.
            </p>
          </div>
          <DebtBreakdown debts={debts} />
        </section>

        {/* Debts list */}
        <section className="min-w-0 rounded-md border border-white/15 bg-black/15 backdrop-blur-md shadow-lg shadow-black/20">
          <div className="flex items-center justify-between border-b border-white/15 p-3">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-white/85">
              Debts ({debts.length})
            </h2>
            <button
              onClick={addDebt}
              className="rounded-md bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800"
            >
              + Add debt
            </button>
          </div>
          <div className="w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-white/15 bg-white/10 text-xs uppercase tracking-[0.12em] text-white/85">
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
                <tr key={debt.id} className="border-b border-white/10 last:border-0">
                  <td className="p-2">
                    <div className="flex flex-col gap-0.5">
                      <button
                        aria-label={`Move ${debt.name} up`}
                        disabled={idx === 0}
                        onClick={() => moveDebt(debt.id, "up")}
                        className="text-xs text-white/70 disabled:opacity-30 hover:text-emerald-300"
                      >
                        ^
                      </button>
                      <button
                        aria-label={`Move ${debt.name} down`}
                        disabled={idx === debts.length - 1}
                        onClick={() => moveDebt(debt.id, "down")}
                        className="text-xs text-white/70 disabled:opacity-30 hover:text-emerald-300"
                      >
                        v
                      </button>
                    </div>
                  </td>
                  <td className="p-2">
                    <input
                      value={debt.name}
                      className="w-full rounded border border-white/20 bg-black/20 backdrop-blur-md px-2 py-1 text-sm outline-none focus:border-white/60"
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
                      className="w-full rounded border border-white/20 bg-black/20 backdrop-blur-md px-2 py-1 text-right text-sm outline-none focus:border-white/60"
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
                      className="w-full rounded border border-white/20 bg-black/20 backdrop-blur-md px-2 py-1 text-right text-sm outline-none focus:border-white/60"
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
                      className="w-full rounded border border-white/20 bg-black/20 backdrop-blur-md px-2 py-1 text-right text-sm outline-none focus:border-white/60"
                      onChange={(e) => {
                        const bps = Math.round((parseFloat(e.target.value) || 0) * 100);
                        patchDebtLocal(debt.id, { aprBps: bps });
                        scheduleDebtSave(debt.id, "apr", { debtId: debt.id, aprBps: bps });
                      }}
                    />
                  </td>
                  <td className="p-2">
                    <span
                      className={
                        debt.status === "paid"
                          ? "rounded bg-sky-500/15 px-2 py-1 text-xs font-semibold text-emerald-300"
                          : "rounded bg-white/10 px-2 py-1 text-xs font-semibold text-white/70"
                      }
                    >
                      {debt.status}
                    </span>
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => deleteDebt(debt.id)}
                      className="text-xs font-medium text-red-300 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {debts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-sm text-white/70">
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
  const valueClass =
    tone === "green"
      ? "text-emerald-300"
      : tone === "red"
        ? "text-red-300"
        : tone === "amber"
          ? "text-amber-200"
          : tone === "purple"
            ? "text-violet-200"
            : "text-white";
  return (
    <div className="min-h-[132px] min-w-0 rounded-md border border-white/15 bg-black/15 backdrop-blur-md p-4 shadow-lg shadow-black/20">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/85">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tracking-tight ${valueClass}`}>
        {value}
      </div>
      {sub ? (
        <div className="mt-2 min-w-0 break-words text-sm leading-snug text-white/70">
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
      <div className="flex h-64 items-center justify-center text-sm text-white/70">
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
          fill="rgba(255,255,255,0.62)"
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
          stroke="rgba(255,255,255,0.14)"
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
        fill="rgba(255,255,255,0.62)"
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
        fill="rgba(255,255,255,0.62)"
        fontSize="10"
        textAnchor="middle"
      >
        {formatWeekDuration(series.length - 1)}
      </text>,
    );
  }

  const endVal = series[series.length - 1];
  const endColor = endVal >= 0 ? "#0e7490" : "#c2410c";
  const principalEnd = principalSeries[principalSeries.length - 1] ?? 0;
  const interestEarned = endVal - principalEnd;
  const visibleEvents = events.filter(
    (event) => event.week > 0 && event.week < series.length,
  );

  return (
    <div className="relative">
      {/* Total above the chart — sits in HTML so it scales independently of
          the SVG and can never collide with the interest endpoint label. */}
      <div className="mb-1 text-center text-sm font-extrabold tracking-tight text-white">
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
          stroke="rgba(255,255,255,0.48)"
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
              stroke="#7e22ce"
              strokeDasharray="6 4"
              strokeWidth="1"
            />
            <text
              x={W - 10}
              y={py(targetCents) - 8}
              fill="#7e22ce"
              fontSize="10"
              fontWeight="700"
              textAnchor="end"
            >
              $1M target
            </text>
          </>
        ) : null}
        {debtFillPath ? <path d={debtFillPath} fill="rgba(194,65,12,0.22)" /> : null}
        {principalFillPath ? (
          <path d={principalFillPath} fill="rgba(15,23,42,0.12)" />
        ) : null}
        {interestFillPath ? (
          <path d={interestFillPath} fill="rgba(14,116,144,0.26)" />
        ) : null}
        {principalPath ? (
          <path
            d={principalPath}
            fill="none"
            stroke="#18181b"
            strokeLinecap="round"
            strokeWidth="2.25"
          />
        ) : null}
        <path d={linePath} fill="none" stroke="#0e7490" strokeWidth="2.5" strokeLinecap="round" />
        {principalTargetIndex >= 0 ? (
          <g>
            <line
              x1={px(principalTargetIndex)}
              y1={PAD.t}
              x2={px(principalTargetIndex)}
              y2={H - PAD.b}
              stroke="#0f172a"
              strokeDasharray="3 4"
              strokeWidth="1"
            />
            <circle
              cx={px(principalTargetIndex)}
              cy={py(targetCents)}
              fill="white"
              r="4"
              stroke="#fff"
              strokeWidth="2"
            />
            <text
              x={px(principalTargetIndex) - 4}
              y={py(targetCents) + 16}
              fill="white"
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
              stroke="#0e7490"
              strokeDasharray="3 4"
              strokeWidth="1"
            />
            <circle
              cx={px(investedTargetIndex)}
              cy={py(targetCents)}
              fill="#0e7490"
              r="4"
              stroke="#fff"
              strokeWidth="2"
            />
            <text
              x={Math.max(PAD.l + 120, px(investedTargetIndex) - 140)}
              y={py(targetCents) - 28}
              fill="#0e7490"
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
              stroke="#0e7490"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
            <text
              x={px(event.week) + 4}
              y={PAD.t + 12}
              fill="#0e7490"
              fontSize="9"
              fontWeight="700"
            >
              {event.name} +{formatMoney(event.freedCents)}/wk
            </text>
          </g>
        ))}
        {/* Now dot */}
        <circle cx={px(0)} cy={py(series[0])} r="4" fill="#c2410c" stroke="#fff" strokeWidth="2" />
        {/* Crossover */}
        {crossIdx > 0 ? (
          <g>
            <circle cx={px(crossIdx)} cy={zero} r="5" fill="#0e7490" stroke="#fff" strokeWidth="2" />
            <text
              x={px(crossIdx)}
              y={zero - 12}
              fill="#0e7490"
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
            • bottom line (slate) → principal end value
            • top line (teal) → interest earned (invested − principal)
            Total label lives in the HTML above the SVG. */}
        {(() => {
          const xEnd = px(series.length - 1);
          const labelX = W - 10;
          const principalLabelOffset = series.length - 1 <= 260 ? 40 : 24;
          return (
            <>
              {/* Principal endpoint dot + label below the dot (slate) */}
              <circle
                cx={xEnd}
                cy={py(principalEnd)}
                r="4"
                fill="#18181b"
                stroke="#fff"
                strokeWidth="2"
              />
              <text
                x={labelX}
                y={py(principalEnd) + principalLabelOffset}
                fill="#18181b"
                fontSize="10"
                fontWeight="700"
                textAnchor="end"
                fontFamily="ui-monospace, monospace"
              >
                {formatMoney(principalEnd)} principal
              </text>

              {/* Invested endpoint dot + interest-earned label above the dot (teal) */}
              <circle
                cx={xEnd}
                cy={py(endVal)}
                r="4"
                fill={endColor}
                stroke="#fff"
                strokeWidth="2"
              />
              <text
                x={labelX}
                y={py(endVal) + 18}
                fill={endColor}
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
      <div className="mt-2 flex items-center justify-between text-xs font-medium text-white/70">
        <span className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4 bg-zinc-950" /> Principal only
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4 bg-[#0e7490]" /> Invested at 10%
          </span>
        </span>
        <span className="text-white/70">
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

  return (
    <div className="grid gap-3">
      {activeDebts.map((debt, index) => (
        <div key={debt.id} className="grid gap-2 sm:grid-cols-[180px_1fr_96px] sm:items-center">
          <div className="text-sm font-medium text-white">{debt.name}</div>
          <div className="h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#0e7490]"
              style={{
                opacity: Math.max(0.35, 1 - index * 0.07),
                width: `${Math.max(2, (debt.balanceCents / max) * 100)}%`,
              }}
            />
          </div>
          <div className="text-right text-sm font-semibold text-emerald-300">
            {formatMoney(debt.balanceCents)}
          </div>
        </div>
      ))}
    </div>
  );
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


