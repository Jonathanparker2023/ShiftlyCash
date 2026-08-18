"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { addDaysIso, getTodayIso } from "@/lib/dashboard/dates";
import { getWeekDashboardData } from "@/lib/dashboard/data";
import { applyDashboardProjectionMaintenance } from "@/lib/dashboard/projectionMaintenance";
import type { DashboardData } from "@/lib/dashboard/types";
import type { IncentiveMode, JobType, PayType } from "@/lib/domain/pay";

const JOB_TYPES = [
  "ability",
  "ability_incentive",
  "prestige",
  "prestige_ilst",
  "incentive",
  "other",
  "custom",
  "none",
] as const;
const INCENTIVE_MODES = ["none", "rate", "lump_sum"] as const;

export type SaveDayInput = {
  dayId: string;
  spendCents: number;
  spendLocked: boolean;
};

export type SaveEarnSlotInput = {
  dayId: string;
  slotIndex: number;
  jobType: JobType;
  payType: PayType;
  hoursOrUnits: number;
  regularHours?: number;
  overtimeHours?: number;
  incentiveMode?: IncentiveMode;
  incentiveRate?: number;
  incentiveAmount?: number;
  label: string;
  customJobId?: string | null;
  // Server backstop for the Money Hard Rule: a CLOSED week's shifts can only be
  // written when the History "Edit week" mode explicitly sets this. Without it,
  // closed weeks are immutable on the server, not just hidden by read-only UI.
  allowClosedEdit?: boolean;
};

export type SaveDayResult = {
  ok: true;
  day: SaveDayInput;
};

export type SaveEarnSlotResult = {
  ok: true;
  slot: SaveEarnSlotInput & {
    id: string;
    source: "user";
  };
};

export type CloseWeekInput = {
  weekId: string;
};

export type ToggleTransactionStatusInput = {
  transactionId: string;
  newStatus: "applied" | "excluded";
};

export type TransactionIdInput = {
  transactionId: string;
};

export type RenameTransactionInput = {
  transactionId: string;
  merchantName: string;
};

export type AddManualTransactionInput = {
  dayId: string;
  merchantName: string;
  amountCents: number;
};

export type AmortizeTransactionInput = {
  transactionId: string;
  months: 1 | 3;
};

export type AllocateEvChargeTransactionInput = {
  transactionId: string;
  chargeAmountCents: number;
  previousChargeDate?: string | null;
};

export type CloseWeekResult = {
  ok: true;
  newWeekId: string;
};

export type ManualTransactionResult = {
  ok: true;
  transaction: {
    id: string;
    dayId: string;
    merchantName: string;
    amountCents: number;
    originalAmountCents: number;
    category: string | null;
    source: "manual";
    status: "applied";
    isAmortized: boolean;
    isGasAllocated: boolean;
    gasAllocatedCents: number;
    gasRemainderCents: number;
    isEvChargeAllocated: boolean;
    evChargeAllocatedCents: number;
    evChargeRemainderCents: number;
    wasMovedToYesterday: boolean;
    date: string;
    time: string | null;
    createdAt: string;
  };
};

export type RefreshDashboardProjectionMaintenanceResult = {
  ok: true;
  cleaned: number;
  projected: number;
};

export async function saveDayAction(input: SaveDayInput): Promise<SaveDayResult> {
  const { supabase } = await requireUser();
  const dayId = requireUuid(input.dayId, "dayId");
  const spendCents = requireNonNegativeInteger(input.spendCents, "spendCents");
  const spendLocked = Boolean(input.spendLocked);

  const { data: day, error: dayError } = await supabase
    .from("days")
    .select("id")
    .eq("id", dayId)
    .maybeSingle();

  if (dayError) {
    throw new Error(`Unable to validate day: ${dayError.message}`);
  }

  if (!day) {
    throw new Error("Day not found.");
  }

  const { error } = await supabase
    .from("days")
    .update({
      manual_spend_adjustment: centsToDollars(spendCents),
      spend_locked: spendLocked,
    })
    .eq("id", dayId);

  if (error) {
    throw new Error(`Unable to save day: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");

  return {
    ok: true,
    day: {
      dayId,
      spendCents,
      spendLocked,
    },
  };
}

export async function saveEarnSlotAction(
  input: SaveEarnSlotInput,
): Promise<SaveEarnSlotResult> {
  const { supabase, user } = await requireUser();
  const normalized = normalizeEarnSlotInput(input);

  const { data: day, error: dayError } = await supabase
    .from("days")
    .select("id, week_id")
    .eq("id", normalized.dayId)
    .maybeSingle();

  if (dayError) {
    throw new Error(`Unable to validate day: ${dayError.message}`);
  }

  if (!day) {
    throw new Error("Day not found.");
  }

  // Closed-week backstop: refuse to write a closed week's shift unless the
  // History edit mode explicitly authorized it. This is the server guard that
  // makes "history is read-only" an invariant, not just a UI convention.
  const { data: parentWeek, error: weekStatusError } = await supabase
    .from("weeks")
    .select("status")
    .eq("id", (day as { week_id: string }).week_id)
    .maybeSingle();
  if (weekStatusError) {
    throw new Error(`Unable to validate week: ${weekStatusError.message}`);
  }
  if (
    (parentWeek as { status?: string } | null)?.status === "closed" &&
    !input.allowClosedEdit
  ) {
    throw new Error(
      "This week is closed. Turn on Edit week in History before changing it.",
    );
  }

  const { data, error } = await supabase
    .from("earn_slots")
    .upsert(
      {
        user_id: user.id,
        day_id: normalized.dayId,
        slot_index: normalized.slotIndex,
        job_type: normalized.jobType,
        pay_type: normalized.payType,
        hours_or_units: normalized.hoursOrUnits,
        regular_hours: normalized.regularHours ?? 0,
        overtime_hours: normalized.overtimeHours ?? 0,
        incentive_mode: normalized.incentiveMode ?? "none",
        incentive_rate: normalized.incentiveRate ?? 0,
        incentive_amount: normalized.incentiveAmount ?? 0,
        label: normalized.label || null,
        source: "user",
        custom_job_id: normalized.customJobId ?? null,
      },
      { onConflict: "day_id,slot_index" },
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to save earn slot: ${error.message}`);
  }

  const row = data as { id: string };
  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/history");
  revalidatePath("/history/[week_id]", "page");

  return {
    ok: true,
    slot: {
      ...normalized,
      id: row.id,
      source: "user",
    },
  };
}

