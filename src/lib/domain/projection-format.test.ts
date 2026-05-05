import { describe, expect, it } from "vitest";

import {
  formatWeekDuration,
  formatWeekOffsetDateLabel,
} from "@/lib/domain/projection-format";

describe("projection formatting", () => {
  it("formats week durations consistently for cards and charts", () => {
    expect(formatWeekDuration(null)).toBe("-");
    expect(formatWeekDuration(0)).toBe("0 wks");
    expect(formatWeekDuration(12)).toBe("12 wks");
    expect(formatWeekDuration(52)).toBe("1 yrs 0 wks");
    expect(formatWeekDuration(65)).toBe("1 yrs 13 wks");
  });

  it("formats week-offset dates with UTC calendar math", () => {
    const now = new Date("2026-05-04T23:30:00-04:00");

    expect(formatWeekOffsetDateLabel(0, now)).toBe("May 4");
    expect(formatWeekOffsetDateLabel(2, now)).toBe("May 18");
  });
});
