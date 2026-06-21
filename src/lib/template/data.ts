import { requireUserWithBootstrapStatus } from "@/lib/auth";
import type { IncentiveMode, JobType, PayType } from "@/lib/domain/pay";
import type {
  TemplateDayDraft,
  TemplateEditorData,
  TemplateSlotDraft,
} from "@/lib/template/types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type NumericValue = number | string | null;

type TemplateRow = {
  id: string;
};

type StickyLabelRow = {
  day_index: number;
  slot_index: number;
  label: string;
};

type TemplateSlotRow = {
  day_index: number;
  slot_index: number;
  job_type: JobType;
  pay_type: PayType;
  hours_or_units: NumericValue;
  regular_hours: NumericValue;
  overtime_hours: NumericValue;
  incentive_mode: IncentiveMode | null;
  incentive_rate: NumericValue;
  incentive_amount: NumericValue;
};

export async function getTemplateEditorData(): Promise<TemplateEditorData> {
  const { supabase } = await requireUserWithBootstrapStatus();

  const { data: templateData, error: templateError } = await supabase
    .from("weekly_templates")
    .select("id")
    .eq("is_default", true)
    .single();

  if (templateError) {
    throw new Error(`Unable to load default template: ${templateError.message}`);
  }

  const template = templateData as TemplateRow;
  const { data: slotData, error: slotError } = await supabase
    .from("template_slots")
    .select(
      "day_index,slot_index,job_type,pay_type,hours_or_units,regular_hours,overtime_hours,incentive_mode,incentive_rate,incentive_amount",
    )
    .eq("template_id", template.id)
    .order("day_index", { ascending: true })
    .order("slot_index", { ascending: true });

  if (slotError) {
    throw new Error(`Unable to load template slots: ${slotError.message}`);
  }

  // Labels live in sticky_labels (keyed by day_index/slot_index), separate from
  // template_slots. Load them so the editor can view + edit shift labels.
  const { data: labelData, error: labelError } = await supabase
    .from("sticky_labels")
    .select("day_index,slot_index,label");
  if (labelError) {
    throw new Error(`Unable to load template labels: ${labelError.message}`);
  }
  const labelByPosition = new Map(
    ((labelData ?? []) as StickyLabelRow[]).map((row) => [
      `${row.day_index}:${row.slot_index}`,
      row.label,
    ]),
  );

  return {
    templateId: template.id,
    days: mapTemplateDays(
      (slotData ?? []) as TemplateSlotRow[],
      labelByPosition,
    ),
  };
}

function mapTemplateDays(
  rows: TemplateSlotRow[],
  labelByPosition: Map<string, string>,
): TemplateDayDraft[] {
  const slotsByPosition = new Map(
    rows.map((row) => [`${row.day_index}:${row.slot_index}`, row]),
  );

  return DAY_LABELS.map((label, dayIndex) => ({
    dayIndex,
    label,
    slots: Array.from({ length: 4 }, (_, slotIndex) =>
      mapTemplateSlot(
        dayIndex,
        slotIndex,
        slotsByPosition.get(`${dayIndex}:${slotIndex}`),
        labelByPosition.get(`${dayIndex}:${slotIndex}`) ?? "",
      ),
    ),
  }));
}

function mapTemplateSlot(
  dayIndex: number,
  slotIndex: number,
  row: TemplateSlotRow | undefined,
  label: string,
): TemplateSlotDraft {
  return {
    dayIndex,
    slotIndex,
    jobType: row?.job_type ?? "none",
    payType: row?.pay_type ?? "none",
    hoursOrUnits: toNumber(row?.hours_or_units ?? 0),
    regularHours: toNumber(row?.regular_hours ?? 0),
    overtimeHours: toNumber(row?.overtime_hours ?? 0),
    incentiveMode: mapIncentiveMode(row?.incentive_mode ?? null),
    incentiveRate: toNumber(row?.incentive_rate ?? 0),
    incentiveAmount: toNumber(row?.incentive_amount ?? 0),
    label,
  };
}

function mapIncentiveMode(value: string | null): IncentiveMode {
  if (value === "rate" || value === "lump_sum") {
    return value;
  }

  return "none";
}

function toNumber(value: NumericValue): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
