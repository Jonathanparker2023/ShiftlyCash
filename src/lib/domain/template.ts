import type { JobType, PayType } from "@/lib/domain/pay";

export type TemplateSlotInput = {
  dayIndex: number;
  slotIndex: number;
  jobType: JobType;
  payType: PayType;
  hoursOrUnits: number;
  regularHours?: number;
  overtimeHours?: number;
};

export type StickyLabelInput = {
  dayIndex: number;
  slotIndex: number;
  label: string;
};

export type TemplateEarnSlotInput = TemplateSlotInput & {
  label: string;
  source: "template";
};

export function mergeTemplateWithStickyLabels(
  templateSlots: TemplateSlotInput[],
  stickyLabels: StickyLabelInput[],
): TemplateEarnSlotInput[] {
  const stickyLabelsByPosition = new Map(
    stickyLabels.map((label) => [positionKey(label), label.label]),
  );

  return [...templateSlots]
    .sort((left, right) => {
      if (left.dayIndex !== right.dayIndex) {
        return left.dayIndex - right.dayIndex;
      }

      return left.slotIndex - right.slotIndex;
    })
    .map((slot) => ({
      ...slot,
      label: stickyLabelsByPosition.get(positionKey(slot)) ?? "",
      source: "template",
    }));
}

function positionKey(position: { dayIndex: number; slotIndex: number }): string {
  return `${position.dayIndex}:${position.slotIndex}`;
}
