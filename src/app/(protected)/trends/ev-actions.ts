"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type { EvChargingSettings } from "@/lib/ev/charging";

export type SaveEvChargingInput = EvChargingSettings & {
  weekId: string;
  milesDriven: number;
};

export type SaveEvChargingResult = {
  ok: true;
};

export async function saveEvChargingAction(
  input: SaveEvChargingInput,
): Promise<SaveEvChargingResult> {
  const { supabase, user } = await requireUser();
  const normalized = normalizeInput(input);
  const { data: ownedWeek, error: weekError } = await supabase
    .from("weeks")
    .select("id")
    .eq("id", normalized.weekId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (weekError) {
    throw new Error(`Unable to verify charging week: ${weekError.message}`);
  }
  if (!ownedWeek) {
    throw new Error("Charging week was not found.");
  }

  const [{ error: settingsError }, { error: weekSaveError }] =
    await Promise.all([
      supabase.from("ev_charging_settings").upsert(
        {
          user_id: user.id,
          efficiency_wh_per_mi: normalized.efficiencyWhPerMile,
          free_hours_per_week: normalized.freeHoursPerWeek,
          free_mi_per_hour: normalized.freeMilesPerHour,
          home_rate_cents_per_kwh: normalized.homeRateCentsPerKwh,
          public_rate_cents_per_kwh: normalized.publicRateCentsPerKwh,
          charging_loss_pct: normalized.chargingLossPercent,
          typical_miles_per_week: normalized.typicalMilesPerWeek,
          explorer_mpg: normalized.explorerMpg,
          gas_price_per_gal_cents: normalized.gasPricePerGallonCents,
          gas_archived: normalized.gasArchived,
        },
        { onConflict: "user_id" },
      ),
      supabase.from("ev_charging_weeks").upsert(
        {
          user_id: user.id,
          week_id: normalized.weekId,
          miles_driven: normalized.milesDriven,
        },
        { onConflict: "user_id,week_id" },
      ),
    ]);

  if (settingsError) {
    throw new Error(
      `Unable to save charging settings: ${settingsError.message}`,
    );
  }
  if (weekSaveError) {
    throw new Error(`Unable to save charging miles: ${weekSaveError.message}`);
  }

  revalidatePath("/trends");
  revalidatePath("/");
  revalidatePath("/dashboard");

  return { ok: true };
}

function normalizeInput(input: SaveEvChargingInput): SaveEvChargingInput {
  return {
    weekId: requireUuid(input.weekId),
    milesDriven: requireNumber(input.milesDriven, "milesDriven", 0, 5_000),
    efficiencyWhPerMile: requireNumber(
      input.efficiencyWhPerMile,
      "efficiencyWhPerMile",
      1,
      2_000,
    ),
    freeHoursPerWeek: requireNumber(
      input.freeHoursPerWeek,
      "freeHoursPerWeek",
      0,
      168,
    ),
    freeMilesPerHour: requireNumber(
      input.freeMilesPerHour,
      "freeMilesPerHour",
      0,
      25,
    ),
    homeRateCentsPerKwh: requireNumber(
      input.homeRateCentsPerKwh,
      "homeRateCentsPerKwh",
      0,
      500,
    ),
    publicRateCentsPerKwh: requireNumber(
      input.publicRateCentsPerKwh,
      "publicRateCentsPerKwh",
      0,
      500,
    ),
    chargingLossPercent: requireNumber(
      input.chargingLossPercent,
      "chargingLossPercent",
      0,
      100,
    ),
    typicalMilesPerWeek: requireNumber(
      input.typicalMilesPerWeek,
      "typicalMilesPerWeek",
      0,
      5_000,
    ),
    explorerMpg: requireNumber(input.explorerMpg, "explorerMpg", 1, 200),
    gasPricePerGallonCents: requireNumber(
      input.gasPricePerGallonCents,
      "gasPricePerGallonCents",
      0,
      5_000,
    ),
    gasArchived: Boolean(input.gasArchived),
  };
}

function requireNumber(
  value: number,
  field: string,
  min: number,
  max: number,
) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}.`);
  }
  return value;
}

function requireUuid(value: string) {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    )
  ) {
    throw new Error("weekId must be a UUID.");
  }
  return normalized;
}
