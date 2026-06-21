"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";

export type CustomJobInput = {
  name: string;
  color: string;
  regularRateCents: number;
  otRateCents: number;
};

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
  const { data, error } = await supabase
    .from("custom_jobs")
    .insert({
      user_id: user.id,
      name: cleanName(input.name),
      color: cleanColor(input.color),
      regular_rate_cents: cleanRate(input.regularRateCents, "regular rate"),
      ot_rate_cents: cleanRate(input.otRateCents, "overtime rate"),
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
  regularRateCents?: number;
  otRateCents?: number;
  active?: boolean;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const id = requireUuid(input.id);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = cleanName(input.name);
  if (input.color !== undefined) patch.color = cleanColor(input.color);
  if (input.regularRateCents !== undefined)
    patch.regular_rate_cents = cleanRate(input.regularRateCents, "regular rate");
  if (input.otRateCents !== undefined)
    patch.ot_rate_cents = cleanRate(input.otRateCents, "overtime rate");
  if (input.active !== undefined) patch.active = Boolean(input.active);

  const { error } = await supabase
    .from("custom_jobs")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    throw new Error(`Unable to update job: ${error.message}`);
  }
  revalidatePath("/settings/jobs");
  revalidatePath("/");
  return { ok: true };
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
