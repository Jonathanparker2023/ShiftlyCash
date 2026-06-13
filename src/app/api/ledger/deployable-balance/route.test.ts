import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/ledger/deployable-balance/route";

const mockCreateAdminClient = vi.hoisted(() => vi.fn());
const mockGetDeployableBalance = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/env", () => ({
  getPlaidServerEnv: () => ({
    clientId: "client",
    secret: "secret",
    env: "sandbox",
    products: ["transactions"],
    countryCodes: ["US"],
    tokenEncryptionKey: "token-key",
  }),
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
      source: "plaid",
      stale: false,
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
      source: "plaid",
      stale: false,
    });
    expect(mockGetDeployableBalance).toHaveBeenCalledWith({
      supabase,
      userId: "user-1",
      encryptionKey: "token-key",
      forcePlaidFailure: false,
    });
  });

  it("passes the dev-only forced cache flag through for verification", async () => {
    process.env.SHIFTLYCASH_LEDGER_TOKEN = "test-token";
    process.env.SHIFTLYCASH_LEDGER_USER_ID = "user-1";
    mockCreateAdminClient.mockReturnValue({});
    mockGetDeployableBalance.mockResolvedValue({
      as_of: "2026-06-13T14:30:00.000Z",
      deployable_balance: 0,
      accounts: [],
      source: "cache",
      stale: true,
    });

    await GET(
      new NextRequest(
        "http://localhost/api/ledger/deployable-balance?force_cache=1",
        {
          headers: { authorization: "Bearer test-token" },
        },
      ),
    );

    expect(mockGetDeployableBalance).toHaveBeenCalledWith(
      expect.objectContaining({ forcePlaidFailure: true }),
    );
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
