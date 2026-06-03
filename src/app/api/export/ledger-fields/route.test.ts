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
              priority_order: 1,
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
              linked_debt_id: "debt-1",
            },
          ],
          error: null,
        },
        v_week_totals: {
          data: [
            {
              week_id: "week-1",
              start_date: "2026-04-27",
              end_date: "2026-05-03",
              display_week_number: 17,
              status: "closed",
              pay_period_role: "week_2",
              paycheck_due_date: "2026-05-08",
              earnings_total: 1400,
              ability_paycheck_earnings: 900,
              prestige_paycheck_earnings: 500,
              spend_total: 600,
              base_total: 200,
              cashflow_total: 600,
              running_balance: 600,
            },
            {
              week_id: "week-2",
              start_date: "2026-05-04",
              end_date: "2026-05-10",
              display_week_number: 18,
              status: "active",
              pay_period_role: "week_1",
              paycheck_due_date: null,
              earnings_total: 600,
              ability_paycheck_earnings: 400,
              prestige_paycheck_earnings: 200,
              spend_total: 180,
              base_total: 60,
              cashflow_total: 360,
              running_balance: 960,
            },
          ],
          error: null,
        },
        v_day_totals: {
          data: [
            {
              date: "2026-05-04",
              earnings_total: 100,
              spend_total: 40,
              base_amount: 10,
              cashflow_total: 50,
            },
            {
              date: "2026-05-05",
              earnings_total: 200,
              spend_total: 60,
              base_amount: 20,
              cashflow_total: 120,
            },
            {
              date: "2026-05-10",
              earnings_total: 300,
              spend_total: 80,
              base_amount: 30,
              cashflow_total: 190,
            },
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
              ability_withholding_rate: 0.2652,
              prestige_withholding_rate: 0.14,
              filing_fee: 160,
              standard_deduction: 15000,
            },
          ],
          error: null,
        },
        v_active_expense_totals: {
          data: [
            {
              monthly_total: 1200,
              projected_daily_base: 42,
            },
          ],
          error: null,
        },
        transactions: {
          data: [
            {
              date: "2026-05-05",
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
        week_projection_exclusions: {
          data: [
            {
              week_id: "week-1",
              exclude_earnings: false,
              exclude_spend: false,
              exclude_cashflow: false,
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

    expect(payload.error).toBeUndefined();
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
          priority_order: 1,
        },
      ],
      accounts: [
        { id: "emergency_cushion", label: "Emergency cushion", balance: 0 },
        { id: "property_fund", label: "Property fund", balance: 250 },
      ],
      cashflow: {
        week_start: "2026-05-04",
        actual_deployable_this_week: 360,
        target_weekly_deployable: 600,
        current_pay_period_total: 360,
        ytd_deployable_actual: 960,
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
        { date: "2026-05-17", amount: expect.any(Number) },
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
    expect(payload.baseline).toMatchObject({
      this_week_total: expect.any(Number),
      current_pay_period_total: expect.any(Number),
      rolling_30d_total: expect.any(Number),
      ytd_total: expect.any(Number),
      current_daily_base: expect.any(Number),
      monthly_total: expect.any(Number),
    });
    expect(payload.history).toMatchObject({
      current_week: {
        week_id: "week-2",
        start_date: "2026-05-04",
        end_date: "2026-05-10",
        display_week_number: 18,
        status: "active",
        pay_period_role: "week_1",
        earnings: 600,
        spend: 180,
        base: 60,
        cashflow: 360,
        running_balance: 960,
        exclusions: {
          earnings: false,
          spend: false,
          cashflow: false,
        },
      },
      closed_week_count: 1,
      summary: {
        total_earnings: 1400,
        total_spend: 600,
        avg_earnings: 1400,
        avg_spend: 600,
        avg_cashflow: 600,
        median_earnings: 1400,
        median_spend: 600,
        median_cashflow: 600,
      },
      recent_closed_weeks: [
        {
          week_id: "week-1",
          display_week_number: 17,
          earnings: 1400,
          spend: 600,
          base: 200,
          cashflow: 600,
          running_balance: 600,
        },
      ],
    });
    expect(payload.debt_totals).toMatchObject({
      total_active_debt: 14823.45,
      active_debt_count: 1,
      total_min_pay_monthly: 304.12,
      total_min_pay_weekly: expect.any(Number),
    });
    expect(payload.projection).toMatchObject({
      wpc: expect.any(Number),
      mwe: expect.any(Number),
      avg_earnings: expect.any(Number),
      recent_earnings: expect.any(Array),
      recent_cashflow: expect.any(Array),
      weeks_remaining: expect.any(Number),
      ytd_cashflow: expect.any(Number),
      ytd_earnings: expect.any(Number),
      ypgc: expect.any(Number),
      ypwi_net: expect.any(Number),
      ypwi_gross: expect.any(Number),
      withheld_year_to_date: expect.any(Number),
      fed_liability: expect.any(Number),
      ct_liability: expect.any(Number),
      fica_liability: expect.any(Number),
      total_liability: expect.any(Number),
      est_remaining_tax_owed: expect.any(Number),
      ypnc: expect.any(Number),
    });
    expect(payload.plan_metrics).toMatchObject({
      weekly_tax_due: expect.any(Number),
      investable_weekly_cashflow: expect.any(Number),
      debt_free_date_iso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      millionaire_date_iso: expect.any(String),
      age_at_millionaire: expect.any(Number),
      millionaire_duration_label: expect.any(String),
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
      payload.baseline.this_week_total,
      payload.baseline.current_pay_period_total,
      payload.baseline.rolling_30d_total,
      payload.baseline.ytd_total,
      payload.baseline.current_daily_base,
      payload.baseline.monthly_total,
      payload.history.current_week.earnings,
      payload.history.current_week.spend,
      payload.history.current_week.base,
      payload.history.current_week.cashflow,
      payload.history.current_week.running_balance,
      payload.history.summary.total_earnings,
      payload.history.summary.total_spend,
      payload.history.summary.avg_earnings,
      payload.history.summary.avg_spend,
      payload.history.summary.avg_cashflow,
      payload.history.summary.median_earnings,
      payload.history.summary.median_spend,
      payload.history.summary.median_cashflow,
      payload.debt_totals.total_active_debt,
      payload.debt_totals.total_min_pay_monthly,
      payload.debt_totals.total_min_pay_weekly,
      payload.projection.wpc,
      payload.projection.mwe,
      payload.projection.avg_earnings,
      payload.projection.ytd_cashflow,
      payload.projection.ytd_earnings,
      payload.projection.ypgc,
      payload.projection.ypwi_net,
      payload.projection.ypwi_gross,
      payload.projection.withheld_year_to_date,
      payload.projection.fed_liability,
      payload.projection.ct_liability,
      payload.projection.fica_liability,
      payload.projection.total_liability,
      payload.projection.est_remaining_tax_owed,
      payload.projection.ypnc,
      payload.plan_metrics.weekly_tax_due,
      payload.plan_metrics.investable_weekly_cashflow,
    ].forEach((value) => {
      expect(typeof value).toBe("number");
      expect(hasAtMostTwoDecimals(value)).toBe(true);
    });
    expect(payload.debt_totals.total_active_debt).toBe(
      payload.debts.reduce(
        (sum: number, debt: { balance: number; status: string }) =>
          debt.status === "active" ? sum + debt.balance : sum,
        0,
      ),
    );
    expect(payload.plan_metrics.investable_weekly_cashflow).toBe(
      Math.max(0, round2(payload.projection.wpc - payload.plan_metrics.weekly_tax_due)),
    );
    expect(Date.parse(payload.plan_metrics.debt_free_date_iso)).not.toBeNaN();
    expect(Date.parse(payload.plan_metrics.millionaire_date_iso)).not.toBeNaN();
    expect(
      round2(
        payload.income.this_week_net -
          payload.spending.this_week_total -
          payload.baseline.this_week_total,
      ),
    ).toBe(payload.cashflow.actual_deployable_this_week);
    expect(
      round2(
        payload.income.current_pay_period_net -
          payload.spending.current_pay_period_total -
          payload.baseline.current_pay_period_total,
      ),
    ).toBe(payload.cashflow.current_pay_period_total);
    expect(
      round2(
        payload.income.ytd_net -
          payload.spending.ytd_total -
          payload.baseline.ytd_total,
      ),
    ).toBe(payload.cashflow.ytd_deployable_actual);
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
        maybeSingle() {
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

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
