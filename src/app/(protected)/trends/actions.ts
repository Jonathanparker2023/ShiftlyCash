"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";

export type RemoveEvChargeInput = {
  allocationId: string;
};

/**
 * Remove one EV charge from the history.
 *
 * Plaid can post the same Supercharger session twice (a pending row and then
 * the settled row under a different transaction id), and the auto-allocation
 * trigger tags both without a human ever seeing them. When that happens the
 * duplicate is not just wrong in the charging history — the money is not real,
 * so leaving it in ordinary spending would be just as wrong.
 *
 * So this does both, in the same order the dashboard does elsewhere:
 *   1. deactivates the allocation (never deletes it — the row stays as history)
 *   2. excludes the underlying transaction so the amount leaves spend entirely
 *
 * Both steps are reversible: the transaction can be re-applied from the
 * dashboard, and the allocation row is still on disk.
 */
export async function removeEvChargeAllocationAction(
  input: RemoveEvChargeInput,
): Promise<{ ok: true; merchantName: string; chargeDate: string }> {
  const { supabase, user } = await requireUser();

  const { data: allocation, error: loadError } = await supabase
    .from("ev_charge_allocations")
    .select("id,source_transaction_id,merchant_name,charge_date")
    .eq("id", input.allocationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (loadError) {
    throw new Error(`Unable to load EV charge: ${loadError.message}`);
  }
  if (!allocation) {
    throw new Error("EV charge not found.");
  }

  const row = allocation as {
    id: string;
    source_transaction_id: string;
    merchant_name: string;
    charge_date: string;
  };

  const { error: deactivateError } = await supabase
    .from("ev_charge_allocations")
    .update({ is_active: false })
    .eq("id", row.id)
    .eq("user_id", user.id);

  if (deactivateError) {
    throw new Error(`Unable to remove EV charge: ${deactivateError.message}`);
  }

  const { error: excludeError } = await supabase
    .from("transactions")
    .update({
      status: "excluded",
      excluded_at: new Date().toISOString(),
      review_reason: "duplicate_ev_charge",
    })
    .eq("id", row.source_transaction_id)
    .eq("user_id", user.id);

  if (excludeError) {
    throw new Error(
      `EV charge removed, but the transaction could not be excluded: ${excludeError.message}`,
    );
  }

  revalidatePath("/trends");
  revalidatePath("/");
  revalidatePath("/history");

  return {
    ok: true,
    merchantName: row.merchant_name,
    chargeDate: row.charge_date,
  };
}
