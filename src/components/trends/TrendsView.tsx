"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import {
  saveEvChargingAction,
  type SaveEvChargingInput,
} from "@/app/(protected)/trends/ev-actions";
import { centsToDollars } from "@/lib/domain/money";
import type {
  TrendsData,
  TrendsEvCharging,
  TrendsGasTracker,
  TrendsWeek,
} from "@/lib/trends/data";

type RangeKey = "12w" | "ytd" | "all" | "custom";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "12w", label: "12W" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
  { key: "custom", label: "Custom" },
];

const TARGET_LINE_CENTS = 100_000; // $1,000 reference line
const CONFETTI_CENTS = 150_000; // $1,500+ weeks get confetti

// Continuous hue: full green at >= $950, yellow at $650, full red at <= $0.
const GREEN = [22, 163, 74];
const YELLOW = [245, 158, 11];
const RED = [220, 38, 38];

function cashflowHue(cents: number): string {
  const v = cents / 100;
  if (v >= 950) return rgb(GREEN);
  if (v >= 650) return rgb(mix(GREEN, YELLOW, (950 - v) / 300));
  if (v >= 0) return rgb(mix(YELLOW, RED, (650 - v) / 650));
  return rgb(RED);
}

const CONFETTI_COLORS = [
  "#f472b6",
  "#38bdf8",
  "#a78bfa",
  "#fbbf24",
  "#34d399",
  "#f87171",
];

// Deterministic pseudo-random so confetti doesn't shimmer between renders.
function pseudo(i: number, k: number): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function ConfettiBurst({
  cx,
  topY,
  seed,
  spread,
}: {
  cx: number;
  topY: number;
  seed: number;
  spread: number;
}) {
  const pieces = Array.from({ length: 14 }, (_, k) => {
    const x = cx + (pseudo(seed, k) - 0.5) * spread * 2.2;
    const y = topY - 6 - pseudo(seed, k + 20) * 22;
    const rot = Math.round(pseudo(seed, k + 40) * 360);
    const color = CONFETTI_COLORS[k % CONFETTI_COLORS.length];
    return { x, y, rot, color, key: k };
  });

  return (
    <g>
      {pieces.map((p) => (
        <rect
          fill={p.color}
          height={5.5}
          key={p.key}
          opacity={0.9}
          rx={1}
          transform={`rotate(${p.rot} ${p.x} ${p.y})`}
          width={2.6}
          x={p.x}
          y={p.y}
        />
      ))}
    </g>
  );
}

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((c, i) => Math.round(c + (b[i] - c) * t));
}

function rgb(c: number[]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function TrendsView({ initialData }: { initialData: TrendsData }) {
  const [range, setRange] = useState<RangeKey>("ytd");
  const [customWeeks, setCustomWeeks] = useState(10);

  const weeks = useMemo(
    () => filterByRange(initialData.weeks, range, customWeeks),
    [initialData.weeks, range, customWeeks],
  );

  const stats = useMemo(() => {
    const values = weeks.map((w) => w.cashflowCents);
    const total = values.reduce((a, b) => a + b, 0);
    return {
      count: values.length,
      total,
      median: median(values),
      average: values.length ? Math.round(total / values.length) : 0,
    };
  }, [weeks]);

  return (
    <main className="min-h-screen px-4 py-6 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <section className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
              Bashflow
            </p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Trends</h1>
            <p className="mt-1.5 text-sm text-[var(--text-tertiary)]">
              How your weekly cashflow moves over time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RangeSelector range={range} onChange={setRange} />
            {range === "custom" ? (
              <div className="flex items-center gap-1.5">
                <input
                  className="h-9 w-16 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-2 text-center text-sm font-semibold text-[var(--text-primary)] outline-none backdrop-blur-md focus:border-[var(--border-default)]"
                  inputMode="numeric"
                  max={53}
                  min={2}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isInteger(parsed)) {
                      setCustomWeeks(Math.min(53, Math.max(2, parsed)));
                    }
                  }}
                  type="number"
                  value={customWeeks}
                />
                <span className="text-xs font-semibold text-[var(--text-tertiary)]">wks</span>
              </div>
            ) : null}
          </div>
        </header>

        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-5 shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Weekly cashflow
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                Earnings minus spending minus fixed, per week.
              </p>
            </div>
            <div className="flex gap-5">
              <Stat label="Total" value={formatMoney(stats.total)} />
              <Stat label="Median" value={formatMoney(stats.median)} />
              <Stat label="Average" value={formatMoney(stats.average)} />
              <Stat label="Weeks" value={String(stats.count)} />
            </div>
          </div>

          {weeks.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--text-tertiary)]">
              No weeks in this range yet.
            </div>
          ) : (
            <WeeklyCashflowChart weeks={weeks} medianCents={stats.median} />
          )}

          <GasTracker
            archived={initialData.evCharging.settings.gasArchived}
            tracker={initialData.gasTracker}
          />
          <EvChargingTracker tracker={initialData.evCharging} />
        </section>
      </section>
    </main>
  );
}

