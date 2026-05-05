"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type { BaselineExpense } from "@/lib/baseline/types";

export type SaveExpenseInput = {
  id: string;
  name: string;
  amountCents: number;
  withdrawalDay: number | null;
  expirationDate: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type SaveExpenseResult = {
  ok: true;
  expense: BaselineExpense;
};

export type CreateExpenseResult = {
  ok: true;
  expense: BaselineExpense;
};

export type DeleteExpenseInput = {
  id: string;
};

export type DeleteExpenseResult = {
  ok: true;
  id: string;
};

type UserSupabaseClient = Awaited<ReturnType<typeof requireUser>>["supabase"];

export async function createExpenseAction(): Promise<CreateExpenseResult> {
  const { supabase, user } = await requireUser();
  const { data: maxSortRow, error: maxSortError } = await supabase
    .from("expenses")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxSortError) {
    throw new Error(`Unable to prepare expense: ${maxSortError.message}`);
  }

  const sortOrder = ((maxSortRow as { sort_order?: number } | null)?.sort_order ?? 0) + 10;
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      user_id: user.id,
      name: "",
      amount: 0,
      withdrawal_day: null,
      expiration_date: null,
      is_active: true,
      sort_order: sortOrder,
    })
    .select("id,name,amount,withdrawal_day,expiration_date,is_active,sort_order")
    .single();

  if (error) {
    throw new Error(`Unable to add expense: ${error.message}`);
  }

  await applyBaselineAndRevalidate(supabase, user.id);

  return {
    ok: true,
    expense: mapExpenseRow(data as ExpenseRow),
  };
}

export async function saveExpenseAction(
  input: SaveExpenseInput,
): Promise<SaveExpenseResult> {
  const { supabase, user } = await requireUser();
  const normalized = normalizeExpenseInput(input);

  const { data, error } = await supabase
    .from("expenses")
    .update({
      name: normalized.name,
      amount: centsToDollars(normalized.amountCents),
      withdrawal_day: normalized.withdrawalDay,
      expiration_date: normalized.expirationDate,
      is_active: normalized.isActive,
      sort_order: normalized.sortOrder,
    })
    .eq("id", normalized.id)
    .select("id,name,amount,withdrawal_day,expiration_date,is_active,sort_order")
    .single();

  if (error) {
    throw new Error(`Unable to save expense: ${error.message}`);
  }

  await applyBaselineAndRevalidate(supabase, user.id);

  return {
    ok: true,
    expense: mapExpenseRow(data as ExpenseRow),
  };
}

export async function deleteExpenseAction(
  input: DeleteExpenseInput,
): Promise<DeleteExpenseResult> {
  const { supabase, user } = await requireUser();
  const id = requireUuid(input.id, "id");
  const { error } = await supabase.from("expenses").delete().eq("id", id);

  if (error) {
    throw new Error(`Unable to delete expense: ${error.message}`);
  }

  await applyBaselineAndRevalidate(supabase, user.id);

  return {
    ok: true,
    id,
  };
}

async function applyBaselineAndRevalidate(
  supabase: UserSupabaseClient,
  userId: string,
) {
  const { error } = await supabase.rpc("apply_baseline_to_future_days", {
    p_user_id: userId,
  });

  if (error) {
    throw new Error(`Unable to apply baseline: ${error.message}`);
  }

  revalidatePath("/baseline");
  revalidatePath("/dashboard");
}

type ExpenseRow = {
  id: string;
  name: string;
  amount: number | string | null;
  withdrawal_day: number | null;
  expiration_date: string | null;
  is_active: boolean;
  sort_order: number;
};

function normalizeExpenseInput(input: SaveExpenseInput): SaveExpenseInput {
  return {
    id: requireUuid(input.id, "id"),
    name: input.name.trim(),
    amountCents: requireNonNegativeInteger(input.amountCents, "amountCents"),
    withdrawalDay: normalizeWithdrawalDay(input.withdrawalDay),
    expirationDate: normalizeDate(input.expirationDate),
    isActive: Boolean(input.isActive),
    sortOrder: requireInteger(input.sortOrder, "sortOrder"),
  };
}

function mapExpenseRow(row: ExpenseRow): BaselineExpense {
  return {
    id: row.id,
    name: row.name,
    amountCents: dollarsToCents(toNumber(row.amount)),
    withdrawalDay: row.withdrawal_day,
    expirationDate: row.expiration_date,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

function normalizeWithdrawalDay(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 1 || value > 31) {
    throw new Error("Invalid withdrawalDay.");
  }

  return value;
}

function normalizeDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid expirationDate.");
  }

  return value;
}

function requireUuid(value: string, fieldName: string): string {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(value)) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return value;
}

function requireInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value)) {
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

function centsToDollars(value: number): number {
  return value / 100;
}

function dollarsToCents(value: number): number {
  return Math.round(value * 100);
}

function toNumber(value: number | string | null): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
