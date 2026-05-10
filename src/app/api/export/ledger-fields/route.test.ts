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
              week_id: "week-1",
              start_date: "2026-05-04",
              end_date: "2026-05-10",
              status: "closed",
              pay_period_role: "week_1",
              paycheck_due_date: "2026-05-15",
              earnings_total: 1400,
              ability_paycheck_earnings: 900,
              prestige_paycheck_earnings: 500,
              spend_total: 600,
              cashflow_total: 800,
            },
            {
              week_id: "week-2",
              start_date: "2026-05-11",
              end_date: "2026-05-17",
              status: "active",
              pay_period_role: "week_2",
              paycheck_due_date: "2026-05-22",
              earnings_total: 1500,
              ability_paycheck_earnings: 1000,
              prestige_paycheck_earnings: 500,
              spend_total: 650,
              cashflow_total: 850,
            },
          ],
          error: null,
        },
        v_day_totals: {
          data: [
            { date: "2026-05-04", earnings_total: 100, spend_total: 40 },
            { date: "2026-05-05", earnings_total: 200, spend_total: 60 },
            { date: "2026-05-10", earnings_total: 300, spend_total: 80 },
          ],
          error: null,
        },
        days: {
          data: [
            { id: "day-1", date: "2026-05-04" },
            { id: "day-2", date: "2026-05-05" },
          ],
          error: null,
        },
        settings: {
          data: [
            {
              prestige_regular_net_rate: 14.62,
              prestige_ot_net_rate: 21.93,
              prestige_ilst_net_rate: 15.48,
              prestige_ilst_ot_net_rate: 23.22,
            },
          ],
          error: null,
        },
        transactions: {
          data: [
            {
              date: "2026-05-04",
              amount: 50,
              category: "Food",
              status: "applied",
            },
            {
              date: "2026-05-05",
              amount: 25,
              category: "Transport",
              status: "applied",
            },
            {
              date: "2026-05-05",
              amount: 5,
              category: "Ignored",
              status: "excluded",
            },
          ],
          error: null,
        },
        earn_slots: {
          data: [
            {
              day_id: "day-1",
              job_type: "ability",
              pay_type: "regular",
              hours_or_units: 4,
              regular_hours: 4,
              overtime_hours: 0,
            },
            {
              day_id: "day-2",
              job_type: "prestige_ilst",
              pay_type: "split",
              hours_or_units: 12,
              regular_hours: 4,
              overtime_hours: 8,
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
    expect(payload.income).toMatchObject({
      this_week_net: expect.any(Number),
      this_week_gross: expect.any(Number),
      current_pay_period_net: expect.any(Number),
      current_pay_period_gross: expect.any(Number),
      rolling_30d_net: expect.any(Number),
      ytd_net: expect.any(Number),
      ytd_gross: expect.any(Number),
      paychecks_this_period: [
        { date: "2026-05-22", amount: expect.any(Number) },
      ],
    });
    expect(payload.spending).toMatchObject({
      this_week_total: expect.any(Number),
      current_pay_period_total: expect.any(Number),
      rolling_30d_total: expect.any(Number),
      ytd_total: expect.any(Number),
      top_categories_rolling_30d: [
        { category: "Food", amount: 50, pct_of_total: expect.any(Number) },
        { category: "Transport", amount: 25, pct_of_total: expect.any(Number) },
      ],
    });
    const topCategoryTotal = payload.spending.top_categories_rolling_30d.reduce(
      (sum: number, category: { amount: number }) => sum + category.amount,
      0,
    );
    expect(topCategoryTotal).toBeLessThanOrEqual(
      payload.spending.rolling_30d_total,
    );
    [
      payload.income.this_week_net,
      payload.income.this_week_gross,
      payload.income.current_pay_period_net,
      payload.income.current_pay_period_gross,
      payload.income.rolling_30d_net,
      payload.income.ytd_net,
      payload.income.ytd_gross,
      payload.spending.this_week_total,
      payload.spending.current_pay_period_total,
      payload.spending.rolling_30d_total,
      payload.spending.ytd_total,
    ].forEach((value) => {
      expect(typeof value).toBe("number");
      expect(hasAtMostTwoDecimals(value)).toBe(true);
    });
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
        gte() {
          return this;
        },
        lte() {
          return this;
        },
        in() {
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

function hasAtMostTwoDecimals(value: number) {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
