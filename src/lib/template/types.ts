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