function GasTracker({
  archived,
  tracker,
}: {
  archived: boolean;
  tracker: TrendsGasTracker;
}) {
  const isActive = tracker.status === "active";

  return (
    <section className="mt-5 border-t border-[var(--border-subtle)] pt-5">
      {archived ? (
        <div className="mb-3 flex justify-end">
          <span className="rounded-full border border-[var(--border-default)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Archived
          </span>
        </div>
      ) : null}
      {isActive ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
          <div className="grid grid-cols-2 divide-x divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
            <GasAverageMetric
              label="Total average"
              valueCents={tracker.averageDailyGasCents}
            />
            <GasAverageMetric
              accent
              label="Rolling 7 day average"
              valueCents={tracker.last7d.avgPerDayCents}
            />
          </div>
          <div className="grid grid-cols-2 divide-x divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
            <GasMetric
              label="30 day average"
              value={`${formatMoney(tracker.last30d.avgPerDayCents)}/d`}
            />
            <GasMetric
              label="Avg fill up"
              value={formatMoney(tracker.last30d.avgPerFillCents)}
            />
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent-brand-text)]">
            Gas averages
          </p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-4xl">
            Waiting for a fill
          </h2>
          <p className="mt-1.5 max-w-xl text-sm text-[var(--text-tertiary)]">
            Tag your next fill as Gas. It becomes the anchor for the daily set aside.
          </p>
        </div>
      )}

      {isActive ? (
        <>
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            {formatMoney(tracker.gasAmountCents)} spread across {tracker.periodDays} days since{" "}
            {shortDate(tracker.periodStartDate)}. Latest source: {tracker.merchantName}.
          </p>
          <details className="group mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-[var(--text-secondary)] marker:hidden">
              <span>Fill-up history</span>
              <span className="text-xs font-medium text-[var(--text-muted)] group-open:hidden">
                {tracker.fills.length} tagged fills
              </span>
              <span className="hidden text-xs font-medium text-[var(--text-muted)] group-open:inline">
                Hide history
              </span>
            </summary>
            <div className="border-t border-[var(--border-subtle)] px-3 py-1">
              {tracker.fills.map((fill) => (
                <div
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-b-0"
                  key={fill.id}
                >
                  <span className="text-xs font-semibold text-[var(--text-tertiary)]">
                    {shortDate(fill.fillDate)}
                  </span>
                  <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {fill.merchantName}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                    {formatMoney(fill.gasAmountCents)}
                  </span>
                </div>
              ))}
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}

function GasAverageMetric({
  accent = false,
  label,
  valueCents,
}: {
  accent?: boolean;
  label: string;
  valueCents: number;
}) {
  return (
    <div className="min-w-0 px-3 py-3.5 sm:px-4">
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] sm:text-[0.65rem]">
        {label}
      </div>
      <div
        className={`mt-1 flex flex-wrap items-baseline gap-x-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl lg:text-3xl ${
          accent ? "text-[var(--accent-brand-text)]" : "text-[var(--text-primary)]"
        }`}
      >
        <span>{formatMoney(valueCents)}</span>
        <span className="text-[0.65em] font-medium text-[var(--text-tertiary)]">/ day</span>
      </div>
    </div>
  );
}

function GasMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5 text-right first:pl-3 last:pr-3">
      <div className="whitespace-nowrap text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 whitespace-nowrap text-sm font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

