import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/export/ledger-fields/route";

const mockCreateAdminClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

describe("/api/export/ledger-fields", () => {
  const originalToken = process.env.SHIFTLYCASH_LEDGER_TOKEN;
  const originalUserId = process.env.SHIFTLYCASH_LEDGER_USER_ID;

  afterEach(() => {
    vi.clearAllMocks();
    restoreEnv("SHIFTLYCASH_LEDGER_TOKEN", originalToken);
    restoreEnv("SHIFTLYCASH_LEDGER_USER_ID", originalUserId);
  });

  it("returns the ledger export shape with a valid token", async () => {
    process.env.SHIFTLYCASH_LEDGER_TOKEN = "test-token";
    process.env.SHIFTLYCASH_LEDGER_USER_ID = "user-1";
    mockCreateAdminClient.mockReturnValue(
      createSupabaseMock({
        debts: {
          data: [
            {
              id: "debt-1",
              name: "Auto Loan",
              balance: 14823.45,
              minimum_payment: 304.12,
              apr: 0.0799,
              status: "active",
            },
          ],
          error: null,
        },
        assets: {
          data: [
            {
              id: "asset-1",
              name: "Property fund",
              value: 250,
              category: "cash",
            },
          ],
          error: null,
        },
        v_week_totals: {
          data: [
            {
              start_date: "2026-05-04",
              status: "closed",
              earnings_total: 1400,
              ability_paycheck_earnings: 900,
              prestige_paycheck_earnings: 500,
              cashflow_total: 800,
            },
            {
              start_date: "2026-05-11",
              status: "active",
              earnings_total: 1500,
              ability_paycheck_earnings: 1000,
              prestige_paycheck_earnings: 500,
              cashflow_total: 850,
            },
          ],
          error: null,
        },
      }),
    );

    const response = await GET(
      new Request("http://localhost/api/export/ledger-fields", {
        headers: { authorization: "Bearer test-token" },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      week_of: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      debts: [
        {
          id: "debt-1",
          type: "auto_loan",
          balance: 14823.45,
          apr: 7.99,
          minimum_payment: 304.12,
          minimum_due_date: null,
          status: "active",
          starting_balance: 14823.45,
        },
      ],
      accounts: [
        { id: "emergency_cushion", label: "Emergency cushion", balance: 0 },
        { id: "property_fund", label: "Property fund", balance: 250 },
      ],
      cashflow: {
        week_start: "2026-05-11",
        actual_deployable_this_week: 850,
        target_weekly_deployable: 800,
        current_pay_period_total: 1500,
        ytd_deployable_actual: 1650,
      },
    });
    expect(payload.as_of).toEqual(expect.any(String));
  });

  it("returns 401 when the token is missing or wrong", async () => {
    process.env.SHIFTLYCASH_LEDGER_TOKEN = "test-token";

    const missing = await GET(
      new Request("http://localhost/api/export/ledger-fields"),
    );
    const wrong = await GET(
      new Request("http://localhost/api/export/ledger-fields", {
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

function createSupabaseMock(
  tables: Record<string, { data: unknown[]; error: { message: string } | null }>,
) {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };

      return {
        data: result.data,
        error: result.error,
        select() {
          return this;
        },
        eq() {
          return this;
        },
        gt() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        single() {
          return {
            data: result.data[0] ?? null,
            error: result.error,
          };
        },
      };
    },
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
