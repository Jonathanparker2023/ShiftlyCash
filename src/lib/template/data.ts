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
  custom_job_id: string | null;
};

type CustomJobRow = {
  id: string;
  name: string;
  color: string;
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
      "day_index,slot_index,job_type,pay_type,hours_or_units,regular_hours,overtime_hours,incentive_mode,incentive_rate,incentive_amount,custom_job_id,label",
    )
    .eq("template_id", template.id)
    .order("day_index", { ascending: true })
    .order("slot_index", { ascending: true });

  if (slotError) {
    throw new Error(`Unable to load template slots: ${slotError.message}`);
  }

  // Labels travel WITH the slot in template_slots. They used to live in
  // sticky_labels keyed only by (day_index, slot_index), which pinned a name to
  // a grid position instead of to the shift in it — so reordering shifts left
  // the names behind on the wrong rows.
  const labelByPosition = new Map(
    ((slotData ?? []) as { day_index: number; slot_index: number; label: string | null }[]).map(
      (row) => [`${row.day_index}:${row.slot_index}`, row.label ?? ""],
    ),
  );

  // Custom jobs for the picker + to resolve color/name on custom slots. Include
  // inactive jobs that a slot might still reference so the bar still renders.
  const { data: jobData } = await supabase
    .from("custom_jobs")
    .select("id,name,color,active")
    .order("created_at", { ascending: true });
  const jobRows = (jobData ?? []) as (CustomJobRow & { active: boolean })[];
  const customJobsById = new Map(jobRows.map((row) => [row.id, row]));

  // Built-in jobs the user "deleted" — dropped from the template picker too.
  const { data: settingsData } = await supabase
    .from("settings")
    .select("hidden_builtin_jobs")
    .single();
  const hiddenBuiltins = ((settingsData as {
    hidden_builtin_jobs: string[] | null;
  } | null)?.hidden_builtin_jobs ?? []) as string[];

  return {
    templateId: template.id,
    days: mapTemplateDays(
      (slotData ?? []) as TemplateSlotRow[],
      labelByPosition,
      customJobsById,
    ),
    customJobs: jobRows
      .filter((row) => row.active)
      .map((row) => ({ id: row.id, name: row.name, color: row.color })),
    hiddenBuiltins,
  };
}

function mapTemplateDays(
  rows: TemplateSlotRow[],
  labelByPosition: Map<string, string>,
  customJobsById: Map<string, CustomJobRow>,
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
        customJobsById,
      ),
    ),
  }));
}

function mapTemplateSlot(
  dayIndex: number,
  slotIndex: number,
  row: TemplateSlotRow | undefined,
  label: string,
  customJobsById: Map<string, CustomJobRow>,
): TemplateSlotDraft {
  const customJob =
    row?.job_type === "custom" && row.custom_job_id
      ? customJobsById.get(row.custom_job_id)
      : undefined;
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
    customJobId: row?.custom_job_id ?? null,
    customColor: customJob?.color,
    customName: customJob?.name,
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
