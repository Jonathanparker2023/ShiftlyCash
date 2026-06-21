import type { IncentiveMode, JobType, PayType } from "@/lib/domain/pay";

export type TemplateSlotDraft = {
  dayIndex: number;
  slotIndex: number;
  jobType: JobType;
  payType: PayType;
  hoursOrUnits: number;
  regularHours: number;
  overtimeHours: number;
  incentiveMode: IncentiveMode;
  incentiveRate: number;
  incentiveAmount: number;
  // The shift label (from sticky_labels). Used as the autofill label for
  // non-ability slots. Ability slots get app-managed labels at autofill time.
  // Optional: the server slot-normalizer (for template_slots) ignores it;
  // labels are persisted separately to sticky_labels.
  label?: string;
};

export type TemplateDayDraft = {
  dayIndex: number;
  label: string;
  slots: TemplateSlotDraft[];
};

export type TemplateEditorData = {
  templateId: string;
  days: TemplateDayDraft[];
};