// Capture a pre-edit recovery copy of a closed week's shifts before History
// edits it. Append-only (state_snapshots is hardened against update/delete), so
// it's a frozen forensic baseline — the deliberate edit is always recoverable.
export async function snapshotClosedWeekAction(input: {
  weekId: string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const weekId = requireUuid(input.weekId, "weekId");

  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select("id,start_date,end_date,status")
    .eq("id", weekId)
    .maybeSingle();
  if (weekError) {
    throw new Error(`Unable to load week: ${weekError.message}`);
  }
  if (!week) {
    throw new Error("Week not found.");
  }

  const { data: dayRows, error: daysError } = await supabase
    .from("days")
    .select("id,date,day_index")
    .eq("week_id", weekId)
    .order("day_index", { ascending: true });
  if (daysError) {
    throw new Error(`Unable to load days: ${daysError.message}`);
  }
  const dayIds = ((dayRows ?? []) as { id: string }[]).map((d) => d.id);

  const { data: slotRows, error: slotsError } = dayIds.length
    ? await supabase
        .from("earn_slots")
        .select(
          "id,day_id,slot_index,job_type,pay_type,hours_or_units,regular_hours,overtime_hours,incentive_mode,incentive_rate,incentive_amount,label,custom_job_id",
        )
        .in("day_id", dayIds)
    : { data: [], error: null };
  if (slotsError) {
    throw new Error(`Unable to load shifts: ${slotsError.message}`);
  }

  const { error: insertError } = await supabase.from("state_snapshots").insert({
    user_id: user.id,
    snapshot_type: "history_edit",
    week_id: weekId,
    payload: {
      reason: "pre_closed_week_edit",
      week,
      days: dayRows ?? [],
      earn_slots: slotRows ?? [],
    },
  });
  if (insertError) {
    throw new Error(`Unable to snapshot week: ${insertError.message}`);
  }

  return { ok: true };
}

export async function closeWeekAction(
  input: CloseWeekInput,
): Promise<CloseWeekResult> {
  const { supabase } = await requireUser();
  const weekId = requireUuid(input.weekId, "weekId");
  const { data, error } = await supabase.rpc("close_week_and_start_next", {
    p_week_id: weekId,
  });

  if (error) {
    throw new Error(`Unable to close week: ${error.message}`);
  }

  if (typeof data !== "string") {
    throw new Error("Week close did not return the new week id.");
  }

  revalidatePath("/");
  revalidatePath("/trends");

  return {
    ok: true,
    newWeekId: data,
  };
}

export async function closeWeekAndRedirectAction(
  input: CloseWeekInput,
): Promise<never> {
  await closeWeekAction(input);
  redirect("/");
}

export async function refreshDashboardProjectionMaintenanceAction(): Promise<RefreshDashboardProjectionMaintenanceResult> {
  const { supabase } = await requireUser();
  const todayIso = getTodayIso();
  const { data: activeWeek, error: activeWeekError } = await supabase
    .from("weeks")
    .select("id")
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeWeekError) {
    throw new Error(`Unable to load active week: ${activeWeekError.message}`);
  }

  const { cleaned, projected } = await applyDashboardProjectionMaintenance(
    supabase,
    {
      weekId: activeWeek?.id ?? null,
      todayIso,
    },
  );

  if (cleaned > 0 || projected > 0) {
    revalidatePath("/");
  revalidatePath("/trends");
  }

  return {
    ok: true,
    cleaned,
    projected,
  };
}