function EvChargingTracker({ tracker }: { tracker: TrendsEvCharging }) {
  const router = useRouter();
  const [draft, setDraft] = useState<SaveEvChargingInput>({
    weekId: tracker.weekId ?? "",
    milesDriven: tracker.milesDriven,
    ...tracker.settings,
  });
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const canSave = Boolean(draft.weekId);
  const progressDenominator = Math.max(
    tracker.milesDriven,
    tracker.freeRangeMiles,
    1,
  );
  const freeProgress =
    (Math.min(tracker.milesDriven, tracker.freeRangeMiles) /
      progressDenominator) *
    100;
  const paidProgress =
    (tracker.paidMiles / progressDenominator) * 100;

  function setNumber(
    field: Exclude<
      keyof SaveEvChargingInput,
      "weekId" | "gasArchived"
    >,
    value: string,
  ) {
    const parsed = Number(value);
    setSaveState("idle");
    setDraft((current) => ({
      ...current,
      [field]: Number.isFinite(parsed) ? parsed : 0,
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || saveState === "saving") {
      return;
    }

    setSaveState("saving");
    try {
      await saveEvChargingAction(draft);
      setSaveState("saved");
      router.refresh();
    } catch {
      setSaveState("error");
    }
  }

  return (
    <section className="mt-5 border-t border-[var(--border-subtle)] pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ZapIcon />
            <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
              Charging — Onyx
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            This week&apos;s free worksite charging against paid miles.
          </p>
        </div>
        {tracker.usesTypicalMiles ? (
          <span className="rounded-full border border-[var(--border-default)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Typical miles
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Blended cost
          </div>
          <div className="mt-1 flex items-baseline gap-1 font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">
            <span className="text-4xl sm:text-5xl">
              {tracker.blendedCentsPerMile}
            </span>
            <span className="text-sm text-[var(--text-tertiary)]">¢/mi</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-base)] p-2.5">
              <div className="text-[var(--text-muted)]">Free miles</div>
              <div className="mt-1 font-semibold tabular-nums text-[var(--text-primary)]">
                {formatMiles(tracker.freeMilesUsed)}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-base)] p-2.5">
              <div className="text-[var(--text-muted)]">Paid miles</div>
              <div className="mt-1 font-semibold tabular-nums text-[var(--text-primary)]">
                {formatMiles(tracker.paidMiles)}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <EvStat label="Free ceiling" value={`${formatMiles(tracker.freeRangeMiles)} / wk`} />
          <EvStat label="Miles driven" value={formatMiles(tracker.milesDriven)} />
          <EvStat label="Free unused" value={formatMiles(tracker.freeMilesUnused)} />
          <EvStat label="Weekly cost" value={formatMoney(tracker.weeklyCostCents)} />
          <EvStat label="Monthly cost" value={formatMoney(tracker.monthlyCostCents)} />
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Breakeven: {formatMiles(tracker.breakevenMilesPerWeek)} mi/wk
          </p>
          <p className="text-xs text-[var(--text-tertiary)]">
            Every mile over costs Supercharger rates.
          </p>
        </div>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--surface-base)]">
          <div
            className="bg-[var(--accent-brand)]"
            style={{ width: `${freeProgress}%` }}
          />
          {paidProgress > 0 ? (
            <div
              className="bg-[var(--accent-negative)]"
              style={{ width: `${paidProgress}%` }}
            />
          ) : null}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-medium tabular-nums text-[var(--text-muted)]">
          <span>{formatMiles(tracker.milesDriven)} mi this week</span>
          <span>{formatMiles(tracker.freeRangeMiles)} mi free ceiling</span>
        </div>
      </div>

      <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-3">
        <EvCompare
          label="Explorer gas"
          value={`${tracker.explorerCentsPerMile}¢/mi`}
        />
        <EvCompare
          label="Onyx home"
          value={`${tracker.homeCentsPerMile}¢/mi`}
        />
        <EvCompare
          label="Onyx Supercharger"
          value={`${tracker.paidCentsPerMile}¢/mi`}
        />
      </div>

      <details className="group mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-semibold text-[var(--text-secondary)] marker:hidden">
          <span>Edit inputs</span>
          <span className="text-xs font-medium text-[var(--text-muted)]">
            {saveState === "saving"
              ? "Saving..."
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Save failed"
                  : "Miles, rates, charging"}
          </span>
        </summary>
        <form
          className="border-t border-[var(--border-subtle)] p-3"
          onSubmit={save}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <EvNumberInput
              label="Miles this week"
              value={draft.milesDriven}
              onChange={(value) => setNumber("milesDriven", value)}
            />
            <EvNumberInput
              label="Typical miles / week"
              value={draft.typicalMilesPerWeek}
              onChange={(value) => setNumber("typicalMilesPerWeek", value)}
            />
            <EvNumberInput
              label="Efficiency Wh / mi"
              value={draft.efficiencyWhPerMile}
              onChange={(value) => setNumber("efficiencyWhPerMile", value)}
            />
            <EvNumberInput
              label="Free hours / week"
              value={draft.freeHoursPerWeek}
              onChange={(value) => setNumber("freeHoursPerWeek", value)}
            />
            <EvNumberInput
              label="Free mi / hour"
              value={draft.freeMilesPerHour}
              onChange={(value) => setNumber("freeMilesPerHour", value)}
            />
            <EvNumberInput
              label="Charging loss %"
              value={draft.chargingLossPercent}
              onChange={(value) => setNumber("chargingLossPercent", value)}
            />
            <EvNumberInput
              label="Home rate ¢ / kWh"
              value={draft.homeRateCentsPerKwh}
              onChange={(value) => setNumber("homeRateCentsPerKwh", value)}
            />
            <EvNumberInput
              label="Public rate ¢ / kWh"
              value={draft.publicRateCentsPerKwh}
              onChange={(value) => setNumber("publicRateCentsPerKwh", value)}
            />
            <EvNumberInput
              label="Explorer MPG"
              value={draft.explorerMpg}
              onChange={(value) => setNumber("explorerMpg", value)}
            />
            <EvNumberInput
              label="Gas price ¢ / gal"
              value={draft.gasPricePerGallonCents}
              onChange={(value) => setNumber("gasPricePerGallonCents", value)}
            />
          </div>
          <label className="mt-3 flex min-h-10 items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-base)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            <span>
              Archive gas line
              <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                Hide the dashboard spread; keep gas history.
              </span>
            </span>
            <input
              checked={draft.gasArchived}
              className="h-4 w-4 accent-[var(--accent-brand)]"
              onChange={(event) => {
                setSaveState("idle");
                setDraft((current) => ({
                  ...current,
                  gasArchived: event.target.checked,
                }));
              }}
              type="checkbox"
            />
          </label>
          <div className="mt-3 flex items-center justify-end gap-3">
            {saveState === "error" ? (
              <span className="text-xs font-medium text-[var(--accent-negative-text)]">
                Could not save. Apply the EV migration, then retry.
              </span>
            ) : null}
            <button
              className="min-h-9 rounded-md bg-[var(--accent-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSave || saveState === "saving"}
              type="submit"
            >
              {saveState === "saving" ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </details>
    </section>
  );
}

function ZapIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-[var(--accent-brand-text)]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  );
}

function EvStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-3">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 truncate text-base font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

function EvCompare({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 bg-[var(--surface-elevated)] px-3 py-2.5 sm:block sm:text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums text-[var(--text-primary)] sm:mt-1">
        {value}
      </div>
    </div>
  );
}

function EvNumberInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: number;
}) {
  return (
    <label className="block text-xs font-medium text-[var(--text-tertiary)]">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-base)] px-3 text-sm tabular-nums text-[var(--text-primary)] outline-none focus:border-[var(--accent-brand)] focus:ring-2 focus:ring-[var(--accent-ring)]"
        inputMode="decimal"
        min={0}
        onChange={(event) => onChange(event.target.value)}
        step="any"
        type="number"
        value={value}
      />
    </label>
  );
}

function RangeSelector({
  range,
  onChange,
}: {
  range: RangeKey;
  onChange: (range: RangeKey) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-1 backdrop-blur-md">
      {RANGES.map((option) => (
        <button
          key={option.key}
          className={[
            "rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
            range === option.key
              ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
          ].join(" ")}
          onClick={() => onChange(option.key)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

const VBW = 1000;
const VBH = 280;
const PAD_TOP = 34;
const PAD_BOTTOM = 28;

function WeeklyCashflowChart({
  weeks,
  medianCents,
}: {
  weeks: TrendsWeek[];
  medianCents: number;
}) {
  const router = useRouter();
  const maxPos = Math.max(
    TARGET_LINE_CENTS,
    ...weeks.map((w) => w.cashflowCents),
  );
  const maxNeg = Math.max(0, ...weeks.map((w) => -w.cashflowCents));
  const total = maxPos + maxNeg || 1;
  const plotH = VBH - PAD_TOP - PAD_BOTTOM;
  const zeroY = PAD_TOP + (maxPos / total) * plotH;
  const slot = VBW / weeks.length;
  const barW = Math.min(slot * 0.6, 46);
  const labelEvery = Math.ceil(weeks.length / 12);
  const targetY = yFor(TARGET_LINE_CENTS, zeroY, maxPos, maxNeg, plotH);

  return (
    <div className="w-full">
      <svg
        className="w-full"
        preserveAspectRatio="none"
        style={{ height: 280 }}
        viewBox={`0 0 ${VBW} ${VBH}`}
      >
        {/* zero baseline */}
        <line
          className="stroke-[var(--chart-zero)]"
          strokeWidth={1}
          x1={0}
          x2={VBW}
          y1={zeroY}
          y2={zeroY}
        />
        {/* $1,000 target line */}
        <line
          className="stroke-[var(--chart-axis)]"
          strokeWidth={1.25}
          x1={0}
          x2={VBW}
          y1={targetY}
          y2={targetY}
        />
        <text
          className="fill-[var(--chart-axis)]"
          fontSize={11}
          x={6}
          y={targetY - 5}
        >
          $1,000
        </text>
        {/* median guide */}
        {medianCents !== 0 ? (
          <line
            className="stroke-[var(--chart-grid)]"
            strokeDasharray="4 5"
            strokeWidth={1}
            x1={0}
            x2={VBW}
            y1={yFor(medianCents, zeroY, maxPos, maxNeg, plotH)}
            y2={yFor(medianCents, zeroY, maxPos, maxNeg, plotH)}
          />
        ) : null}

        {weeks.map((week, i) => {
          const cx = i * slot + slot / 2;
          const fill = cashflowHue(week.cashflowCents);
          const valueY = yFor(week.cashflowCents, zeroY, maxPos, maxNeg, plotH);
          const barH = Math.max(1, Math.abs(valueY - zeroY));
          const barY = week.cashflowCents >= 0 ? valueY : zeroY;

          return (
            <g
              className="cursor-pointer"
              key={week.weekId}
              onClick={() => router.push(`/history/${week.weekId}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  router.push(`/history/${week.weekId}`);
                }
              }}
              role="link"
              tabIndex={0}
            >
              {/* full-column transparent hit area so the whole week is clickable */}
              <rect fill="transparent" height={VBH} width={slot} x={i * slot} y={0} />
              <rect
                fill={fill}
                height={barH}
                opacity={week.status === "active" ? 0.55 : 1}
                rx={3}
                width={barW}
                x={cx - barW / 2}
                y={barY}
              >
                <title>{`${week.startDate} · ${formatMoney(week.cashflowCents)} — open week`}</title>
              </rect>
              {week.cashflowCents >= CONFETTI_CENTS ? (
                <ConfettiBurst cx={cx} seed={i + 1} spread={barW} topY={valueY} />
              ) : null}
              {i % labelEvery === 0 ? (
                <text
                  className="fill-[var(--chart-axis)]"
                  fontSize={11}
                  textAnchor="middle"
                  x={cx}
                  y={VBH - 9}
                >
                  {shortDate(week.startDate)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[var(--text-tertiary)]">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-16 rounded-sm"
            style={{
              background:
                "linear-gradient(90deg, rgb(220,38,38) 0%, rgb(245,158,11) 65%, rgb(22,163,74) 100%)",
            }}
          />
          $0 → $650 → $950+
        </span>
        <span className="text-[var(--text-muted)]">
          Solid line = $1,000 · dashed = median · faded = current week · confetti = $1,500+
        </span>
      </div>
    </div>
  );
}

function yFor(
  cents: number,
  zeroY: number,
  maxPos: number,
  maxNeg: number,
  plotH: number,
): number {
  if (cents >= 0) {
    const span = (maxPos / (maxPos + maxNeg || 1)) * plotH || 1;
    return zeroY - (maxPos ? (cents / maxPos) * span : 0);
  }
  const span = (maxNeg / (maxPos + maxNeg || 1)) * plotH || 1;
  return zeroY + (maxNeg ? (-cents / maxNeg) * span : 0);
}

function filterByRange(
  weeks: TrendsWeek[],
  range: RangeKey,
  customWeeks: number,
): TrendsWeek[] {
  if (range === "all") {
    return weeks;
  }
  if (range === "ytd") {
    const latest = weeks.at(-1)?.startDate;
    const year = latest ? latest.slice(0, 4) : "2026";
    return weeks.filter((w) => w.startDate >= `${year}-01-01`);
  }
  const n = range === "12w" ? 12 : customWeeks;
  return weeks.slice(-n);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(centsToDollars(cents));
}

function formatMiles(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00.000Z`));
}
