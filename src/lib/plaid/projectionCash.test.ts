import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDeployableBalance = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/plaid/deployableBalance", () => ({
  getDeployableBalance: mockGetDeployableBalance,
}));

import { getProjectionCashBalance } from "@/lib/plaid/projectionCash";

describe("getProjectionCashBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts the cached available balance into projection cents", async () => {
    mockGetDeployableBalance.mockResolvedValue({
      deployable_balance: 6474.71,
      as_of: "2026-07-19T06:14:18.651Z",
      source: "cache",
      stale: false,
      has_fetched: true,
      accounts: [],
    });

    const supabase = {} as never;
    await expect(
      getProjectionCashBalance({ supabase, userId: "user-1" }),
    ).resolves.toEqual({
      availableCashCents: 647_471,
      asOf: "2026-07-19T06:14:18.651Z",
      source: "cache",
      stale: false,
    });
    expect(mockGetDeployableBalance).toHaveBeenCalledWith({
      supabase,
      userId: "user-1",
    });
  });

  it("does not present a not-fetched response as a real cached balance", async () => {
    mockGetDeployableBalance.mockResolvedValue({
      deployable_balance: 0,
      as_of: null,
      source: "cache",
      stale: true,
      accounts: [],
      has_fetched: false,
    });

    await expect(
      getProjectionCashBalance({ supabase: {} as never, userId: "user-1" }),
    ).resolves.toEqual({
      availableCashCents: 0,
      asOf: null,
      source: "unavailable",
      stale: true,
    });
  });
});
