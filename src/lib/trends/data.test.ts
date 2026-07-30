import { describe, expect, it } from "vitest";

import { mapEnergyTracker } from "@/lib/trends/data";

describe("mapEnergyTracker", () => {
  it("freezes a historical gas average at the supplied end date", () => {
    const tracker = mapEnergyTracker(
      [
        energyEvent({
          id: "gas-1",
          date: "2026-07-20",
          startDate: "2026-07-17",
          amountCents: 2_800,
        }),
        energyEvent({
          id: "gas-2",
          date: "2026-07-30",
          startDate: "2026-07-21",
          amountCents: 4_200,
        }),
      ],
      "2026-07-30",
    );

    expect(tracker).toMatchObject({
      status: "active",
      periodStartDate: "2026-07-17",
      periodEndDate: "2026-07-30",
      periodDays: 14,
      totalCents: 7_000,
      averageDailyCents: 500,
    });
  });

  it("builds live EV averages and preserves merchant history", () => {
    const tracker = mapEnergyTracker(
      [
        energyEvent({
          id: "charge-1",
          date: "2026-07-29",
          startDate: "2026-07-29",
          merchantName: "Tesla Supercharger",
          amountCents: 3_000,
        }),
        energyEvent({
          id: "charge-2",
          date: "2026-07-30",
          startDate: "2026-07-30",
          merchantName: "ChargePoint",
          amountCents: 1_000,
        }),
      ],
      "2026-07-30",
    );

    expect(tracker).toMatchObject({
      status: "active",
      periodDays: 2,
      totalCents: 4_000,
      averageDailyCents: 2_000,
      events: [
        {
          id: "charge-2",
          merchantName: "ChargePoint",
          amountCents: 1_000,
        },
        {
          id: "charge-1",
          merchantName: "Tesla Supercharger",
          amountCents: 3_000,
        },
      ],
    });
  });

  it("waits cleanly before the first EV charge", () => {
    expect(mapEnergyTracker([], "2026-07-30")).toEqual({
      status: "waiting",
    });
  });
});

function energyEvent(
  overrides: Partial<Parameters<typeof mapEnergyTracker>[0][number]>,
): Parameters<typeof mapEnergyTracker>[0][number] {
  return {
    id: "event",
    date: "2026-07-30",
    startDate: "2026-07-30",
    merchantName: "Merchant",
    amountCents: 1_000,
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z",
    ...overrides,
  };
}
