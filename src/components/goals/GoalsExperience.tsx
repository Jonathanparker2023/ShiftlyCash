"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  addGoalRungAction,
  removeGoalRungAction,
  reorderGoalRungsAction,
  updateGoalRungAction,
} from "@/app/(protected)/goals/actions";
import type { GoalsData } from "@/lib/goals/data";
import { canonicalText, commitFromText } from "@/lib/goals/numberField";
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
  const router = useRouter();
  const [override, setOverride] = useState<number | null>(null);
  // Seeds from the live Plaid checking + savings balance — actual money on
  // hand. Deliberately NOT the year's running balance, which is cumulative
  // cashflow already spent and once made a rung read "Cleared" while the debt
  // behind it was still owed. Null means "follow the live balance".
  const [capitalOverride, setCapitalOverride] = useState<number | null>(null);
  const startingCapitalCents = capitalOverride ?? data.availableCashCents;
  const [assumptions, setAssumptions] = useState<HouseHackAssumptions>(
    DEFAULT_ASSUMPTIONS,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [busy, setBusy] = useState(false);

  const weeklyCents = override ?? data.medianWeeklyCashflowCents;

  const goals = useMemo(
    () =>
      buildLadder({
        rungs: data.rungs,
        debts: data.debts,
        appliedCapitalCents: startingCapitalCents,
        weeklyCashflowCents: weeklyCents,
        assumptions,
        todayIso: data.todayIso,
      }),
    [data, weeklyCents, assumptions, startingCapitalCents],
  );

  const maxTarget = Math.max(1, ...goals.map((g) => g.resolvedTargetCents));
  const totalRemaining = goals.reduce((sum, g) => sum + g.remainingCents, 0);
  // Rung one renders at the BOTTOM, so the ladder is climbed upward.
  const topDown = [...goals].reverse();

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, direction: -1 | 1) {
    const ids = goals.map((g) => g.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => reorderGoalRungsAction({ orderedIds: ids }));
  }

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
            <div className="flex flex-wrap items-end gap-5">
              <NumberControl
                hint={
                  override === null
                    ? `median of ${formatMoney(data.medianWeeklyCashflowCents)}/wk this year`
                    : "custom"
                }
                label="Weekly cashflow applied"
                onChange={(cents) => setOverride(cents)}
                onReset={override === null ? undefined : () => setOverride(null)}
                valueCents={weeklyCents}
              />
              <NumberControl
                hint={
                  data.cashBalanceSource === "unavailable"
                    ? "bank balance unavailable — type what you're putting in"
                    : data.cashBalanceStale
                      ? "last known bank balance"
                      : "live bank balance"
                }
                label="Starting capital"
                onChange={(cents) => setCapitalOverride(cents)}
                onReset={
                  capitalOverride === null
                    ? undefined
                    : () => setCapitalOverride(null)
                }
                resetLabel="use bank balance"
                valueCents={startingCapitalCents}
              />
            </div>
            <div className="flex gap-5">
              <Stat label="Still needed" value={formatMoney(totalRemaining)} />
              <Stat label={data.weekLabel} value={`${goals.length} rungs`} />
            </div>
          </div>

          {goals.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--text-tertiary)]">
              No goals yet. Add the first rung below.
            </p>
          ) : (
            <ol className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-8 left-[27px] top-8 w-px bg-[var(--border-subtle)]"
              />
              {topDown.map((goal) => {
                const index = goals.findIndex((g) => g.id === goal.id);
                return (
                  <GoalRung
                    busy={busy}
                    goal={goal}
                    isEditing={editingId === goal.id}
                    isFirst={index === 0}
                    isLast={index === goals.length - 1}
                    isOpen={openId === goal.id}
                    key={goal.id}
                    maxTarget={maxTarget}
                    onEdit={() =>
                      setEditingId((cur) => (cur === goal.id ? null : goal.id))
                    }
                    onMoveDown={() => move(index, -1)}
                    onMoveUp={() => move(index, 1)}
                    onRemove={() =>
                      run(() => removeGoalRungAction({ rungId: goal.id }))
                    }
                    onSave={(patch) =>
                      run(() =>
                        updateGoalRungAction({ rungId: goal.id, ...patch }),
                      ).then(() => setEditingId(null))
                    }
                    onToggle={() =>
                      setOpenId((cur) => (cur === goal.id ? null : goal.id))
                    }
                  />
                );
              })}
            </ol>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-[var(--border-subtle)] pt-4">
            <button
              className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)] disabled:opacity-50"
              disabled={busy}
              onClick={() => run(addGoalRungAction)}
              type="button"
            >
              + Add a rung
            </button>
            <button
              className="text-xs font-semibold text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
              onClick={() => setShowAssumptions((v) => !v)}
              type="button"
            >
              {showAssumptions ? "Hide" : "Show"} house-hack assumptions
            </button>
          </div>
          {showAssumptions ? (
            <AssumptionEditor
              assumptions={assumptions}
              onChange={setAssumptions}
            />
          ) : null}
        </section>
      </section>
    </main>
  );
}

