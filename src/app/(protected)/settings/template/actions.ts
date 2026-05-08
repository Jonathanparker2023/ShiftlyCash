"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type { PayType } from "@/lib/domain/pay";
import type { TemplateSlotDraft } from "@/lib/template/types";

const JOB_TYPES = [
  "ability",
  "prestige",
  "prestige_ilst",
  "incentive",
  "other",
  "none",
] as const;

export type SaveTemplateInput = {
  slots: TemplateSlotDraft[];
};

export type SaveTemplateResult = {
  ok: true;
  savedCount: number;
};

export async function saveDefaultTemplateAction(
  input: SaveTemplateInput,
): Promise<SaveTemplateResult> {
  const { supabase } = await requireUser();
  const slots = input.slots.map(normalizeTemplateSlot);

  const { data, error } = await supabase.rpc("replace_default_template_slots", {
    p_slots: slots,
  });

  if (error) {
    throw new Error(`Unable to save template: ${error.message}`);
  }

  revalidatePath("/settings/template");
  revalidatePath("/");

  return {
    ok: true,
    savedCount: typeof data === "number" ? data : Number(data ?? 0),
  };
}

function normalizeTemplateSlot(slot: TemplateSlotDraft): TemplateSlotDraft {
  const dayIndex = requireIntegerInRange(slot.dayIndex, 0, 6, "dayIndex");
  const slotIndex = requireIntegerInRange(slot.slotIndex, 0, 3, "slotIndex");
  const jobType = requireEnum(slot.jobType, JOB_TYPES, "jobType");

  if (jobType === "none") {
    return {
      dayIndex,
      slotIndex,
      jobType,
      payType: "none",
      hoursOrUnits: 0,
    };
  }

  if (jobType === "incentive" || jobType === "other") {
    return {
      dayIndex,
      slotIndex,
      jobType,
      payType: "unit",
      hoursOrUnits: requireNonNegativeNumber(
        slot.hoursOrUnits,
        "hoursOrUnits",
      ),
    };
  }

  return {
    dayIndex,
    slotIndex,
    jobType,
    payType: normalizeWagePayType(slot.payType),
    hoursOrUnits: requireNonNegativeNumber(slot.hoursOrUnits, "hoursOrUnits"),
  };
}

function normalizeWagePayType(payType: PayType): PayType {
  if (payType === "regular" || payType === "overtime") {
    return payType;
  }

  return "regular";
}

function requireIntegerInRange(
  value: number,
  min: number,
  max: number,
  fieldName: string,
): number {
  if (!Number.isInteger(value) || value < min || value > max) {
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
