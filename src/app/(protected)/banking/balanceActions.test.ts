import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getPlaidServerEnv: vi.fn(),
  refreshDeployableBalance: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
}));
vi.mock("@/lib/env", () => ({
  getPlaidServerEnv: mocks.getPlaidServerEnv,
}));
vi.mock("@/lib/plaid/deployableBalance", () => ({
  refreshDeployableBalance: mocks.refreshDeployableBalance,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import { refreshLiveBalancesAction } from "./balanceActions";

describe("refreshLiveBalancesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPlaidServerEnv.mockReturnValue({
      tokenEncryptionKey: "test-key",
    });
    mocks.refreshDeployableBalance.mockResolvedValue({
      as_of: "2026-08-28T10:00:00.000Z",
      deployable_balance: 123.45,
      accounts: [],
      source: "plaid",
      stale: false,
      has_fetched: true,
    });
  });

  it("refreshes balances for the authenticated user", async () => {
    const supabase = {};
    mocks.requireUser.mockResolvedValue({ user: { id: "user-1" } });
    mocks.createAdminClient.mockReturnValue(supabase);

    await expect(refreshLiveBalancesAction()).resolves.toEqual({
      ok: true,
      asOf: "2026-08-28T10:00:00.000Z",
      deployableBalance: 123.45,
    });
    expect(mocks.refreshDeployableBalance).toHaveBeenCalledWith({
      supabase,
      userId: "user-1",
      encryptionKey: "test-key",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/banking");
  });

  it("rejects an unauthenticated refresh before Plaid is called", async () => {
    mocks.requireUser.mockRejectedValue(new Error("Unauthorized"));

    await expect(refreshLiveBalancesAction()).rejects.toThrow("Unauthorized");
    expect(mocks.getPlaidServerEnv).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.refreshDeployableBalance).not.toHaveBeenCalled();
  });
});
