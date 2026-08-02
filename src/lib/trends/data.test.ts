import { describe, expect, it } from "vitest";

import {
  mapEnergyTracker,
  type TrendsWeek,
} from "@/lib/trends/data";

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

  it("keeps the all-time EV average while calculating each dashboard week separately", () => {
    const tracker = mapEnergyTracker(
      [
        energyEvent({
          id: "charge-1",
          date: "2026-07-27",
          startDate: "2026-07-26",
          amountCents: 7_000,
        }),
        energyEvent({
          id: "charge-2",
          date: "2026-08-02",
          startDate: "2026-08-02",
          amountCents: 1_200,
        }),
      ],
      "2026-08-02",
      [
        trendsWeek({
          weekId: "week-1",
          startDate: "2026-07-26",
          endDate: "2026-08-01",
          weekNumber: 26,
          status: "closed",
        }),
        trendsWeek({
          weekId: "week-2",
          startDate: "2026-08-02",
          endDate: "2026-08-08",
          weekNumber: 27,
          status: "active",
        }),
      ],
    );

    expect(tracker).toMatchObject({
      status: "active",
      periodStartDate: "2026-07-26",
      periodEndDate: "2026-08-02",
      periodDays: 8,
      totalCents: 8_200,
      averageDailyCents: 1_025,
      weeklyAverages: [
        {
          weekId: "week-2",
          periodDays: 1,
          totalCents: 1_200,
          averageDailyCents: 1_200,
          eventCount: 1,
        },
        {
          weekId: "week-1",
          periodDays: 7,
          totalCents: 7_000,
          averageDailyCents: 1_000,
          eventCount: 1,
        },
      ],
    });
  });

  it("keeps zero-charge weeks in the EV trend after tracking begins", () => {
    const tracker = mapEnergyTracker(
      [
        energyEvent({
          date: "2026-07-27",
          startDate: "2026-07-26",
          amountCents: 7_000,
        }),
      ],
      "2026-08-08",
      [
        trendsWeek({
          weekId: "week-1",
          startDate: "2026-07-26",
          endDate: "2026-08-01",
          weekNumber: 26,
          status: "closed",
        }),
        trendsWeek({
          weekId: "week-2",
          startDate: "2026-08-02",
          endDate: "2026-08-08",
          weekNumber: 27,
          status: "active",
        }),
      ],
    );

    expect(tracker.status).toBe("active");
    if (tracker.status !== "active") {
      throw new Error("Expected an active tracker.");
    }
    expect(tracker.weeklyAverages[0]).toMatchObject({
      weekId: "week-2",
      periodDays: 7,
      totalCents: 0,
      averageDailyCents: 0,
      eventCount: 0,
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

function trendsWeek(overrides: Partial<TrendsWeek>): TrendsWeek {
  return {
    weekId: "week",
    startDate: "2026-07-26",
    endDate: "2026-08-01",
    weekNumber: 26,
    status: "closed",
    earningsCents: 0,
    spendCents: 0,
    baseCents: 0,
    cashflowCents: 0,
    ...overrides,
  };
}
