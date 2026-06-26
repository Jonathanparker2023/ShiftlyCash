// src/app/(protected)/paychecks/reconcile-actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  PRESTIGE_JOB_KEY,
  isCustomJobKey,
  type PaycheckJobKey,
  type PaycheckReconciliation,
} from "@/lib/paychecks/data";

// Paycheck reconciliation — Option A (per-shift NET override), PER PERIOD PER JOB.
//
// The paychecks page reconciles ONE job key inside ONE pay period. Job keys are
// 'prestige' (folds job_type IN ('prestige','prestige_ilst')) or 'custom:<uuid>'
// (job_type='custom' with that custom_job_id) — Ability/incentive are retired
// from this page and are never a reconcile target.
//
// "Reconcile" runs the Hamilton/largest-remainder distribution over the job's
// period shifts' BASE net (derived hours x net-rate, integer cents),
// OVERWRITES each shift's earn_slots.reconciled_net_cents, and snapshots the
// set for staleness. Every earnings rollup reads
// COALESCE(reconciled_net_cents, derived net), so the override propagates
// everywhere without touching the immutable base.
//
// ATOMICITY: the multi-row override write + the post-write Σ==actual assert +
// the paycheck_reconciliations upsert are ONE transaction inside the
// reconcile_paycheck Postgres function (SECURITY INVOKER → RLS still scopes to
// the caller; requireUser() returns the cookie-bound RLS client). Raising in
// the function rolls back every write. This file is the thin server-action
// wrapper around those RPCs.
//
// SINGLE BASE SOURCE: the base net per shift is produced ONLY by the
// paycheck_period_base_slots SQL function (round(<v_day_totals earn CASE>*100)).
// Nothing in TS re-derives money — no second copy of the CASE to drift.

type PeriodBaseRow = { slot_id: string; base_net_cents: number };

type ReconcileRpcRow = {
  status: string;
  projected_amount_cents: number;
  actual_amount_cents: number;
  factor: number | null;
  slot_count: number;
};

export async function reconcilePaycheckAction(input: {
  weekId: string;
  jobType: PaycheckJobKey;
  actualCents: number;
  confirmedCorrect: boolean;
}): Promise<{ ok: true; reconciliation: PaycheckReconciliation }> {
  const { supabase } = await requireUser();
  const weekId = requireUuid(input.weekId, "weekId");
  const jobKey = requirePaycheckJob(input.jobType);
  const actualCents = requireNonNegativeInteger(input.actualCents, "actualCents");

  if (input.confirmedCorrect !== true) {
    throw new Error(
      "Reconciliation requires explicit confirmation that the check is correct.",
    );
  }

  // Atomic in Postgres: Hamilton split from base + multi-row override write +
  // Σ==actual assert + record upsert, one transaction. The function recomputes
  // the base from the live derived-net CASE every run (idempotent: never reads
  // back reconciled_net_cents), so reconciling twice is identical and editing
  // the actual recomputes from base.
  const { data, error } = await supabase.rpc("reconcile_paycheck", {
    p_week_id: weekId,
    p_job_key: jobKey,
    p_actual_cents: actualCents,
    p_confirmed_correct: true,
  });

  if (error) {
    throw new Error(`Unable to reconcile paycheck: ${error.message}`);
  }

  const row = firstRow<ReconcileRpcRow>(data);
  if (!row) {
    throw new Error("Reconcile did not return a result.");
  }

  revalidatePath("/paychecks");
  revalidatePath("/");

  return {
    ok: true,
    reconciliation: {
      status: "reconciled",
      projectedAmountCents: Number(row.projected_amount_cents),
      actualAmountCents: Number(row.actual_amount_cents),
      factor: row.factor == null ? null : Number(row.factor),
      stale: false,
      reconciledAt: new Date().toISOString(),
    },
  };
}

export async function revertPaycheckReconciliationAction(input: {
  weekId: string;
  jobType: PaycheckJobKey;
}): Promise<{ ok: true; clearedSlots: number }> {
  const { supabase } = await requireUser();
  const weekId = requireUuid(input.weekId, "weekId");
  const jobKey = requirePaycheckJob(input.jobType);

  // Atomic in Postgres: null reconciled_net_cents for this job's period slots
  // and mark the record 'reverted'. Rollups fall back to derived net at once.
  const { data, error } = await supabase.rpc("revert_paycheck_reconciliation", {
    p_week_id: weekId,
    p_job_key: jobKey,
  });

  if (error) {
    throw new Error(`Unable to revert reconciliation: ${error.message}`);
  }

  const row = firstRow<{ cleared_slots: number }>(data);

  revalidatePath("/paychecks");
  revalidatePath("/");

  return { ok: true, clearedSlots: row ? Number(row.cleared_slots) : 0 };
}

// Preview the base (Σ b_i and the per-shift split) before the user confirms.
// Reads the SQL base function directly — no TS money derivation.
export async function loadPaycheckBaseShiftsAction(input: {
  weekId: string;
  jobType: PaycheckJobKey;
}): Promise<{
  baseShifts: { slotId: string; baseNetCents: number }[];
  projectedCents: number;
}> {
  const { supabase } = await requireUser();
  const weekId = requireUuid(input.weekId, "weekId");
  const jobKey = requirePaycheckJob(input.jobType);

  const { data, error } = await supabase.rpc("paycheck_period_base_slots", {
    p_week_id: weekId,
    p_job_key: jobKey,
  });

  if (error) {
    throw new Error(`Unable to load reconcile base: ${error.message}`);
  }

  const rows = (data ?? []) as PeriodBaseRow[];
  const baseShifts = rows.map((row) => ({
    slotId: row.slot_id,
    baseNetCents: Number(row.base_net_cents),
  }));
  const projectedCents = baseShifts.reduce(
    (total, shift) => total + shift.baseNetCents,
    0,
  );

  return { baseShifts, projectedCents };
}

// ---------------------------------------------------------------------------
// Validators (match paychecks/actions.ts style)
// ---------------------------------------------------------------------------

function requirePaycheckJob(value: PaycheckJobKey): string {
  if (value === PRESTIGE_JOB_KEY) {
    return value;
  }
  if (isCustomJobKey(value)) {
    requireUuid(value.slice("custom:".length), "customJobId");
    return value;
  }
  throw new Error("Invalid paycheck job.");
}

function requireUuid(value: string, fieldName: string): string {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(value)) {
    throw new Error(`Invalid ${fieldName}.`);
  }
  return value;
}

function requireNonNegativeInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${fieldName}.`);
  }
  return value;
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return (data[0] as T | undefined) ?? null;
  }
  if (data && typeof data === "object") {
    return data as T;
  }
  return null;
}
