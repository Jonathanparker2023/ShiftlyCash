"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";

export type AddDebtResult = {
  ok: true;
  debtId: string;
  priorityOrder: number;
};

export async function addDebtAction(): Promise<AddDebtResult> {
  const { supabase, user } = await requireUser();
  const { data: existingDebts, error: existingError } = await supabase
    .from("debts")
    .select("priority_order")
    .eq("user_id", user.id);

  if (existingError) {
    throw new Error(`Unable to read debt order: ${existingError.message}`);
  }

  const priorityOrder =
    Math.max(
      0,
      ...((existingDebts ?? []) as { priority_order: number | null }[]).map(
        (row) => Number(row.priority_order ?? 0),
      ),
    ) + 10;
  const { data, error } = await supabase
    .from("debts")
    .insert({
      user_id: user.id,
      name: "New Debt",
      balance: 0,
      minimum_payment: 0,
      apr: 0,
      status: "active",
      priority_order: priorityOrder,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Unable to add debt: ${error.message}`);
  revalidatePath("/debt");
  return { ok: true, debtId: data.id as string, priorityOrder };
}

export type UpdateDebtInput = {
  debtId: string;
  name?: string;
  balanceCents?: number;
  minimumPaymentCents?: number;
  aprBps?: number;
  status?: "active" | "paid";
  priorityOrder?: number;
};

export async function updateDebtAction(input: UpdateDebtInput): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const patch: Record<string, unknown> = {};
  if (typeof input.name === "string") patch.name = input.name.trim() || "Debt";
  if (typeof input.balanceCents === "number") {
    patch.balance = input.balanceCents / 100;
    if (input.balanceCents <= 0 && input.status === undefined) {
      patch.status = "paid";
    }
  }
  if (typeof input.minimumPaymentCents === "number") {
    patch.minimum_payment = input.minimumPaymentCents / 100;
  }
  if (typeof input.aprBps === "number") patch.apr = input.aprBps / 10_000;
  if (input.status) patch.status = input.status;
  if (typeof input.priorityOrder === "number") {
    patch.priority_order = input.priorityOrder;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("debts")
    .update(patch)
    .eq("id", input.debtId);
  if (error) throw new Error(`Unable to update debt: ${error.message}`);
  revalidatePath("/debt");
  return { ok: true };
}

export async function deleteDebtAction(input: { debtId: string }): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("debts").delete().eq("id", input.debtId);
  if (error) throw new Error(`Unable to delete debt: ${error.message}`);
  revalidatePath("/debt");
  return { ok: true };
}

export async function reorderDebtsAction(input: {
  orderedIds: string[];
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const updates = input.orderedIds.map((id, index) =>
    supabase
      .from("debts")
      .update({ priority_order: (index + 1) * 10 })
      .eq("id", id),
  );
  const results = await Promise.all(updates);
  for (const r of results) {
    if (r.error) throw new Error(`Reorder failed: ${r.error.message}`);
  }
  revalidatePath("/debt");
  return { ok: true };
}
