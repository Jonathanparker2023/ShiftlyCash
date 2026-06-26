"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { dollarsToCents, centsToDollars } from "@/lib/domain/money";
import {
  PRESTIGE_JOB_KEY,
  isCustomJobKey,
  type PaycheckJobKey,
} from "@/lib/paychecks/data";

export async function savePaycheckActualAction(input: {
  weekId: string;
  jobType: PaycheckJobKey;
  actualCents: number | null;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const weekId = requireUuid(input.weekId, "weekId");
  const jobKey = requirePaycheckJob(input.jobType);
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

  const { data: existing, error: readError } = await supabase
    .from("paycheck_actuals")
    .select("job_actuals")
    .eq("week_id", weekId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Unable to load paycheck actual: ${readError.message}`);
  }

  const jobActuals: Record<string, number> = {
    ...((existing?.job_actuals as Record<string, number> | null) ?? {}),
  };
  if (actualCents === null) {
    delete jobActuals[jobKey];
  } else {
    jobActuals[jobKey] = centsToDollars(actualCents);
  }

  const row: Record<string, unknown> = {
    week_id: weekId,
    user_id: user.id,
    job_actuals: jobActuals,
  };
  // Keep the legacy prestige column in sync for any external reader.
  if (jobKey === PRESTIGE_JOB_KEY) {
    row.prestige_actual_amount =
      actualCents === null ? null : centsToDollars(actualCents);
  }

  const { error } = await supabase
    .from("paycheck_actuals")
    .upsert(row, { onConflict: "week_id" });

  if (error) {
    throw new Error(`Unable to save paycheck actual: ${error.message}`);
  }

  revalidatePath("/paychecks");

  return { ok: true };
}

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

  return dollarsToCents(centsToDollars(value));
}