export async function toggleTransactionStatusAction(
  input: ToggleTransactionStatusInput,
): Promise<{ ok: true; dashboardData: DashboardData | null }> {
  const { supabase, user } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");
  const newStatus = requireEnum(
    input.newStatus,
    ["applied", "excluded"] as const,
    "newStatus",
  );
  const { data: transaction, error: transactionError } = await supabase
    .from("transactions")
    .select("id,day_id")
    .eq("id", transactionId)
    .maybeSingle();

  if (transactionError) {
    throw new Error(`Unable to validate transaction: ${transactionError.message}`);
  }

  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  if (newStatus === "applied" && !transaction.day_id) {
    throw new Error("Cannot apply a transaction without a day.");
  }

  const { data: activeGasAllocation, error: activeGasError } = await supabase
    .from("gas_allocations")
    .select("id")
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (activeGasError) {
    throw new Error(`Unable to inspect gas allocation: ${activeGasError.message}`);
  }
  const { data: activeEvChargeAllocation, error: activeEvChargeError } =
    await supabase
      .from("ev_charge_allocations")
      .select("id")
      .eq("source_transaction_id", transactionId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
  if (activeEvChargeError) {
    throw new Error(
      `Unable to inspect EV charge allocation: ${activeEvChargeError.message}`,
    );
  }

  const { error } = await supabase
    .from("transactions")
    .update({
      status: newStatus,
      review_reason: null,
      excluded_at: newStatus === "excluded" ? new Date().toISOString() : null,
    })
    .eq("id", transactionId);

  if (error) {
    throw new Error(`Unable to update transaction: ${error.message}`);
  }

  // Status changes return the transaction to the normal spend/exempt flow.
  // Clear derived overlays so gas/amortization cannot keep moving totals after
  // the source row has been manually reclassified.
  const { error: deactivateAmortizationError } = await supabase
    .from("amortized_expenses")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);
  if (deactivateAmortizationError) {
    throw new Error(
      `Unable to clear amortization: ${deactivateAmortizationError.message}`,
    );
  }

  const { error: deactivateGasError } = await supabase
    .from("gas_allocations")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);
  if (deactivateGasError) {
    throw new Error(`Unable to clear gas allocation: ${deactivateGasError.message}`);
  }
  const { error: deactivateEvChargeError } = await supabase
    .from("ev_charge_allocations")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);
  if (deactivateEvChargeError) {
    throw new Error(
      `Unable to clear EV charge allocation: ${deactivateEvChargeError.message}`,
    );
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/baseline");
  revalidatePath("/history");

  let dashboardData: DashboardData | null = null;
  if ((activeGasAllocation || activeEvChargeAllocation) && transaction.day_id) {
    const { data: day, error: dayError } = await supabase
      .from("days")
      .select("week_id")
      .eq("id", transaction.day_id)
      .eq("user_id", user.id)
      .single();
    if (dayError) {
      throw new Error(`Unable to reload gas allocation week: ${dayError.message}`);
    }
    dashboardData = await getWeekDashboardData(
      String((day as { week_id: string }).week_id),
    );
  }

  return { ok: true, dashboardData };
}

