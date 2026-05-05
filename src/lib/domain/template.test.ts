import { describe, expect, it } from "vitest";

import { mergeTemplateWithStickyLabels } from "@/lib/domain/template";

describe("template helpers", () => {
  it("overlays sticky labels onto matching template positions", () => {
    const merged = mergeTemplateWithStickyLabels(
      [
        {
          dayIndex: 1,
          slotIndex: 0,
          jobType: "prestige",
          payType: "regular",
          hoursOrUnits: 13,
        },
        {
          dayIndex: 0,
          slotIndex: 0,
          jobType: "ability",
          payType: "regular",
          hoursOrUnits: 8,
        },
      ],
      [
        {
          dayIndex: 0,
          slotIndex: 0,
          label: "Sunrise Cottage",
        },
      ],
    );

    expect(merged).toEqual([
      {
        dayIndex: 0,
        slotIndex: 0,
        jobType: "ability",
        payType: "regular",
        hoursOrUnits: 8,
        label: "Sunrise Cottage",
        source: "template",
      },
      {
        dayIndex: 1,
        slotIndex: 0,
        jobType: "prestige",
        payType: "regular",
        hoursOrUnits: 13,
        label: "",
        source: "template",
      },
    ]);
  });
});