function NumberControl({
  hint,
  label,
  onChange,
  onReset,
  resetLabel = "reset to median",
  valueCents,
}: {
  hint: string;
  label: string;
  /** null means the field was emptied -- distinct from a typed zero. */
  onChange: (cents: number | null) => void;
  onReset?: () => void;
  resetLabel?: string;
  valueCents: number;
}) {
  // The input holds its own text while being edited so the field can actually
  // be EMPTY. Bound straight to valueCents it was impossible to clear: deleting
  // the digits produced 0, the parent read 0 as "no override", and the fallback
  // figure was written back into the box on the very next render. You could
  // never get to a blank field to type your own number.
  //
  // draft === null means "not being edited, show the canonical value".
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="min-w-0">
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-[var(--text-tertiary)]">$</span>
        <input
          className="h-9 w-32 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 text-lg font-semibold tabular-nums text-[var(--text-primary)] outline-none focus:border-[var(--accent-brand-border)]"
          inputMode="decimal"
          onBlur={() => setDraft(null)}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);

            const commit = commitFromText(next);
            if (commit.kind === "cleared") onChange(null);
            else if (commit.kind === "value") onChange(commit.cents);
            // "ignore" keeps the typed text without committing anything.
          }}
          // text, not number: type="number" reports an empty string for
          // intermediate input, which is the same signal as a cleared field.
          type="text"
          value={draft ?? canonicalText(valueCents)}
        />
        {onReset ? (
          <button
            className="text-xs font-semibold text-[var(--accent-brand-text)] hover:underline"
            onClick={onReset}
            type="button"
          >
            {resetLabel}
          </button>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">{hint}</span>
        )}
      </div>
    </div>
  );
}