export async function deleteTransactionAction(
  input: TransactionIdInput,
): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");

  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", transactionId);

  if (error) {
    throw new Error(`Unable to delete transaction: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");
  return { ok: true };
}

export async function moveTransactionToYesterdayAction(
  input: TransactionIdInput,
): Promise<{ ok: true; dayId: string; date: string }> {
  const { supabase, user } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");
  const { data: transaction, error: transactionError } = await supabase
    .from("transactions")
    .select("id,date")
    .eq("id", transactionId)
    .maybeSingle();

  if (transactionError) {
    throw new Error(`Unable to validate transaction: ${transactionError.message}`);
  }

  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  const yesterdayIso = addDaysIso(String(transaction.date), -1);
  const { data: day, error: dayError } = await supabase
    .from("days")
    .select("id,date")
    .eq("date", yesterdayIso)
    .maybeSingle();

  if (dayError) {
    throw new Error(`Unable to find yesterday: ${dayError.message}`);
  }

  if (!day) {
    throw new Error("Yesterday is outside the active dashboard week.");
  }

  const { error } = await supabase
    .from("transactions")
    .update({
      day_id: day.id,
      date: day.date,
      moved_to_yesterday: true,
    })
    .eq("id", transactionId);

  if (error) {
    throw new Error(`Unable to move transaction: ${error.message}`);
  }

  const { error: deactivateGasError } = await supabase
    .from("gas_allocations")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);
  if (deactivateGasError) {
    throw new Error(`Unable to clear gas allocation: ${deactivateGasError.message}`);
  }
  const { error: deactivateEvChargeError } = await supabase
    .from("ev_charge_allocations")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);
  if (deactivateEvChargeError) {
    throw new Error(
      `Unable to clear EV charge allocation: ${deactivateEvChargeError.message}`,
    );
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/history");
  return { ok: true, dayId: String(day.id), date: String(day.date) };
}

export async function moveTransactionToTomorrowAction(
  input: TransactionIdInput,
): Promise<{ ok: true; dayId: string; date: string }> {
  const { supabase, user } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");
  const { data: transaction, error: transactionError } = await supabase
    .from("transactions")
    .select("id,date,moved_to_yesterday")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (transactionError) {
    throw new Error(`Unable to validate transaction: ${transactionError.message}`);
  }

  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  if (transaction.moved_to_yesterday !== true) {
    throw new Error("Only transactions moved to yesterday can be moved to tomorrow.");
  }

  const tomorrowIso = addDaysIso(String(transaction.date), 1);
  const { data: day, error: dayError } = await supabase
    .from("days")
    .select("id,date")
    .eq("date", tomorrowIso)
    .eq("user_id", user.id)
    .maybeSingle();

  if (dayError) {
    throw new Error(`Unable to find tomorrow: ${dayError.message}`);
  }

  if (!day) {
    throw new Error("Tomorrow is outside the active dashboard week.");
  }

  const { error } = await supabase
    .from("transactions")
    .update({
      day_id: day.id,
      date: day.date,
      moved_to_yesterday: false,
    })
    .eq("id", transactionId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(`Unable to move transaction: ${error.message}`);
  }

  const { error: deactivateGasError } = await supabase
    .from("gas_allocations")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);
  if (deactivateGasError) {
    throw new Error(`Unable to clear gas allocation: ${deactivateGasError.message}`);
  }
  const { error: deactivateEvChargeError } = await supabase
    .from("ev_charge_allocations")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);
  if (deactivateEvChargeError) {
    throw new Error(
      `Unable to clear EV charge allocation: ${deactivateEvChargeError.message}`,
    );
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/history");
  return { ok: true, dayId: String(day.id), date: String(day.date) };
}

export async function renameTransactionAction(
  input: RenameTransactionInput,
): Promise<{ ok: true; merchantName: string }> {
  const { supabase } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");
  const merchantName = requireNonEmptyString(input.merchantName, "merchantName");

  const { error } = await supabase
    .from("transactions")
    .update({ merchant_name: merchantName })
    .eq("id", transactionId);

  if (error) {
    throw new Error(`Unable to rename transaction: ${error.message}`);
  }

  // /baseline shows the amortized expense whose name derives from this txn.
  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/baseline");
  return { ok: true, merchantName };
}

// Calendar-day span of `months` real months from a start date, so "1 month"
// means a true calendar month (28-31 days), matching user expectation and the
// legacy expiration semantics — not a hardcoded 30/90.
function amortizationPeriodDays(startIso: string, months: number): number {
  const end = addMonthsIso(startIso, months);
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${startIso}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86_400_000));
}

export async function amortizeTransactionAction(
  input: AmortizeTransactionInput,
): Promise<{ ok: true; amortizedId: string }> {
  const { supabase, user } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");
  const months = requireEnum(String(input.months), ["1", "3"] as const, "months");
  const monthCount = months === "1" ? 1 : 3;

  const { data: transaction, error: transactionError } = await supabase
    .from("transactions")
    .select("id,amount,merchant_name,date")
    .eq("id", transactionId)
    .maybeSingle();

  if (transactionError) {
    throw new Error(`Unable to validate transaction: ${transactionError.message}`);
  }
  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  const amount = Math.abs(Number(transaction.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Transaction has no positive amount to prorate.");
  }

  const transactionDate = String(transaction.date);
  const merchantName =
    String(transaction.merchant_name ?? "Expense").trim() || "Expense";
  const originalAmountCents = Math.round(amount * 100);
  const periodDays = amortizationPeriodDays(transactionDate, monthCount);

  // Real amortization record (one row, FK to the source transaction). Upsert on
  // the source transaction so re-amortizing the same txn edits in place instead
  // of stacking rows (the old name-suffix double-count bug).
  const { data: amortized, error: upsertError } = await supabase
    .from("amortized_expenses")
    .upsert(
      {
        user_id: user.id,
        source_transaction_id: transactionId,
        merchant_name: merchantName,
        original_amount_cents: originalAmountCents,
        start_date: transactionDate,
        period_days: periodDays,
        is_active: true,
      },
      { onConflict: "source_transaction_id" },
    )
    .select("id")
    .single();

  if (upsertError) {
    throw new Error(`Unable to create amortized expense: ${upsertError.message}`);
  }

  // Pull the original transaction out of spend so the cost isn't double-counted.
  const { error: excludeError } = await supabase
    .from("transactions")
    .update({
      status: "excluded",
      review_reason: "amortized_expense",
      excluded_at: new Date().toISOString(),
    })
    .eq("id", transactionId);

  if (excludeError) {
    throw new Error(`Unable to exclude transaction: ${excludeError.message}`);
  }

  const { error: deactivateGasError } = await supabase
    .from("gas_allocations")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);
  if (deactivateGasError) {
    throw new Error(`Unable to clear gas allocation: ${deactivateGasError.message}`);
  }
  const { error: deactivateEvChargeError } = await supabase
    .from("ev_charge_allocations")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);
  if (deactivateEvChargeError) {
    throw new Error(
      `Unable to clear EV charge allocation: ${deactivateEvChargeError.message}`,
    );
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/baseline");
  revalidatePath("/history");

  return { ok: true, amortizedId: String((amortized as { id: string }).id) };
}

export async function allocateEvChargeTransactionAction(
  input: AllocateEvChargeTransactionInput,
): Promise<{
  ok: true;
  allocationId: string;
  previousChargeDate: string;
  dashboardData: DashboardData;
}> {
  const { supabase, user } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");
  const chargeAmountCents = requirePositiveInteger(
    input.chargeAmountCents,
    "chargeAmountCents",
  );

  const { data: transaction, error: transactionError } = await supabase
    .from("transactions")
    .select("id,amount,merchant_name,date,status,day_id")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (transactionError) {
    throw new Error(`Unable to validate transaction: ${transactionError.message}`);
  }
  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  const row = transaction as {
    id: string;
    amount: number | string;
    merchant_name: string | null;
    date: string;
    status: string;
    day_id: string | null;
  };
  if (row.status !== "applied" || !row.day_id) {
    throw new Error("EV charging requires an applied spending transaction.");
  }

  const originalAmountCents = Math.round(Math.abs(Number(row.amount)) * 100);
  if (!Number.isFinite(originalAmountCents) || originalAmountCents <= 0) {
    throw new Error("Transaction has no positive amount to allocate.");
  }
  if (chargeAmountCents > originalAmountCents) {
    throw new Error("EV charge amount cannot exceed the transaction amount.");
  }

  const chargeDate = row.date;
  const previousChargeDate = input.previousChargeDate
    ? requirePastDate(
        input.previousChargeDate,
        chargeDate,
        "previousChargeDate",
      )
    : await findPreviousEvChargeDate(supabase, user.id, chargeDate);
  const merchantName =
    String(row.merchant_name ?? "EV Charge").trim() || "EV Charge";

  const { data: allocation, error: upsertError } = await supabase
    .from("ev_charge_allocations")
    .upsert(
      {
        user_id: user.id,
        source_transaction_id: transactionId,
        merchant_name: merchantName,
        charge_date: chargeDate,
        previous_charge_date: previousChargeDate,
        charge_amount_cents: chargeAmountCents,
        original_amount_cents: originalAmountCents,
        remainder_amount_cents: originalAmountCents - chargeAmountCents,
        is_active: true,
      },
      { onConflict: "source_transaction_id" },
    )
    .select("id")
    .single();

  if (upsertError) {
    throw new Error(`Unable to allocate EV charge: ${upsertError.message}`);
  }

  const { error: deactivateGasError } = await supabase
    .from("gas_allocations")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);
  if (deactivateGasError) {
    throw new Error(
      `Unable to clear historical gas allocation: ${deactivateGasError.message}`,
    );
  }

  const { error: deactivateAmortizationError } = await supabase
    .from("amortized_expenses")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);
  if (deactivateAmortizationError) {
    throw new Error(
      `Unable to clear amortization: ${deactivateAmortizationError.message}`,
    );
  }

  const { data: day, error: dayError } = await supabase
    .from("days")
    .select("week_id")
    .eq("id", row.day_id)
    .eq("user_id", user.id)
    .single();

  if (dayError) {
    throw new Error(`Unable to reload EV charge week: ${dayError.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/history");
  return {
    ok: true,
    allocationId: String((allocation as { id: string }).id),
    previousChargeDate,
    dashboardData: await getWeekDashboardData(String((day as { week_id: string }).week_id)),
  };
}

// Change an existing amortization's period in place (e.g. 1mo -> 3mo). Bumps
// schedule_version; the derived views redistribute the original amount over the
// new window retroactively, with zero per-day writes.
export async function reAmortizeTransactionAction(
  input: AmortizeTransactionInput,
): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");
  const months = requireEnum(String(input.months), ["1", "3"] as const, "months");
  const monthCount = months === "1" ? 1 : 3;

  const { data: row, error: rowError } = await supabase
    .from("amortized_expenses")
    .select("id,start_date,schedule_version")
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (rowError) {
    throw new Error(`Unable to load amortization: ${rowError.message}`);
  }
  if (!row) {
    throw new Error("No proration found for this transaction.");
  }

  const periodDays = amortizationPeriodDays(String(row.start_date), monthCount);
  const { error: updateError } = await supabase
    .from("amortized_expenses")
    .update({
      period_days: periodDays,
      is_active: true,
      schedule_version: Number(row.schedule_version ?? 1) + 1,
    })
    .eq("id", row.id);

  if (updateError) {
    throw new Error(`Unable to re-amortize: ${updateError.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/baseline");
  return { ok: true };
}

/**
 * Undo an amortization: the spread stops and the cost becomes a single lump sum
 * on the day it actually happened.
 *
 * Amortizing EXCLUDES the source transaction (its money moves into the baseline
 * as a daily slice), so undoing has to put it back or the money lands nowhere —
 * gone from the baseline AND still excluded from spend. That silent hole is why
 * reInclude now defaults to TRUE: a caller that forgets the flag gets the
 * conservative behaviour instead of quietly deleting an expense.
 *
 * Pass reInclude: false only when the transaction genuinely should not count —
 * a refund, or a row being reclassified by the caller straight afterwards.
 */
export async function removeAmortizationAction(
  input: { transactionId: string; reInclude?: boolean },
): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");
  const reInclude = input.reInclude ?? true;

  const { error: deactivateError } = await supabase
    .from("amortized_expenses")
    .update({ is_active: false })
    .eq("source_transaction_id", transactionId)
    .eq("user_id", user.id);

  if (deactivateError) {
    throw new Error(`Unable to remove amortization: ${deactivateError.message}`);
  }

  if (reInclude) {
    // A transaction can only be 'applied' if it has a day_id
    // (transactions_applied_requires_day). Restoring a row whose day was never
    // set would violate that, so fall back to its date's day.
    const { data: txn, error: txnError } = await supabase
      .from("transactions")
      .select("id,day_id,date")
      .eq("id", transactionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (txnError) {
      throw new Error(`Unable to load transaction: ${txnError.message}`);
    }
    if (!txn) {
      throw new Error("Transaction not found.");
    }

    const row = txn as { id: string; day_id: string | null; date: string };
    let dayId = row.day_id;

    if (!dayId) {
      const { data: day } = await supabase
        .from("days")
        .select("id")
        .eq("user_id", user.id)
        .eq("date", row.date)
        .maybeSingle();
      dayId = (day as { id: string } | null)?.id ?? null;
    }

    if (!dayId) {
      throw new Error(
        `No day exists for ${row.date}, so this cost cannot be restored as a lump sum. Amortization was removed.`,
      );
    }

    const { error: reincludeError } = await supabase
      .from("transactions")
      .update({
        status: "applied",
        review_reason: null,
        excluded_at: null,
        day_id: dayId,
      })
      .eq("id", transactionId)
      .eq("user_id", user.id);
    if (reincludeError) {
      throw new Error(`Unable to re-include transaction: ${reincludeError.message}`);
    }
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/baseline");
  revalidatePath("/history");
  return { ok: true };
}

// ── Lump-Sum Amortizer ("Amortized Income") ─────────────────────────────────
// A named bucket of SIGNED line items spread EVENLY as a daily NET earnings credit
// across [startDate, endDate]. Daily credits are DERIVED at read time
// (v_day_amortization_credit*), never materialized — so an edit is one row write,
// a delete leaves no orphans, and a range change re-derives with zero per-day writes.

export type CreateAmortizationBucketInput = {
  name: string;
  startDate: string;
  endDate: string;
};
export type UpdateAmortizationBucketInput = {
  bucketId: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  status?: "active" | "archived";
};
export type UpsertAmortizationItemInput = {
  bucketId: string;
  itemIndex: number;
  label: string;
  amountCents: number;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireIsoDate(value: string, fieldName: string): string {
  if (
    typeof value !== "string" ||
    !ISO_DATE_PATTERN.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw new Error(`Invalid ${fieldName}.`);
  }
  return value;
}

// Inclusive day count for [startIso, endIso]. Throws on an end-before-start (or
// otherwise non-positive) range — this is the zero/negative-range block. A
// single-day range yields 1 (credit = total).
function inclusivePeriodDays(startIso: string, endIso: string): number {
  const ms =
    Date.parse(`${endIso}T00:00:00Z`) - Date.parse(`${startIso}T00:00:00Z`);
  const days = Math.round(ms / 86_400_000) + 1;
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error("Proration range must end on or after it starts.");
  }
  return days;
}

export async function createAmortizationBucketAction(
  input: CreateAmortizationBucketInput,
): Promise<{ ok: true; bucketId: string }> {
  const { supabase, user } = await requireUser();
  const name = requireNonEmptyString(input.name, "name");
  const startDate = requireIsoDate(input.startDate, "startDate");
  const endDate = requireIsoDate(input.endDate, "endDate");
  const periodDays = inclusivePeriodDays(startDate, endDate);

  const { data, error } = await supabase
    .from("amortization_bucket")
    .insert({
      user_id: user.id,
      name,
      start_date: startDate,
      period_days: periodDays,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to create bucket: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/baseline");
  return { ok: true, bucketId: String((data as { id: string }).id) };
}

export async function updateAmortizationBucketAction(
  input: UpdateAmortizationBucketInput,
): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const bucketId = requireUuid(input.bucketId, "bucketId");

  const { data: row, error: rowError } = await supabase
    .from("amortization_bucket")
    .select("id,start_date,period_days,schedule_version")
    .eq("id", bucketId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (rowError) {
    throw new Error(`Unable to load bucket: ${rowError.message}`);
  }
  if (!row) {
    throw new Error("Bucket not found.");
  }

  const patch: Record<string, unknown> = {
    schedule_version: Number(row.schedule_version ?? 1) + 1,
  };
  if (input.name !== undefined) {
    patch.name = requireNonEmptyString(input.name, "name");
  }
  if (input.status !== undefined) {
    patch.status = requireEnum(
      input.status,
      ["active", "archived"] as const,
      "status",
    );
  }
  if (input.startDate !== undefined || input.endDate !== undefined) {
    const startDate = requireIsoDate(
      input.startDate ?? String(row.start_date),
      "startDate",
    );
    const currentEnd = addDaysIso(
      String(row.start_date),
      Number(row.period_days) - 1,
    );
    const endDate = requireIsoDate(input.endDate ?? currentEnd, "endDate");
    patch.start_date = startDate;
    patch.period_days = inclusivePeriodDays(startDate, endDate);
  }

  const { error } = await supabase
    .from("amortization_bucket")
    .update(patch)
    .eq("id", bucketId)
    .eq("user_id", user.id);
  if (error) {
    throw new Error(`Unable to update bucket: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/baseline");
  return { ok: true };
}

export async function upsertAmortizationItemAction(
  input: UpsertAmortizationItemInput,
): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const bucketId = requireUuid(input.bucketId, "bucketId");
  const itemIndex = requireNonNegativeInteger(input.itemIndex, "itemIndex");
  const label = requireNonEmptyString(input.label, "label");
  // SIGNED net cents: negatives (returns) are allowed; only require integer cents.
  if (!Number.isInteger(input.amountCents)) {
    throw new Error("Invalid amountCents.");
  }

  const { error } = await supabase.from("amortization_item").upsert(
    {
      user_id: user.id,
      bucket_id: bucketId,
      item_index: itemIndex,
      label,
      amount_cents: input.amountCents,
    },
    { onConflict: "bucket_id,item_index" },
  );
  if (error) {
    throw new Error(`Unable to save item: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/baseline");
  return { ok: true };
}

export async function deleteAmortizationItemAction(input: {
  bucketId: string;
  itemIndex: number;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const bucketId = requireUuid(input.bucketId, "bucketId");
  const itemIndex = requireNonNegativeInteger(input.itemIndex, "itemIndex");

  const { error } = await supabase
    .from("amortization_item")
    .delete()
    .eq("bucket_id", bucketId)
    .eq("item_index", itemIndex)
    .eq("user_id", user.id);
  if (error) {
    throw new Error(`Unable to delete item: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/baseline");
  return { ok: true };
}

// Hard delete: CASCADE drops the items, and because credits are derived (never
// materialized) they vanish the instant the bucket is gone — no orphans.
export async function deleteAmortizationBucketAction(input: {
  bucketId: string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const bucketId = requireUuid(input.bucketId, "bucketId");

  const { error } = await supabase
    .from("amortization_bucket")
    .delete()
    .eq("id", bucketId)
    .eq("user_id", user.id);
  if (error) {
    throw new Error(`Unable to delete bucket: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/baseline");
  return { ok: true };
}

export async function addManualTransactionAction(
  input: AddManualTransactionInput,
): Promise<ManualTransactionResult> {
  const { supabase, user } = await requireUser();
  const dayId = requireUuid(input.dayId, "dayId");
  const merchantName = requireNonEmptyString(input.merchantName, "merchantName");
  const amountCents = requirePositiveInteger(input.amountCents, "amountCents");
  const { data: day, error: dayError } = await supabase
    .from("days")
    .select("id,date")
    .eq("id", dayId)
    .maybeSingle();

  if (dayError) {
    throw new Error(`Unable to validate day: ${dayError.message}`);
  }

  if (!day) {
    throw new Error("Day not found.");
  }

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      user_id: user.id,
      day_id: dayId,
      source: "manual",
      status: "applied",
      date: day.date,
      merchant_name: merchantName,
      amount: centsToDollars(amountCents),
      pending: false,
    })
    .select("id,day_id,date,created_at,merchant_name,amount,category,source,status")
    .single();

  if (error) {
    throw new Error(`Unable to add transaction: ${error.message}`);
  }

  const row = data as {
    id: string;
    day_id: string;
    date: string;
    created_at: string;
    merchant_name: string;
    amount: number | string;
    category: string | null;
  };

  return {
    ok: true,
    transaction: {
      id: row.id,
      dayId: row.day_id,
      merchantName: row.merchant_name,
      amountCents: dollarsToCents(Number(row.amount)),
      originalAmountCents: dollarsToCents(Number(row.amount)),
      category: row.category,
      source: "manual",
      status: "applied",
      isAmortized: false,
      isGasAllocated: false,
      gasAllocatedCents: 0,
      gasRemainderCents: dollarsToCents(Number(row.amount)),
      isEvChargeAllocated: false,
      evChargeAllocatedCents: 0,
      evChargeRemainderCents: dollarsToCents(Number(row.amount)),
      wasMovedToYesterday: false,
      date: row.date,
      time: null,
      createdAt: row.created_at,
    },
  };
}

function normalizeEarnSlotInput(input: SaveEarnSlotInput): SaveEarnSlotInput {
  const dayId = requireUuid(input.dayId, "dayId");
  const slotIndex = requireSlotIndex(input.slotIndex);
  const jobType = requireEnum(input.jobType, JOB_TYPES, "jobType");
  const label = input.label.trim();
  // custom_job_id is required IFF job_type='custom' (DB check constraint).
  const customJobId =
    jobType === "custom"
      ? requireUuid(input.customJobId ?? "", "customJobId")
      : null;

  if (jobType === "none") {
    return {
      dayId,
      slotIndex,
      jobType,
      payType: "none",
      hoursOrUnits: 0,
      regularHours: 0,
      overtimeHours: 0,
      incentiveMode: "none",
      incentiveRate: 0,
      incentiveAmount: 0,
      label: "",
    };
  }

  if (jobType === "incentive" || jobType === "other") {
    return {
      dayId,
      slotIndex,
      jobType,
      payType: "unit",
      hoursOrUnits: requireNonNegativeNumber(input.hoursOrUnits, "hoursOrUnits"),
      regularHours: 0,
      overtimeHours: 0,
      incentiveMode: "none",
      incentiveRate: 0,
      incentiveAmount: 0,
      label,
    };
  }

  const incentiveFields = normalizeIncentiveFields(input, jobType);
  const payType = normalizeWagePayType(input.payType);
  if (payType === "split") {
    const regularHours = requirePositiveNumber(
      input.regularHours ?? 0,
      "regularHours",
    );
    const overtimeHours = requirePositiveNumber(
      input.overtimeHours ?? 0,
      "overtimeHours",
    );

    return {
      dayId,
      slotIndex,
      jobType,
      payType,
      hoursOrUnits: regularHours + overtimeHours,
      regularHours,
      overtimeHours,
      ...incentiveFields,
      customJobId,
      label,
    };
  }

  const hoursOrUnits = requireNonNegativeNumber(
    input.hoursOrUnits,
    "hoursOrUnits",
  );

  return {
    dayId,
    slotIndex,
    jobType,
    payType,
    hoursOrUnits,
    regularHours: payType === "regular" ? hoursOrUnits : 0,
    overtimeHours: payType === "overtime" ? hoursOrUnits : 0,
    ...incentiveFields,
    customJobId,
    label,
  };
}

function normalizeIncentiveFields(
  input: SaveEarnSlotInput,
  jobType: JobType,
): {
  incentiveMode: IncentiveMode;
  incentiveRate: number;
  incentiveAmount: number;
} {
  if (jobType !== "ability" && jobType !== "ability_incentive") {
    return { incentiveMode: "none", incentiveRate: 0, incentiveAmount: 0 };
  }

  const incentiveMode = requireEnum(
    input.incentiveMode ?? "rate",
    INCENTIVE_MODES,
    "incentiveMode",
  );

  if (incentiveMode === "lump_sum") {
    return {
      incentiveMode,
      incentiveRate: 0,
      incentiveAmount: requireNonNegativeNumber(
        input.incentiveAmount ?? 0,
        "incentiveAmount",
      ),
    };
  }

  return {
    incentiveMode: "rate",
    incentiveRate: requireNonNegativeNumber(
      input.incentiveRate ?? 0,
      "incentiveRate",
    ),
    incentiveAmount: 0,
  };
}

function normalizeWagePayType(payType: PayType): PayType {
  if (payType === "regular" || payType === "overtime" || payType === "split") {
    return payType;
  }

  return "regular";
}

// Add N calendar months to an ISO yyyy-mm-dd date, clamping the day to the
// last valid day of the target month (e.g. Jan 31 + 1mo => Feb 28/29).
function addMonthsIso(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return target.toISOString().slice(0, 10);
}

function requireUuid(value: string, fieldName: string): string {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(value)) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return value;
}

function requireSlotIndex(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new Error("Invalid slotIndex.");
  }

  return value;
}

function requireNonNegativeInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return value;
}

function requirePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return value;
}

function requirePastDate(value: string, currentDate: string, fieldName: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${fieldName}. Use YYYY-MM-DD.`);
  }
  if (value >= currentDate) {
    throw new Error("Previous charge date must be before the current charge date.");
  }
  return value;
}

function requireNonNegativeNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return value;
}

function requirePositiveNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return value;
}

function requireNonEmptyString(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return trimmed;
}

function requireEnum<T extends string>(
  value: string,
  allowedValues: readonly T[],
  fieldName: string,
): T {
  const matched = allowedValues.find((allowedValue) => allowedValue === value);

  if (!matched) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return matched;
}

async function findPreviousEvChargeDate(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  chargeDate: string,
): Promise<string> {
  const { data: allocationData, error: allocationError } = await supabase
    .from("ev_charge_allocations")
    .select("charge_date")
    .eq("user_id", userId)
    .eq("is_active", true)
    .lt("charge_date", chargeDate)
    .order("charge_date", { ascending: false })
    .limit(1);
  if (allocationError) {
    throw new Error(
      `Unable to load EV charge history: ${allocationError.message}`,
    );
  }

  const priorAllocation = (allocationData ?? [])[0] as
    | { charge_date: string }
    | undefined;
  if (priorAllocation?.charge_date) {
    return String(priorAllocation.charge_date);
  }

  return addDaysIso(chargeDate, -1);
}

function centsToDollars(value: number): number {
  return value / 100;
}

function dollarsToCents(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100);
}
