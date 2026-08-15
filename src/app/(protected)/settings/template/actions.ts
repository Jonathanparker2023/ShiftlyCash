"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type { IncentiveMode, JobType, PayType } from "@/lib/domain/pay";
import type { TemplateSlotDraft } from "@/lib/template/types";
import { MAX_SHIFT_SLOTS } from "@/lib/slots";

const JOB_TYPES = [
  "ability",
  "ability_incentive",
  "prestige",
  "prestige_ilst",
  "incentive",
  "other",
  "custom",
  "none",
] as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  const { supabase, user } = await requireUser();
  const slots = input.slots.map(normalizeTemplateSlot);

  const { data, error } = await supabase.rpc("replace_default_template_slots", {
    p_slots: slots,
  });

  if (error) {
    throw new Error(`Unable to save template: ${error.message}`);
  }

  // Labels now travel WITH the slot inside template_slots, written by the RPC
  // above. They used to be upserted separately into sticky_labels, keyed only
  // by (day_index, slot_index) with no template reference — so a label was
  // pinned to a grid position rather than to the shift sitting in it, and
  // reordering shifts left the names behind on the wrong rows.

  // Deliberately NOT revalidating /settings/template: this action fires on a
  // debounce while the user is still editing, and re-rendering the page they
  // are typing on is what makes the view jump. The client already holds the
  // authoritative draft; a fresh server render happens on the next navigation.
  revalidatePath("/");

  return {
    ok: true,
    savedCount: typeof data === "number" ? data : Number(data ?? 0),
  };
}

function normalizeTemplateSlot(slot: TemplateSlotDraft): TemplateSlotDraft {
  const dayIndex = requireIntegerInRange(slot.dayIndex, 0, 6, "dayIndex");
  const slotIndex = requireIntegerInRange(slot.slotIndex, 0, MAX_SHIFT_SLOTS - 1, "slotIndex");
  const jobType = requireEnum(slot.jobType, JOB_TYPES, "jobType");
  // Carried through on every branch: the label is part of the slot now, not a
  // separate row keyed by grid position.
  const label = typeof slot.label === "string" ? slot.label.trim() : "";

  let customJobId: string | null = null;
  if (jobType === "custom") {
    if (!UUID.test(slot.customJobId ?? "")) {
      throw new Error("A custom job must be selected for a custom slot.");
    }
    customJobId = slot.customJobId ?? null;
  }

  if (jobType === "none") {
    return {
      dayIndex,
      slotIndex,
      jobType,
      label,
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
      label,
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
      label,
      payType,
      hoursOrUnits: regularHours + overtimeHours,
      regularHours,
      overtimeHours,
      ...incentiveFields,
      customJobId,
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
    label,
    payType,
    hoursOrUnits,
    regularHours: payType === "regular" ? hoursOrUnits : 0,
    overtimeHours: payType === "overtime" ? hoursOrUnits : 0,
    ...incentiveFields,
    customJobId,
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