function GoalRung({
  busy,
  goal,
  isEditing,
  isFirst,
  isLast,
  isOpen,
  maxTarget,
  onEdit,
  onMoveDown,
  onMoveUp,
  onRemove,
  onSave,
  onToggle,
}: {
  busy: boolean;
  goal: GoalStep;
  isEditing: boolean;
  isFirst: boolean;
  isLast: boolean;
  isOpen: boolean;
  maxTarget: number;
  onEdit: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onRemove: () => void;
  onSave: (patch: {
    title: string;
    kicker: string;
    description: string;
    targetCents: number;
  }) => void;
  onToggle: () => void;
}) {
  const active = goal.status === "active";
  const complete = goal.status === "complete";
  const locked = goal.status === "locked";
  const widthPct = Math.max(6, (goal.resolvedTargetCents / maxTarget) * 100);

  return (
    <li className="group relative pl-[70px]">
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

      <div
        className={`rounded-xl border px-3 py-3 transition-all duration-200 ${
          active
            ? "border-[var(--accent-brand-border)] bg-[var(--surface-elevated)]"
            : "border-transparent hover:border-[var(--border-default)] hover:bg-[var(--surface-elevated)]"
        } ${locked && !isEditing ? "opacity-60 hover:opacity-100" : ""}`}
      >
        {isEditing ? (
          <RungEditor busy={busy} goal={goal} onCancel={onEdit} onSave={onSave} />
        ) : (
          <>
            <button
              aria-expanded={isOpen}
              className="w-full text-left outline-none"
              onClick={onToggle}
              type="button"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {goal.kicker || `Rung ${goal.order}`}
                  </span>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {goal.title}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                  {formatMoney(goal.resolvedTargetCents)}
                </span>
              </div>

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
                      boxShadow: active
                        ? "0 0 16px rgba(255,255,255,0.55)"
                        : undefined,
                    }}
                  />
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                <span className="tabular-nums">
                  {formatMoney(goal.fundedCents)} of{" "}
                  {formatMoney(goal.resolvedTargetCents)}
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
                {goal.deadlineOn ? (
                  <span
                    className={
                      goal.missesDeadline
                        ? "font-semibold text-[var(--accent-negative-text)]"
                        : ""
                    }
                  >
                    {goal.deadlineLabel} {formatDate(goal.deadlineOn)}
                    {goal.missesDeadline ? " — projected to miss" : ""}
                  </span>
                ) : null}
                <span className="ml-auto">{isOpen ? "Hide detail" : "Detail"}</span>
              </div>

              <div
                className={`grid transition-all duration-300 ${
                  isOpen
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  {goal.description ? (
                    <p className="pt-3 text-sm leading-6 text-[var(--text-secondary)]">
                      {goal.description}
                    </p>
                  ) : null}
                  <dl className="mt-3 space-y-1.5">
                    {goal.payoff ? (
                      <div className="mb-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-tertiary)]">
                        {goal.payoff.neverPaysOff ? (
                          <span className="font-semibold text-[var(--accent-negative-text)]">
                            The payment does not cover the monthly interest — this
                            balance never retires.
                          </span>
                        ) : (
                          <>
                            <span className="font-semibold text-[var(--text-secondary)]">
                              {goal.payoff.months} months
                            </span>{" "}
                            at {formatMoney(goal.payoff.monthlyPaymentCents)}/mo
                            {goal.payoff.becameActiveMonth !== null &&
                            goal.payoff.becameActiveMonth > 1
                              ? ` — cashflow reaches it in month ${goal.payoff.becameActiveMonth}`
                              : " — cashflow is on it now"}
                            , costing{" "}
                            <span className="font-semibold text-[var(--accent-negative-text)]">
                              {formatMoney(goal.payoff.totalInterestCents)}
                            </span>{" "}
                            in interest.
                          </>
                        )}
                      </div>
                    ) : null}
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

            <div className="mt-2 flex items-center gap-1 border-t border-[var(--border-subtle)] pt-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <IconButton
                disabled={busy || isLast}
                label="Move up"
                onClick={onMoveUp}
              />
              <IconButton
                disabled={busy || isFirst}
                down
                label="Move down"
                onClick={onMoveDown}
              />
              <button
                className="rounded-md px-2 py-0.5 text-xs font-semibold text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
                disabled={busy}
                onClick={onEdit}
                type="button"
              >
                Edit
              </button>
              <button
                className="ml-auto rounded-md px-2 py-0.5 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--accent-negative-text)]"
                disabled={busy}
                onClick={onRemove}
                type="button"
              >
                Remove
              </button>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function IconButton({
  disabled,
  down,
  label,
  onClick,
}: {
  disabled: boolean;
  down?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="rounded-md px-2 py-0.5 text-xs font-semibold text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-30"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {down ? "↓" : "↑"}
    </button>
  );
}

function RungEditor({
  busy,
  goal,
  onCancel,
  onSave,
}: {
  busy: boolean;
  goal: GoalStep;
  onCancel: () => void;
  onSave: (patch: {
    title: string;
    kicker: string;
    description: string;
    targetCents: number;
  }) => void;
}) {
  const [title, setTitle] = useState(goal.title);
  const [kicker, setKicker] = useState(goal.kicker);
  const [description, setDescription] = useState(goal.description);
  const [amount, setAmount] = useState(Math.round(goal.targetCents / 100));

  const amountEditable = goal.targetKind === "fixed";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
        <label className="block">
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Title
          </span>
          <input
            className="mt-1 h-9 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-2 text-sm font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent-brand-border)]"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </label>
        <label className="block">
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Label
          </span>
          <input
            className="mt-1 h-9 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-brand-border)]"
            onChange={(event) => setKicker(event.target.value)}
            value={kicker}
          />
        </label>
      </div>

      <label className="block">
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Why it matters
        </span>
        <textarea
          className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-2 py-2 text-sm leading-6 text-[var(--text-primary)] outline-none focus:border-[var(--accent-brand-border)]"
          onChange={(event) => setDescription(event.target.value)}
          rows={5}
          value={description}
        />
      </label>

      <label className="block max-w-[220px]">
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Amount
        </span>
        <span className="mt-1 flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-2">
          <span className="text-xs text-[var(--text-tertiary)]">$</span>
          <input
            className="h-9 w-full bg-transparent text-sm font-semibold tabular-nums text-[var(--text-primary)] outline-none disabled:opacity-50"
            disabled={!amountEditable}
            inputMode="numeric"
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed) && parsed >= 0) setAmount(parsed);
            }}
            type="number"
            value={amountEditable ? amount : Math.round(goal.resolvedTargetCents / 100)}
          />
        </span>
        {!amountEditable ? (
          <span className="mt-1 block text-xs text-[var(--text-muted)]">
            {goal.targetKind === "debt"
              ? "Comes from the live debt balance."
              : "Comes from the house-hack assumptions below."}
          </span>
        ) : null}
      </label>

      <div className="flex items-center gap-2">
        <button
          className="rounded-lg bg-[var(--accent-brand)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          disabled={busy}
          onClick={() =>
            onSave({
              title,
              kicker,
              description,
              targetCents: Math.round(amount * 100),
            })
          }
          type="button"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Artwork slot. The rung number renders by default and the image fades in over
 * it on load — reacting to onError instead would leave a broken-image glyph,
 * because a request that fails during SSR has already failed before hydration.
 */
function GoalArtwork({ goal }: { goal: GoalStep }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      <span className="text-base font-semibold text-[var(--text-muted)]">
        {goal.order}
      </span>
      {goal.imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
          onLoad={() => setLoaded(true)}
          src={goal.imageSrc}
        />
      ) : null}
    </>
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
