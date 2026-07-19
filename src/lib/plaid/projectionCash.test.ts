import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetOptionalPlaidServerEnv = vi.hoisted(() => vi.fn());
const mockGetDeployableBalance = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  getOptionalPlaidServerEnv: mockGetOptionalPlaidServerEnv,
}));
vi.mock("@/lib/plaid/deployableBalance", () => ({
  getDeployableBalance: mockGetDeployableBalance,
}));

import { getProjectionCashBalance } from "@/lib/plaid/projectionCash";

describe("getProjectionCashBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOptionalPlaidServerEnv.mockReturnValue({
      config: { tokenEncryptionKey: "test-key" },
      missing: [],
    });
  });

  it("converts a fresh Plaid available balance into projection cents", async () => {
    mockGetDeployableBalance.mockResolvedValue({
      deployable_balance: 6474.71,
      as_of: "2026-07-19T06:14:18.651Z",
      source: "plaid",
      stale: false,
      accounts: [],
    });

    const supabase = {} as never;
    await expect(
      getProjectionCashBalance({ supabase, userId: "user-1" }),
    ).resolves.toEqual({
      availableCashCents: 647_471,
      asOf: "2026-07-19T06:14:18.651Z",
      source: "plaid",
      stale: false,
    });
    expect(mockGetDeployableBalance).toHaveBeenCalledWith({
      supabase,
      userId: "user-1",
      encryptionKey: "test-key",
    });
  });

  it("fails closed when Plaid configuration is unavailable", async () => {
    mockGetOptionalPlaidServerEnv.mockReturnValue({
      config: null,
      missing: ["PLAID_CLIENT_ID"],
    });

    await expect(
      getProjectionCashBalance({ supabase: {} as never, userId: "user-1" }),
    ).resolves.toEqual({
      availableCashCents: 0,
      asOf: null,
      source: "unavailable",
      stale: true,
    });
    expect(mockGetDeployableBalance).not.toHaveBeenCalled();
  });

  it("does not present an empty fallback response as a real cached balance", async () => {
    mockGetDeployableBalance.mockResolvedValue({
      deployable_balance: 0,
      as_of: "2026-07-19T06:14:18.651Z",
      source: "cache",
      stale: true,
      accounts: [],
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
