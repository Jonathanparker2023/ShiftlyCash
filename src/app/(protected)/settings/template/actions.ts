"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type { IncentiveMode, JobType, PayType } from "@/lib/domain/pay";
import type { TemplateSlotDraft } from "@/lib/template/types";

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
      regularHours: 0,
      overtimeHours: 0,
      incentiveMode: "none",
      incentiveRate: 0,
      incentiveAmount: 0,
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
      regularHours: 0,
      overtimeHours: 0,
      incentiveMode: "none",
      incentiveRate: 0,
      incentiveAmount: 0,
    };
  }

  const incentiveFields = normalizeIncentiveFields(slot, jobType);
  const payType = normalizeWagePayType(slot.payType);
  if (payType === "split") {
    const regularHours = requirePositiveNumber(
      slot.regularHours,
      "regularHours",
    );
    const overtimeHours = requirePositiveNumber(
      slot.overtimeHours,
      "overtimeHours",
    );

    return {
      dayIndex,
      slotIndex,
      jobType,
      payType,
      hoursOrUnits: regularHours + overtimeHours,
      regularHours,
      overtimeHours,
      ...incentiveFields,
    };
  }

  const hoursOrUnits = requireNonNegativeNumber(
    slot.hoursOrUnits,
    "hoursOrUnits",
  );

  return {
    dayIndex,
    slotIndex,
    jobType,
    payType,
    hoursOrUnits,
    regularHours: payType === "regular" ? hoursOrUnits : 0,
    overtimeHours: payType === "overtime" ? hoursOrUnits : 0,
    ...incentiveFields,
  };
}

function normalizeIncentiveFields(
  slot: TemplateSlotDraft,
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
    slot.incentiveMode ?? "rate",
    INCENTIVE_MODES,
    "incentiveMode",
  );

  if (incentiveMode === "lump_sum") {
    return {
      incentiveMode,
      incentiveRate: 0,
      incentiveAmount: requireNonNegativeNumber(
        slot.incentiveAmount,
        "incentiveAmount",
      ),
    };
  }

  return {
    incentiveMode: "rate",
    incentiveRate: requireNonNegativeNumber(slot.incentiveRate, "incentiveRate"),
    incentiveAmount: 0,
  };
}

function normalizeWagePayType(payType: PayType): PayType {
  if (payType === "regular" || payType === "overtime" || payType === "split") {
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

function requirePositiveNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value <= 0) {
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
