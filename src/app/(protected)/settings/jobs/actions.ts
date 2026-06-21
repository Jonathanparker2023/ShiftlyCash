"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  netRateFromGross,
  normalizeWithholdingRate,
  otGrossFromRegular,
} from "@/lib/jobs/rates";

export type CustomJobInput = {
  name: string;
  color: string;
  regularGrossRateCents: number;
  withholdingRate: number;
};

const BUILTIN_JOB_KEYS = ["ability", "prestige", "prestige_ilst"] as const;
type BuiltinJobKey = (typeof BUILTIN_JOB_KEYS)[number];

const HEX = /^#[0-9a-fA-F]{6}$/;

function cleanName(value: string): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new Error("Job name must be 1–40 characters.");
  }
  return trimmed;
}

function cleanColor(value: string): string {
  if (!HEX.test(value ?? "")) {
    throw new Error("Color must be a 6-digit hex like #3b82f6.");
  }
  return value;
}

function cleanRate(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${field}.`);
  }
  return Math.round(value);
}

function cleanWithholding(value: number): number {
  return normalizeWithholdingRate(value);
}

function requireUuid(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error("Invalid job id.");
  }
  return value;
}

export async function createCustomJobAction(
  input: CustomJobInput,
): Promise<{ ok: true; id: string }> {
  const { supabase, user } = await requireUser();
  const withholdingRate = cleanWithholding(input.withholdingRate);
  const regularGrossRateCents = cleanRate(
    input.regularGrossRateCents,
    "regular gross rate",
  );
  // OT is always 1.5x the regular gross — never user-entered.
  const otGrossRateCents = otGrossFromRegular(regularGrossRateCents);
  const { data, error } = await supabase
    .from("custom_jobs")
    .insert({
      user_id: user.id,
      name: cleanName(input.name),
      color: cleanColor(input.color),
      regular_gross_rate_cents: regularGrossRateCents,
      ot_gross_rate_cents: otGrossRateCents,
      withholding_rate: withholdingRate,
      regular_rate_cents: netRateFromGross(regularGrossRateCents, withholdingRate),
      ot_rate_cents: netRateFromGross(otGrossRateCents, withholdingRate),
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`Unable to create job: ${error.message}`);
  }
  revalidatePath("/settings/jobs");
  revalidatePath("/");
  return { ok: true, id: String((data as { id: string }).id) };
}

export async function updateCustomJobAction(input: {
  id: string;
  name?: string;
  color?: string;
  regularGrossRateCents?: number;
  withholdingRate?: number;
  active?: boolean;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const id = requireUuid(input.id);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = cleanName(input.name);
  if (input.color !== undefined) patch.color = cleanColor(input.color);
  if (input.active !== undefined) patch.active = Boolean(input.active);

  if (
    input.regularGrossRateCents !== undefined ||
    input.withholdingRate !== undefined
  ) {
    const { data: current, error: currentError } = await supabase
      .from("custom_jobs")
      .select(
        "regular_rate_cents,ot_rate_cents,regular_gross_rate_cents,ot_gross_rate_cents,withholding_rate",
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (currentError) {
      throw new Error(`Unable to load job rates: ${currentError.message}`);
    }

    const row = current as {
      regular_rate_cents: number | string | null;
      ot_rate_cents: number | string | null;
      regular_gross_rate_cents: number | string | null;
      ot_gross_rate_cents: number | string | null;
      withholding_rate: number | string | null;
    };
    const existingRegularGross =
      Number(row.regular_gross_rate_cents ?? row.regular_rate_cents ?? 0) || 0;
    const existingWithholding = Number(row.withholding_rate ?? 0) || 0;
    const withholdingRate =
      input.withholdingRate !== undefined
        ? cleanWithholding(input.withholdingRate)
        : cleanWithholding(existingWithholding);
    const regularGrossRateCents =
      input.regularGrossRateCents !== undefined
        ? cleanRate(input.regularGrossRateCents, "regular gross rate")
        : Math.round(existingRegularGross);
    // OT is always derived as 1.5x the regular gross.
    const otGrossRateCents = otGrossFromRegular(regularGrossRateCents);

    patch.regular_gross_rate_cents = regularGrossRateCents;
    patch.ot_gross_rate_cents = otGrossRateCents;
    patch.withholding_rate = withholdingRate;
    patch.regular_rate_cents = netRateFromGross(
      regularGrossRateCents,
      withholdingRate,
    );
    patch.ot_rate_cents = netRateFromGross(otGrossRateCents, withholdingRate);
  }

  const { error } = await supabase
    .from("custom_jobs")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    throw new Error(`Unable to update job: ${error.message}`);
  }
  if (input.active === false) {
    await clearDeletedJobFromFutureTemplate(supabase, user.id, id);
  }
  revalidatePath("/settings/jobs");
  revalidatePath("/settings/template");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteCustomJobAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  return updateCustomJobAction({ id: input.id, active: false });
}

async function clearDeletedJobFromFutureTemplate(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  jobId: string,
): Promise<void> {
  const { error } = await supabase
    .from("template_slots")
    .update({
      job_type: "none",
      pay_type: "none",
      hours_or_units: 0,
      regular_hours: 0,
      overtime_hours: 0,
      incentive_mode: "none",
      incentive_rate: 0,
      incentive_amount: 0,
      custom_job_id: null,
    })
    .eq("user_id", userId)
    .eq("custom_job_id", jobId);
  if (error) {
    throw new Error(`Unable to clear deleted job from template: ${error.message}`);
  }
}

// Built-in pay rates live on the settings row (dollar-valued columns). Editing
// them here updates the existing rate the earnings views already read — no
// schema change, no effect on the additive custom path.
const BUILTIN_RATE_COLUMNS = {
  ability: ["ability_regular_net_rate", "ability_ot_net_rate"],
  prestige: ["prestige_regular_net_rate", "prestige_ot_net_rate"],
  prestige_ilst: ["prestige_ilst_net_rate", "prestige_ilst_ot_net_rate"],
} as const;

export async function updateBuiltinRatesAction(input: {
  jobKey: keyof typeof BUILTIN_RATE_COLUMNS;
  regularRateCents: number;
  otRateCents: number;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const cols = BUILTIN_RATE_COLUMNS[input.jobKey];
  if (!cols) {
    throw new Error("Invalid job.");
  }
  const patch: Record<string, number> = {
    [cols[0]]: cleanRate(input.regularRateCents, "regular rate") / 100,
    [cols[1]]: cleanRate(input.otRateCents, "overtime rate") / 100,
  };
  const { error } = await supabase
    .from("settings")
    .update(patch)
    .eq("user_id", user.id);
  if (error) {
    throw new Error(`Unable to update rates: ${error.message}`);
  }
  revalidatePath("/settings/jobs");
  revalidatePath("/");
  return { ok: true };
}

// "Delete" / "Restore" a built-in job. This is a DISPLAY hide only: it adds or
// removes the key from settings.hidden_builtin_jobs so it drops out of the shift
// + template pickers and the net bar. Past shifts and the paycheck model are
// never touched.
export async function setBuiltinHiddenAction(input: {
  jobKey: BuiltinJobKey;
  hidden: boolean;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  if (!BUILTIN_JOB_KEYS.includes(input.jobKey)) {
    throw new Error("Invalid job.");
  }
  const { data: current, error: loadError } = await supabase
    .from("settings")
    .select("hidden_builtin_jobs")
    .eq("user_id", user.id)
    .single();
  if (loadError) {
    throw new Error(`Unable to load settings: ${loadError.message}`);
  }
  const existing = new Set(
    ((current as { hidden_builtin_jobs: string[] | null }).hidden_builtin_jobs ??
      []) as string[],
  );
  if (input.hidden) {
    existing.add(input.jobKey);
  } else {
    existing.delete(input.jobKey);
  }
  const { error } = await supabase
    .from("settings")
    .update({ hidden_builtin_jobs: Array.from(existing) })
    .eq("user_id", user.id);
  if (error) {
    throw new Error(`Unable to update job visibility: ${error.message}`);
  }
  revalidatePath("/settings/jobs");
  revalidatePath("/settings/template");
  revalidatePath("/");
  return { ok: true };
}
