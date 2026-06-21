import { describe, expect, it } from "vitest";

import { sortDashboardTransactions } from "@/lib/dashboard/transactions";
import type { DashboardTransaction } from "@/lib/dashboard/types";

describe("sortDashboardTransactions", () => {
  it("sorts by transaction time instead of merchant or amount", () => {
    const rows = [
      transaction({ id: "c", merchantName: "Apple", amountCents: 10_000, time: "2026-05-02T18:30:00-04:00" }),
      transaction({ id: "a", merchantName: "Zoo", amountCents: 100, time: "2026-05-02T08:15:00-04:00" }),
      transaction({ id: "b", merchantName: "Market", amountCents: 5_000, time: "2026-05-02T12:00:00-04:00" }),
    ];

    expect(sortDashboardTransactions(rows).map((row) => row.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("handles legacy text times and puts no-time rows last", () => {
    const rows = [
      transaction({ id: "no-time", time: null, createdAt: "2026-05-02T08:00:00.000Z" }),
      transaction({ id: "night", time: "9:05 PM" }),
      transaction({ id: "morning", time: "07:30" }),
      transaction({ id: "afternoon", time: "2:15 p.m." }),
    ];

    expect(sortDashboardTransactions(rows).map((row) => row.id)).toEqual([
      "morning",
      "afternoon",
      "night",
      "no-time",
    ]);
  });

  it("falls back to creation order when transaction time is unavailable", () => {
    const rows = [
      transaction({ id: "second", time: null, createdAt: "2026-05-02T15:00:00.000Z" }),
      transaction({ id: "first", time: null, createdAt: "2026-05-02T14:00:00.000Z" }),
    ];

    expect(sortDashboardTransactions(rows).map((row) => row.id)).toEqual([
      "first",
      "second",
    ]);
  });
});

function transaction(
  overrides: Partial<DashboardTransaction>,
): DashboardTransaction {
  return {
    id: "tx",
    dayId: "day",
    merchantName: "Merchant",
    amountCents: 1_00,
    originalAmountCents: 1_00,
    category: null,
    source: "plaid",
    status: "applied",
    isAmortized: false,
    isGasAllocated: false,
    gasAllocatedCents: 0,
    gasRemainderCents: 1_00,
    date: "2026-05-02",
    time: "12:00",
    createdAt: "2026-05-02T12:00:00.000Z",
    ...overrides,
  };
}
