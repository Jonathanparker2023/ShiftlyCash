"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { dollarsToCents, centsToDollars } from "@/lib/domain/money";
import type { PaycheckJobKey } from "@/lib/paychecks/data";

export async function savePaycheckActualAction(input: {
  weekId: string;
  jobType: PaycheckJobKey;
  actualCents: number | null;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const weekId = requireUuid(input.weekId, "weekId");
  const jobType = requirePaycheckJob(input.jobType);
  const actualCents =
    input.actualCents === null
      ? null
      : requireNonNegativeInteger(input.actualCents, "actualCents");
  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select("id")
    .eq("id", weekId)
    .maybeSingle();

  if (weekError) {
    throw new Error(`Unable to validate paycheck week: ${weekError.message}`);
  }

  if (!week) {
    throw new Error("Paycheck week not found.");
  }

  const { error } = await supabase.from("paycheck_actuals").upsert(
    {
      week_id: weekId,
      user_id: user.id,
      [jobType === "ability" ? "ability_actual_amount" : "prestige_actual_amount"]:
        actualCents === null ? null : centsToDollars(actualCents),
    },
    { onConflict: "week_id" },
  );

  if (error) {
    throw new Error(`Unable to save paycheck actual: ${error.message}`);
  }

  revalidatePath("/paychecks");

  return { ok: true };
}

function requirePaycheckJob(value: PaycheckJobKey): PaycheckJobKey {
  if (value !== "ability" && value !== "prestige") {
    throw new Error("Invalid paycheck job.");
  }

  return value;
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

  return dollarsToCents(centsToDollars(value));
}
