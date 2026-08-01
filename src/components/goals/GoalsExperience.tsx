"use client";

import { useMemo, useState } from "react";

import type { GoalsData } from "@/lib/goals/data";
import {
  ASSUMPTION_SOURCES,
  DEFAULT_ASSUMPTIONS,
  type GoalStep,
  type HouseHackAssumptions,
  buildLadder,
} from "@/lib/goals/ladder";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatMoney(cents: number): string {
  return money.format(cents / 100);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00.000Z`));
}

function formatHorizon(weeks: number): string {
  if (weeks < 8) return `${weeks} wk`;
  const months = Math.round(weeks / 4.345);
  if (months < 24) return `${months} mo`;
  return `${(weeks / 52).toFixed(1)} yr`;
}

export function GoalsExperience({ data }: { data: GoalsData }) {
  const [override, setOverride] = useState<number | null>(null);
  const [assumptions, setAssumptions] = useState<HouseHackAssumptions>(
    DEFAULT_ASSUMPTIONS,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const weeklyCents = override ?? data.medianWeeklyCashflowCents;

  const goals = useMemo(
    () =>
      buildLadder({
        explorerCents: data.explorerCents,
        teslaCents: data.teslaCents,
        bankedCents: data.bankedCents,
        weeklyCashflowCents: weeklyCents,
        assumptions,
        todayIso: data.todayIso,
      }),
    [data, weeklyCents, assumptions],
  );

  const maxTarget = Math.max(1, ...goals.map((goal) => goal.targetCents));
  const totalRemaining = goals.reduce((sum, g) => sum + g.remainingCents, 0);
  // Rung one renders at the BOTTOM, so the ladder is climbed upward.
  const topDown = [...goals].sort((a, b) => b.order - a.order);

  return (
    <main className="min-h-screen px-4 py-6 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <section className="mx-auto max-w-4xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
            Bashflow
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Goals</h1>
          <p className="mt-1.5 max-w-xl text-sm text-[var(--text-tertiary)]">
            One objective at a time, funded by cashflow. Each rung unlocks the
            one above it.
          </p>
        </header>

        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-5 shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <CashflowControl
              medianCents={data.medianWeeklyCashflowCents}
              onChange={setOverride}
              override={override}
              weeklyCents={weeklyCents}
            />
            <div className="flex gap-5">
              <Stat label="Banked" value={formatMoney(data.bankedCents)} />
              <Stat label="Still needed" value={formatMoney(totalRemaining)} />
              <Stat label={data.weekLabel} value={`${goals.length} rungs`} />
            </div>
          </div>

          <ol className="relative">
            {/* The spine, drawn behind the rungs. */}
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-8 left-[27px] top-8 w-px bg-[var(--border-subtle)]"
            />
            {topDown.map((goal) => (
              <GoalRung
                goal={goal}
                isOpen={openId === goal.id}
                key={goal.id}
                maxTarget={maxTarget}
                onToggle={() =>
                  setOpenId((current) => (current === goal.id ? null : goal.id))
                }
              />
            ))}
          </ol>

          <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
            <button
              className="text-xs font-semibold text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
              onClick={() => setShowAssumptions((v) => !v)}
              type="button"
            >
              {showAssumptions ? "Hide" : "Show"} house-hack assumptions
            </button>
            {showAssumptions ? (
              <AssumptionEditor
                assumptions={assumptions}
                onChange={setAssumptions}
              />
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}

function CashflowControl({
  medianCents,
  onChange,
  override,
  weeklyCents,
}: {
  medianCents: number;
  onChange: (value: number | null) => void;
  override: number | null;
  weeklyCents: number;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Weekly cashflow applied
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-[var(--text-tertiary)]">$</span>
        <input
          className="h-9 w-28 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 text-lg font-semibold tabular-nums text-[var(--text-primary)] outline-none focus:border-[var(--accent-brand-border)]"
          inputMode="numeric"
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange(Number.isFinite(parsed) && parsed > 0 ? parsed * 100 : null);
          }}
          type="number"
          value={Math.round(weeklyCents / 100)}
        />
        {override === null ? (
          <span className="text-xs text-[var(--text-muted)]">
            median of {formatMoney(medianCents)}/wk this year
          </span>
        ) : (
          <button
            className="text-xs font-semibold text-[var(--accent-brand-text)] hover:underline"
            onClick={() => onChange(null)}
            type="button"
          >
            reset to median
          </button>
        )}
      </div>
    </div>
  );
}

function GoalRung({
  goal,
  isOpen,
  maxTarget,
  onToggle,
}: {
  goal: GoalStep;
  isOpen: boolean;
  maxTarget: number;
  onToggle: () => void;
}) {
  const active = goal.status === "active";
  const complete = goal.status === "complete";
  const locked = goal.status === "locked";
  // Bar length is the goal's COST relative to the biggest rung, so the ladder
  // shows at a glance which objective is the heavy one.
  const widthPct = Math.max(6, (goal.targetCents / maxTarget) * 100);

  return (
    <li className="group relative pl-[70px]">
      {/* Node + artwork slot */}
      <span
        className={`absolute left-0 top-4 z-10 flex h-[54px] w-[54px] items-center justify-center overflow-hidden rounded-xl border transition-all duration-200 ${
          active
            ? "border-[var(--accent-brand-border)] shadow-[0_0_24px_-6px_var(--accent-brand)]"
            : complete
              ? "border-[var(--accent-primary-border)]"
              : "border-[var(--border-subtle)]"
        } bg-[var(--surface-elevated)] ${locked ? "opacity-45" : ""}`}
      >
        <GoalArtwork goal={goal} />
      </span>

      <button
        aria-expanded={isOpen}
        className={`w-full rounded-xl border px-3 py-3 text-left outline-none transition-all duration-200 ${
          active
            ? "border-[var(--accent-brand-border)] bg-[var(--surface-elevated)]"
            : "border-transparent hover:border-[var(--border-default)] hover:bg-[var(--surface-elevated)]"
        } ${locked ? "opacity-60 hover:opacity-100" : ""}`}
        onClick={onToggle}
        type="button"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {goal.kicker}
            </span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {goal.title}
            </span>
          </span>
          <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
            {formatMoney(goal.targetCents)}
          </span>
        </div>

        {/* Cost bar. Width = relative cost, fill = progress toward it. */}
        <div className="mt-2 h-2.5 w-full">
          <div
            className={`relative h-full overflow-hidden rounded-full border transition-all duration-200 ${
              active
                ? "border-[rgba(255,255,255,0.45)] group-hover:shadow-[0_0_18px_-4px_rgba(255,255,255,0.6)]"
                : "border-[rgba(255,255,255,0.18)]"
            }`}
            style={{ width: `${widthPct}%` }}
          >
            <span
              className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${
                complete
                  ? "bg-[var(--accent-primary)]"
                  : "bg-[rgba(255,255,255,0.9)]"
              }`}
              style={{
                width: `${Math.max(0, Math.min(100, goal.progress * 100))}%`,
                boxShadow: active ? "0 0 16px rgba(255,255,255,0.55)" : undefined,
              }}
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
          <span className="tabular-nums">
            {formatMoney(goal.fundedCents)} of {formatMoney(goal.targetCents)}
          </span>
          {complete ? (
            <span className="font-semibold text-[var(--accent-primary-text)]">
              Cleared
            </span>
          ) : goal.weeksAway === null ? (
            <span className="text-[var(--accent-warning-text)]">
              No cashflow — set a weekly number
            </span>
          ) : (
            <span className="font-semibold text-[var(--text-tertiary)]">
              {formatHorizon(goal.weeksAway)} away
              {goal.etaIso ? ` · ${formatDate(goal.etaIso)}` : ""}
            </span>
          )}
          {goal.deadlineIso ? (
            <span
              className={
                goal.missesDeadline
                  ? "font-semibold text-[var(--accent-negative-text)]"
                  : ""
              }
            >
              {goal.deadlineLabel} {formatDate(goal.deadlineIso)}
              {goal.missesDeadline ? " — projected to miss" : ""}
            </span>
          ) : null}
          <span className="ml-auto text-[var(--text-muted)]">
            {isOpen ? "Hide detail" : "Detail"}
          </span>
        </div>

        <div
          className={`grid transition-all duration-300 ${
            isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <p className="pt-3 text-sm leading-6 text-[var(--text-secondary)]">
              {goal.description}
            </p>
            <dl className="mt-3 space-y-1.5">
              {goal.components.map((component) => (
                <div
                  className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-[var(--border-subtle)] pt-1.5 text-xs"
                  key={component.label}
                >
                  <dt className="font-semibold text-[var(--text-secondary)]">
                    {component.label}
                    <span className="ml-2 font-normal text-[var(--text-muted)]">
                      {component.note}
                    </span>
                  </dt>
                  <dd className="tabular-nums text-[var(--text-primary)]">
                    {formatMoney(component.cents)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </button>
    </li>
  );
}

/**
 * Artwork slot. Jon supplies the images; until a file exists at the goal's
 * path the tile falls back to its rung number rather than a broken image.
 */
function GoalArtwork({ goal }: { goal: GoalStep }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="text-lg font-semibold text-[var(--text-muted)]">
        {goal.order}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      className="h-full w-full object-cover"
      onError={() => setFailed(true)}
      src={goal.imageSrc}
    />
  );
}

function AssumptionEditor({
  assumptions,
  onChange,
}: {
  assumptions: HouseHackAssumptions;
  onChange: (value: HouseHackAssumptions) => void;
}) {
  const set = (patch: Partial<HouseHackAssumptions>) =>
    onChange({ ...assumptions, ...patch });

  return (
    <div className="mt-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Property price"
          onChange={(v) => set({ propertyPriceCents: v * 100 })}
          prefix="$"
          value={Math.round(assumptions.propertyPriceCents / 100)}
        />
        <Field
          label="Down payment"
          onChange={(v) => set({ downPaymentPct: v })}
          step={0.5}
          suffix="%"
          value={assumptions.downPaymentPct}
        />
        <Field
          label="Closing costs"
          onChange={(v) => set({ closingCostPct: v })}
          step={0.5}
          suffix="%"
          value={assumptions.closingCostPct}
        />
        <Field
          label="Reserve months"
          onChange={(v) => set({ reserveMonths: v })}
          value={assumptions.reserveMonths}
        />
        <Field
          label="Monthly PITI"
          onChange={(v) => set({ monthlyPitiCents: v * 100 })}
          prefix="$"
          value={Math.round(assumptions.monthlyPitiCents / 100)}
        />
        <button
          className="self-end rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs font-semibold text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)]"
          onClick={() => onChange(DEFAULT_ASSUMPTIONS)}
          type="button"
        >
          Reset to researched defaults
        </button>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
        {ASSUMPTION_SOURCES.map((source) => (
          <li key={source}>· {source}</li>
        ))}
      </ul>
    </div>
  );
}

function Field({
  label,
  onChange,
  prefix,
  step,
  suffix,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  prefix?: string;
  step?: number;
  suffix?: string;
  value: number;
}) {
  return (
    <label className="block">
      <span className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </span>
      <span className="mt-1 flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2">
        {prefix ? (
          <span className="text-xs text-[var(--text-tertiary)]">{prefix}</span>
        ) : null}
        <input
          className="h-9 w-full bg-transparent text-sm font-semibold tabular-nums text-[var(--text-primary)] outline-none"
          inputMode="decimal"
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed);
          }}
          step={step ?? 1}
          type="number"
          value={value}
        />
        {suffix ? (
          <span className="text-xs text-[var(--text-tertiary)]">{suffix}</span>
        ) : null}
      </span>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}
