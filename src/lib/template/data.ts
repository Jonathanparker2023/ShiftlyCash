import { requireUserWithBootstrapStatus } from "@/lib/auth";
import type { JobType, PayType } from "@/lib/domain/pay";
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

type TemplateSlotRow = {
  day_index: number;
  slot_index: number;
  job_type: JobType;
  pay_type: PayType;
  hours_or_units: NumericValue;
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
    .select("day_index,slot_index,job_type,pay_type,hours_or_units")
    .eq("template_id", template.id)
    .order("day_index", { ascending: true })
    .order("slot_index", { ascending: true });

  if (slotError) {
    throw new Error(`Unable to load template slots: ${slotError.message}`);
  }

  return {
    templateId: template.id,
    days: mapTemplateDays((slotData ?? []) as TemplateSlotRow[]),
  };
}

function mapTemplateDays(rows: TemplateSlotRow[]): TemplateDayDraft[] {
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
      ),
    ),
  }));
}

function mapTemplateSlot(
  dayIndex: number,
  slotIndex: number,
  row: TemplateSlotRow | undefined,
): TemplateSlotDraft {
  return {
    dayIndex,
    slotIndex,
    jobType: row?.job_type ?? "none",
    payType: row?.pay_type ?? "none",
    hoursOrUnits: toNumber(row?.hours_or_units ?? 0),
  };
}

function toNumber(value: NumericValue): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
