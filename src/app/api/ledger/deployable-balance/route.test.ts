import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/ledger/deployable-balance/route";

const mockCreateAdminClient = vi.hoisted(() => vi.fn());
const mockGetDeployableBalance = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/plaid/deployableBalance", () => ({
  getDeployableBalance: mockGetDeployableBalance,
}));

describe("/api/ledger/deployable-balance", () => {
  const originalToken = process.env.SHIFTLYCASH_LEDGER_TOKEN;
  const originalUserId = process.env.SHIFTLYCASH_LEDGER_USER_ID;

  afterEach(() => {
    vi.clearAllMocks();
    restoreEnv("SHIFTLYCASH_LEDGER_TOKEN", originalToken);
    restoreEnv("SHIFTLYCASH_LEDGER_USER_ID", originalUserId);
  });

  it("returns the deployable balance payload with a valid token", async () => {
    process.env.SHIFTLYCASH_LEDGER_TOKEN = "test-token";
    process.env.SHIFTLYCASH_LEDGER_USER_ID = "user-1";
    const supabase = {};
    mockCreateAdminClient.mockReturnValue(supabase);
    mockGetDeployableBalance.mockResolvedValue({
      as_of: "2026-06-13T14:30:00.000Z",
      deployable_balance: 123.45,
      accounts: [
        {
          name: "Checking",
          type: "depository",
          subtype: "checking",
          available: 123.45,
          balance_basis: "available",
        },
      ],
      source: "cache",
      stale: false,
      has_fetched: true,
    });

    const response = await GET(
      new NextRequest("http://localhost/api/ledger/deployable-balance", {
        headers: { authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      as_of: "2026-06-13T14:30:00.000Z",
      deployable_balance: 123.45,
      accounts: [
        {
          name: "Checking",
          type: "depository",
          subtype: "checking",
          available: 123.45,
          balance_basis: "available",
        },
      ],
      source: "cache",
      stale: false,
      has_fetched: true,
    });
    expect(mockGetDeployableBalance).toHaveBeenCalledWith({
      supabase,
      userId: "user-1",
    });
  });

  it("does not expose a query parameter that can force a live refresh", async () => {
    process.env.SHIFTLYCASH_LEDGER_TOKEN = "test-token";
    process.env.SHIFTLYCASH_LEDGER_USER_ID = "user-1";
    const supabase = {};
    mockCreateAdminClient.mockReturnValue(supabase);
    mockGetDeployableBalance.mockResolvedValue({
      as_of: "2026-06-13T14:30:00.000Z",
      deployable_balance: 100,
      accounts: [],
      source: "cache",
      stale: false,
      has_fetched: true,
    });

    await GET(
      new NextRequest(
        "http://localhost/api/ledger/deployable-balance?refresh=1",
        {
          headers: { authorization: "Bearer test-token" },
        },
      ),
    );

    expect(mockGetDeployableBalance).toHaveBeenCalledWith({
      supabase,
      userId: "user-1",
    });
  });

  it("returns 401 when the token is missing or wrong", async () => {
    process.env.SHIFTLYCASH_LEDGER_TOKEN = "test-token";

    const missing = await GET(
      new NextRequest("http://localhost/api/ledger/deployable-balance"),
    );
    const wrong = await GET(
      new NextRequest("http://localhost/api/ledger/deployable-balance", {
        headers: { authorization: "Bearer wrong-token" },
      }),
    );

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
  });

  it("returns 405 for POST", async () => {
    const response = await POST();

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "Method not allowed",
    });
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
