"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { addDaysIso, getTodayIso } from "@/lib/dashboard/dates";
import { applyDashboardProjectionMaintenance } from "@/lib/dashboard/projectionMaintenance";
import type { IncentiveMode, JobType, PayType } from "@/lib/domain/pay";

const JOB_TYPES = [
  "ability",
  "ability_incentive",
  "prestige",
  "prestige_ilst",
  "incentive",
  "other",
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
    category: string | null;
    source: "manual";
    status: "applied";
    isAmortized: boolean;
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
    .select("id")
    .eq("id", normalized.dayId)
    .maybeSingle();

  if (dayError) {
    throw new Error(`Unable to validate day: ${dayError.message}`);
  }

  if (!day) {
    throw new Error("Day not found.");
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

  return {
    ok: true,
    slot: {
      ...normalized,
      id: row.id,
      source: "user",
    },
  };
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
  }

  return {
    ok: true,
    cleaned,
    projected,
  };
}

export async function toggleTransactionStatusAction(
  input: ToggleTransactionStatusInput,
): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
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

  return { ok: true };
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
  return { ok: true };
}

export async function moveTransactionToYesterdayAction(
  input: TransactionIdInput,
): Promise<{ ok: true; dayId: string; date: string }> {
  const { supabase } = await requireUser();
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
    })
    .eq("id", transactionId);

  if (error) {
    throw new Error(`Unable to move transaction: ${error.message}`);
  }

  revalidatePath("/");
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

  revalidatePath("/");
  return { ok: true, merchantName };
}

export async function amortizeTransactionAction(
  input: AmortizeTransactionInput,
): Promise<{ ok: true; expenseId: string }> {
  const { supabase, user } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");
  const months = requireEnum(
    String(input.months),
    ["1", "3"] as const,
    "months",
  );

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
    throw new Error("Transaction has no positive amount to amortize.");
  }

  const monthCount = months === "1" ? 1 : 3;
  // expenses.amount is a MONTHLY figure. 1mo => bill full amount over one month;
  // 3mo => bill a third per month for three months (sums to the full amount).
  const monthlyAmount =
    monthCount === 1 ? amount : Math.round((amount / 3) * 100) / 100;
  const transactionDate = String(transaction.date);
  const expirationDate = addMonthsIso(transactionDate, monthCount);
  const merchantName = String(transaction.merchant_name ?? "Expense").trim() || "Expense";
  const baseName = `${merchantName} (amort ${transactionDate})`;

  // expenses has a unique (user_id, name) constraint — find a free name.
  const { data: existingRows, error: existingError } = await supabase
    .from("expenses")
    .select("name")
    .ilike("name", `${baseName}%`);

  if (existingError) {
    throw new Error(`Unable to prepare expense: ${existingError.message}`);
  }

  const takenNames = new Set(
    (existingRows ?? []).map((row) => String((row as { name: string }).name)),
  );
  let expenseName = baseName;
  let suffix = 2;
  while (takenNames.has(expenseName)) {
    expenseName = `${baseName} #${suffix}`;
    suffix += 1;
  }

  const { data: maxSortRow, error: maxSortError } = await supabase
    .from("expenses")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxSortError) {
    throw new Error(`Unable to prepare expense: ${maxSortError.message}`);
  }

  const sortOrder =
    ((maxSortRow as { sort_order?: number } | null)?.sort_order ?? 0) + 10;

  const { data: expense, error: insertError } = await supabase
    .from("expenses")
    .insert({
      user_id: user.id,
      name: expenseName,
      amount: monthlyAmount,
      withdrawal_day: null,
      expiration_date: expirationDate,
      is_active: true,
      sort_order: sortOrder,
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`Unable to create amortized expense: ${insertError.message}`);
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

  const { error: baselineError } = await supabase.rpc(
    "apply_baseline_to_future_days",
    { p_user_id: user.id },
  );

  if (baselineError) {
    throw new Error(`Unable to apply baseline: ${baselineError.message}`);
  }

  revalidatePath("/");
  revalidatePath("/baseline");

  return { ok: true, expenseId: String((expense as { id: string }).id) };
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
      category: row.category,
      source: "manual",
      status: "applied",
      isAmortized: false,
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

function centsToDollars(value: number): number {
  return value / 100;
}

function dollarsToCents(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100);
}
