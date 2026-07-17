import { describe, expect, it } from "vitest";

import { calculateGasAverage } from "./average";

describe("calculateGasAverage", () => {
  it("returns null without gas allocations", () => {
    expect(calculateGasAverage([], "2026-07-17")).toBeNull();
  });

  it("uses the earliest tank start and an inclusive day count", () => {
    expect(
      calculateGasAverage(
        [
          {
            gasAmountCents: 6_000,
            startDate: "2026-07-08",
            fillDate: "2026-07-12",
          },
          {
            gasAmountCents: 4_500,
            startDate: "2026-07-03",
            fillDate: "2026-07-07",
          },
        ],
        "2026-07-17",
      ),
    ).toEqual({
      totalCents: 10_500,
      firstDate: "2026-07-03",
      periodDays: 15,
      dailyAverageCents: 700,
    });
  });

  it("falls back to the fill date and rounds only the final average", () => {
    expect(
      calculateGasAverage(
        [
          {
            gasAmountCents: 1_001.4,
            startDate: null,
            fillDate: "2026-07-15",
          },
        ],
        "2026-07-17",
      ),
    ).toEqual({
      totalCents: 1_001,
      firstDate: "2026-07-15",
      periodDays: 3,
      dailyAverageCents: 334,
    });
  });
});
