import { NextResponse } from "next/server";

import { addDaysIso, getTodayIso } from "@/lib/dashboard/dates";
import { centsToDollars, dollarsToCents } from "@/lib/domain/money";
import { formatWeekDuration } from "@/lib/domain/projection-format";
import {
  applyDebtLumpSum,
  calcWeeklyProjection,
  simulateDebtFree,
  simulateLegacyMillionaire,
  type DebtRow as ProjectionDebtRow,
  type WeekRow as ProjectionWeekRow,
} from "@/lib/domain/projections";
import { getProjectionCashBalance } from "@/lib/plaid/projectionCash";
import { createAdminClient } from "@/lib/supabase/admin";

type NumericValue = number | string | null;

type DebtRow = {
  id: string;
  name: string;
  balance: NumericValue;
  minimum_payment: NumericValue;
  apr: NumericValue;
  status: "active" | "paid";
  priority_order: NumericValue;
};

type CreditCardAccountRow = {
  id: string;
  name: string;
  issuer: string;
  last_four: string | null;
  account_kind: "credit_card" | "store_card";
  account_status: "active" | "paid" | "replacement_pending" | "unverified";
  raw_current_balance: NumericValue;
  planning_balance: NumericValue;
  statement_balance: NumericValue;
  statement_date: string | null;
  pending_total: NumericValue;
  credit_limit: NumericValue;
  available_credit: NumericValue;
  minimum_due: NumericValue;
  due_date: string | null;
  autopay_status: "on" | "off" | "unknown" | "paused";
  autopay_mode: string | null;
  autopay_day: NumericValue;
  autopay_source_label: string | null;
  apr: NumericValue;
  verification_status: "verified" | "user_reported" | "unverified" | "disputed";
  verified_at: string | null;
  disputed_total: NumericValue;
  risk_status: "clear" | "open_dispute" | "unverified";
  notes: string | null;
};

type AssetRow = {
  id: string;
  name: string;
  value: NumericValue;
  category: string;
  linked_debt_id: string | null;
};

type WeekTotalRow = {
  week_id: string;
  start_date: string;
  end_date: string;
  display_week_number: NumericValue;
  status: string;
  pay_period_role: "week_1" | "week_2";
  paycheck_due_date: string | null;
  earnings_total: NumericValue;
  ability_paycheck_earnings: NumericValue;
  prestige_paycheck_earnings: NumericValue;
  spend_total: NumericValue;
  base_total: NumericValue;
  cashflow_total: NumericValue;
  running_balance: NumericValue;
};

type DayTotalRow = {
  date: string;
  earnings_total: NumericValue;
  spend_total: NumericValue;
  base_amount: NumericValue;
  cashflow_total: NumericValue;
};

type DayRow = {
  id: string;
  date: string;
};

type EarnSlotRow = {
  day_id: string;
  job_type:
    | "ability"
    | "ability_incentive"
    | "prestige"
    | "prestige_ilst"
    | "incentive"
    | "other"
    | "none";
  pay_type: "regular" | "overtime" | "split" | "unit" | "none";
  hours_or_units: NumericValue;
  regular_hours: NumericValue;
  overtime_hours: NumericValue;
  incentive_mode: "none" | "rate" | "lump_sum" | null;
  incentive_rate: NumericValue;
  incentive_amount: NumericValue;
};

type SettingsRow = {
  prestige_regular_net_rate: NumericValue;
  prestige_ot_net_rate: NumericValue;
  prestige_ilst_net_rate: NumericValue;
  prestige_ilst_ot_net_rate: NumericValue;
  ability_withholding_rate: NumericValue;
  prestige_withholding_rate: NumericValue;
  filing_fee: NumericValue;
  standard_deduction: NumericValue;
};

type BaselineTotalRow = {
  monthly_total: NumericValue;
  projected_daily_base: NumericValue;
};

type TransactionRow = {
  date: string;
  amount: NumericValue;
  category: string | null;
  status: string;
};

type ProjectionExclusionRow = {
  week_id: string;
  exclude_earnings: boolean;
  exclude_spend: boolean;
  exclude_cashflow: boolean;
};

const LEDGER_TOKEN_ENV = "SHIFTLYCASH_LEDGER_TOKEN";
const LEDGER_USER_ID_ENV = "SHIFTLYCASH_LEDGER_USER_ID";
const ABILITY_REGULAR_GROSS_RATE = 19.055;
const ABILITY_OVERTIME_GROSS_RATE = 28.5825;
const PRESTIGE_WITHHOLDING_RATE = 0.14;
const DEFAULT_PRESTIGE_REGULAR_NET_RATE = 14.62;
const DEFAULT_PRESTIGE_OVERTIME_NET_RATE = 21.93;
const DEFAULT_PRESTIGE_ILST_REGULAR_NET_RATE = 15.48;
const DEFAULT_PRESTIGE_ILST_OVERTIME_NET_RATE = 23.22;
const MILLIONAIRE_TARGET_CENTS = 100_000_000;
const MILLIONAIRE_ANNUAL_RETURN = 0.1;
const ROLLING_WINDOW_WEEKS = 2;
const OWNER_BIRTH_YEAR = 1998;
const OWNER_BIRTH_MONTH = 0;
const OWNER_BIRTH_DAY = 12;

export async function GET(request: Request) {
  const authResult = authorizeLedgerRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const supabase = createAdminClient();
    const userId = await resolveLedgerUserId(supabase);
    const asOf = new Date();
    const asOfIso = asOf.toISOString();
    const todayIso = getTodayIso();
    const weekOf = mondayOnOrBeforeIso(todayIso);
    const rolling30StartIso = addDaysIso(todayIso, -29);
    const yearStartIso = `${todayIso.slice(0, 4)}-01-01`;
    const [
      debtsRes,
      creditCardsRes,
      assetsRes,
      weeksRes,
      dayTotalsRes,
      daysRes,
      settingsRes,
      baselineTotalsRes,
      transactionsRes,
      cashBalance,
    ] =
      await Promise.all([
      supabase
        .from("debts")
        .select("id,name,balance,minimum_payment,apr,status,priority_order")
        .eq("user_id", userId)
        .eq("status", "active")
        .gt("balance", 0)
        .order("priority_order", { ascending: true }),
      supabase
        .from("credit_card_accounts")
        .select(
          "id,name,issuer,last_four,account_kind,account_status,raw_current_balance,planning_balance,statement_balance,statement_date,pending_total,credit_limit,available_credit,minimum_due,due_date,autopay_status,autopay_mode,autopay_day,autopay_source_label,apr,verification_status,verified_at,disputed_total,risk_status,notes",
        )
        .eq("user_id", userId)
        .order("name", { ascending: true }),
      supabase
        .from("assets")
        .select("id,name,value,category,linked_debt_id")
        .eq("user_id", userId)
        .order("name", { ascending: true }),
      supabase
        .from("v_week_totals")
        .select(
          "week_id,start_date,end_date,display_week_number,status,pay_period_role,paycheck_due_date,earnings_total,ability_paycheck_earnings,prestige_paycheck_earnings,spend_total,base_total,cashflow_total,running_balance",
        )
        .eq("user_id", userId)
        .order("start_date", { ascending: true }),
      supabase
        .from("v_day_totals")
        .select("date,earnings_total,spend_total,base_amount,cashflow_total")
        .eq("user_id", userId)
        .gte("date", yearStartIso)
        .lte("date", todayIso)
        .order("date", { ascending: true }),
      supabase
        .from("days")
        .select("id,date")
        .eq("user_id", userId)
        .gte("date", yearStartIso)
        .lte("date", todayIso)
        .order("date", { ascending: true }),
      supabase
        .from("settings")
        .select(
          "prestige_regular_net_rate,prestige_ot_net_rate,prestige_ilst_net_rate,prestige_ilst_ot_net_rate,ability_withholding_rate,prestige_withholding_rate,filing_fee,standard_deduction",
        )
        .eq("user_id", userId)
        .single(),
      supabase
        .from("v_active_expense_totals")
        .select("monthly_total,projected_daily_base")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("transactions")
        .select("date,amount,category,status")
        .eq("user_id", userId)
        .gte("date", yearStartIso)
        .lte("date", todayIso)
        .order("date", { ascending: true }),
      getProjectionCashBalance({ supabase, userId }),
    ]);

    if (debtsRes.error) throw new Error(`Debts: ${debtsRes.error.message}`);
    if (creditCardsRes.error) {
      throw new Error(`Credit cards: ${creditCardsRes.error.message}`);
    }
    if (assetsRes.error) throw new Error(`Assets: ${assetsRes.error.message}`);
    if (weeksRes.error) throw new Error(`Weeks: ${weeksRes.error.message}`);
    if (dayTotalsRes.error) throw new Error(`Day totals: ${dayTotalsRes.error.message}`);
    if (daysRes.error) throw new Error(`Days: ${daysRes.error.message}`);
    if (settingsRes.error) throw new Error(`Settings: ${settingsRes.error.message}`);
    if (baselineTotalsRes.error) {
      throw new Error(`Baseline totals: ${baselineTotalsRes.error.message}`);
    }
    if (transactionsRes.error) {
      throw new Error(`Transactions: ${transactionsRes.error.message}`);
    }

    const weeks = (weeksRes.data ?? []) as WeekTotalRow[];
    const dayTotals = (dayTotalsRes.data ?? []) as DayTotalRow[];
    const days = (daysRes.data ?? []) as DayRow[];
    const dayIds = days.map((day) => day.id);
    const weekIds = weeks.map((week) => week.week_id);
    const slotsRes =
      dayIds.length > 0
        ? await supabase
            .from("earn_slots")
            .select("day_id,job_type,pay_type,hours_or_units,regular_hours,overtime_hours,incentive_mode,incentive_rate,incentive_amount")
            .in("day_id", dayIds)
        : { data: [], error: null };
    const projectionExclusionsRes =
      weekIds.length > 0
        ? await supabase
            .from("week_projection_exclusions")
            .select("week_id,exclude_earnings,exclude_spend,exclude_cashflow")
            .eq("user_id", userId)
            .in("week_id", weekIds)
        : { data: [], error: null };

    if (slotsRes.error) throw new Error(`Earn slots: ${slotsRes.error.message}`);
    if (projectionExclusionsRes.error) {
      throw new Error(
        `Projection exclusions: ${projectionExclusionsRes.error.message}`,
      );
    }

    const slots = (slotsRes.data ?? []) as EarnSlotRow[];
    const projectionExclusions =
      (projectionExclusionsRes.data ?? []) as ProjectionExclusionRow[];
    const settings = settingsRes.data as SettingsRow;
    const baselineTotals = baselineTotalsRes.data as BaselineTotalRow | null;
    const debts = ((debtsRes.data ?? []) as DebtRow[]).map(mapDebt);
    const activeWeek =
      weeks.find((week) => week.status === "active") ?? weeks.at(-1) ?? null;
    const thisWeekStartIso = activeWeek?.start_date ?? weekOf;
    const thisWeekEndIso = activeWeek?.end_date ?? addDaysIso(thisWeekStartIso, 6);
    const payPeriodStartIso =
      activeWeek?.pay_period_role === "week_2"
        ? addDaysIso(activeWeek.start_date, -7)
        : activeWeek?.start_date ?? weekOf;
    const payPeriodEndIso = addDaysIso(payPeriodStartIso, 13);
    const currentPayPeriodWeeks = weeks.filter(
      (week) =>
        week.start_date >= payPeriodStartIso && week.start_date <= payPeriodEndIso,
    );
    const activeCashflowCents = dollarsToCents(
      toNumber(activeWeek?.cashflow_total ?? 0),
    );
    const activePayPeriodCashflowCents = currentPayPeriodWeeks.reduce(
      (sum, week) => sum + dollarsToCents(toNumber(week.cashflow_total)),
      0,
    );
    const ytdDeployableCents = weeks.reduce(
      (sum, week) => sum + dollarsToCents(toNumber(week.cashflow_total)),
      0,
    );
    const closedCashflowCents = weeks
      .filter((week) => week.status === "closed")
      .map((week) => dollarsToCents(toNumber(week.cashflow_total)));
    const targetWeeklyDeployableCents =
      closedCashflowCents.length > 0
        ? Math.round(
            closedCashflowCents.reduce((sum, value) => sum + value, 0) /
              closedCashflowCents.length,
          )
        : activeCashflowCents;
    const income = buildIncome({
      weeks,
      dayTotals,
      days,
      slots,
      settings,
      thisWeekStartIso,
      thisWeekEndIso,
      payPeriodStartIso,
      payPeriodEndIso,
      rolling30StartIso,
      todayIso,
      currentPayPeriodWeeks,
    });
    const spending = buildSpending({
      dayTotals,
      weeks,
      transactions: (transactionsRes.data ?? []) as TransactionRow[],
      thisWeekStartIso,
      thisWeekEndIso,
      payPeriodStartIso,
      payPeriodEndIso,
      rolling30StartIso,
      todayIso,
    });
    const baseline = buildBaseline({
      dayTotals,
      weeks,
      baselineTotals,
      thisWeekStartIso,
      thisWeekEndIso,
      payPeriodStartIso,
      payPeriodEndIso,
      rolling30StartIso,
      todayIso,
    });
    const projectionContext = buildProjectionContext({
      debts,
      weeks,
      settings,
      activeWeek,
      assets: (assetsRes.data ?? []) as AssetRow[],
      cashBalance,
    });

    return NextResponse.json({
      as_of: asOfIso,
      week_of: weekOf,
      debts,
      credit_cards: ((creditCardsRes.data ?? []) as CreditCardAccountRow[]).map(
        mapCreditCard,
      ),
      accounts: mapAccounts((assetsRes.data ?? []) as AssetRow[]),
      cashflow: {
        week_start: activeWeek?.start_date ?? weekOf,
        actual_deployable_this_week: money(activeCashflowCents),
        target_weekly_deployable: money(targetWeeklyDeployableCents),
        current_pay_period_total: money(activePayPeriodCashflowCents),
        ytd_deployable_actual: money(ytdDeployableCents),
      },
      income,
      spending,
      baseline,
      history: buildHistory({
        weeks,
        activeWeek,
        projectionExclusions,
      }),
      debt_totals: projectionContext.debtTotals,
      projection: projectionContext.projection,
      plan_metrics: projectionContext.planMetrics,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ledger export failed." },
      { status: 500 },
    );
  }
}

function buildIncome({
  weeks,
  dayTotals,
  days,
  slots,
  settings,
  thisWeekStartIso,
  thisWeekEndIso,
  payPeriodStartIso,
  payPeriodEndIso,
  rolling30StartIso,
  todayIso,
  currentPayPeriodWeeks,
}: {
  weeks: WeekTotalRow[];
  dayTotals: DayTotalRow[];
  days: DayRow[];
  slots: EarnSlotRow[];
  settings: SettingsRow;
  thisWeekStartIso: string;
  thisWeekEndIso: string;
  payPeriodStartIso: string;
  payPeriodEndIso: string;
  rolling30StartIso: string;
  todayIso: string;
  currentPayPeriodWeeks: WeekTotalRow[];
}) {
  const thisWeekNetRollupCents = sumWeekMoney(
    weeks,
    "earnings_total",
    thisWeekStartIso,
    thisWeekEndIso,
  );
  const payPeriodNetCents = sumWeekMoney(
    weeks,
    "earnings_total",
    payPeriodStartIso,
    payPeriodEndIso,
  );
  const rolling30NetCents = sumDayMoney(
    dayTotals,
    "earnings_total",
    rolling30StartIso,
    todayIso,
  );
  const ytdNetCents = sumDayMoney(dayTotals, "earnings_total");
  const ytdNetRollupCents = weeks.reduce(
    (sum, week) => sum + dollarsToCents(toNumber(week.earnings_total)),
    0,
  );
  const currentPayPeriodNetCents = currentPayPeriodWeeks.reduce(
    (sum, week) => sum + dollarsToCents(toNumber(week.earnings_total)),
    0,
  );
  const paycheckDueDate =
    currentPayPeriodWeeks.find((week) => week.pay_period_role === "week_2")
      ?.paycheck_due_date ??
    currentPayPeriodWeeks.at(-1)?.paycheck_due_date ??
    payPeriodEndIso;

  return {
    this_week_net: money(thisWeekNetRollupCents),
    this_week_gross: money(
      sumGrossCents({ days, slots, settings, startIso: thisWeekStartIso, endIso: thisWeekEndIso }),
    ),
    current_pay_period_net: money(payPeriodNetCents),
    current_pay_period_gross: money(
      sumGrossCents({ days, slots, settings, startIso: payPeriodStartIso, endIso: payPeriodEndIso }),
    ),
    rolling_30d_net: money(rolling30NetCents),
    ytd_net: money(ytdNetRollupCents || ytdNetCents),
    ytd_gross: money(sumGrossCents({ days, slots, settings })),
    paychecks_this_period: [
      {
        date: paycheckDueDate,
        amount: money(currentPayPeriodNetCents || payPeriodNetCents),
      },
    ],
  };
}

function buildBaseline({
  dayTotals,
  weeks,
  baselineTotals,
  thisWeekStartIso,
  thisWeekEndIso,
  payPeriodStartIso,
  payPeriodEndIso,
  rolling30StartIso,
  todayIso,
}: {
  dayTotals: DayTotalRow[];
  weeks: WeekTotalRow[];
  baselineTotals: BaselineTotalRow | null;
  thisWeekStartIso: string;
  thisWeekEndIso: string;
  payPeriodStartIso: string;
  payPeriodEndIso: string;
  rolling30StartIso: string;
  todayIso: string;
}) {
  const ytdRollupCents = weeks.reduce(
    (sum, week) => sum + dollarsToCents(toNumber(week.base_total)),
    0,
  );

  return {
    this_week_total: money(
      sumWeekMoney(weeks, "base_total", thisWeekStartIso, thisWeekEndIso),
    ),
    current_pay_period_total: money(
      sumWeekMoney(weeks, "base_total", payPeriodStartIso, payPeriodEndIso),
    ),
    rolling_30d_total: money(
      sumDayMoney(dayTotals, "base_amount", rolling30StartIso, todayIso),
    ),
    ytd_total: money(ytdRollupCents || sumDayMoney(dayTotals, "base_amount")),
    current_daily_base: money(
      dollarsToCents(toNumber(baselineTotals?.projected_daily_base ?? 0)),
    ),
    monthly_total: money(
      dollarsToCents(toNumber(baselineTotals?.monthly_total ?? 0)),
    ),
  };
}

function buildProjectionContext({
  debts,
  weeks,
  settings,
  activeWeek,
  assets,
  cashBalance,
}: {
  debts: ReturnType<typeof mapDebt>[];
  weeks: WeekTotalRow[];
  settings: SettingsRow;
  activeWeek: WeekTotalRow | null;
  assets: AssetRow[];
  cashBalance: Awaited<ReturnType<typeof getProjectionCashBalance>>;
}) {
  const projectionDebts: ProjectionDebtRow[] = debts.map((debt) => ({
    id: debt.id,
    name: debt.id,
    balanceCents: dollarsToCents(debt.balance),
    minimumPaymentCents: dollarsToCents(debt.minimum_payment),
    aprBps: Math.round(debt.apr * 100),
    status: debt.status,
    priorityOrder: debt.priority_order,
  }));
  const totalActiveDebtCents = projectionDebts
    .filter((debt) => debt.status === "active")
    .reduce((sum, debt) => sum + debt.balanceCents, 0);
  const totalMinPayMonthlyCents = projectionDebts
    .filter((debt) => debt.status === "active")
    .reduce((sum, debt) => sum + debt.minimumPaymentCents, 0);
  const activeDebtCount = projectionDebts.filter(
    (debt) => debt.status === "active",
  ).length;
  const closedWeeks: ProjectionWeekRow[] = weeks
    .filter((week) => week.status === "closed")
    .map((week) => ({
      startDate: week.start_date,
      earningsCents: dollarsToCents(toNumber(week.earnings_total)),
      cashflowCents: dollarsToCents(toNumber(week.cashflow_total)),
      abilityPaycheckCents: dollarsToCents(
        toNumber(week.ability_paycheck_earnings),
      ),
      prestigePaycheckCents: dollarsToCents(
        toNumber(week.prestige_paycheck_earnings),
      ),
    }));
  const currentWeekNumber =
    toNumber(activeWeek?.display_week_number ?? 0) || closedWeeks.length + 1;
  const projection = calcWeeklyProjection({
    closedWeeks,
    currentWeekNumber,
    rollingWindowWeeks: ROLLING_WINDOW_WEEKS,
    settings: {
      abilityRegularNetRateCents: 1563,
      abilityOvertimeNetRateCents: 2173,
      prestigeRegularNetRateCents: 1462,
      prestigeOvertimeNetRateCents: 2193,
      prestigeIlstRegularNetRateCents: 1548,
      prestigeIlstOvertimeNetRateCents: 2322,
      abilityNetMultiplier:
        1 - toNumber(settings.ability_withholding_rate ?? 0.2652),
    },
    withholding: {
      ability: toNumber(settings.ability_withholding_rate ?? 0.2652),
      prestige: toNumber(settings.prestige_withholding_rate ?? 0.14),
      incentive: toNumber(settings.ability_withholding_rate ?? 0.2652),
      filingFeeCents: dollarsToCents(toNumber(settings.filing_fee ?? 160)),
      standardDeductionCents: dollarsToCents(
        toNumber(settings.standard_deduction ?? 15000),
      ),
      overtimeExemptionCents: dollarsToCents(900),
    },
  });
  const weeklyTaxDueCents = Math.round(projection.estTaxCents / 52);
  const investableWeeklyCashflowCents = Math.max(
    0,
    projection.wpcCents - weeklyTaxDueCents,
  );
  const cashAdjusted = applyDebtLumpSum(
    projectionDebts,
    cashBalance.availableCashCents,
  );
  const startingNetWorthCents =
    cashBalance.availableCashCents - totalActiveDebtCents;
  const debtFreeWeeks = simulateDebtFree(
    cashAdjusted.debts,
    projection.wpcCents,
  ).weeksToPayoff;
  const linkedDebtIds = new Set(
    assets
      .map((asset) => asset.linked_debt_id)
      .filter((id): id is string => typeof id === "string"),
  );
  const millionaireDebts = cashAdjusted.debts
    .filter(
      (debt) =>
        debt.status === "active" &&
        debt.balanceCents > 0 &&
        debt.minimumPaymentCents > 0 &&
        linkedDebtIds.has(debt.id),
    )
    .map((debt) => ({
      name: debt.name,
      balanceCents: debt.balanceCents,
      minimumPaymentWeeklyCents: Math.round(debt.minimumPaymentCents / 4.33),
    }));
  const millionaireSim = simulateLegacyMillionaire({
    startingBalanceCents: startingNetWorthCents,
    weeklyCashflowCents: investableWeeklyCashflowCents,
    debtsList: millionaireDebts,
    targetCents: MILLIONAIRE_TARGET_CENTS,
    annualGrowthRate: MILLIONAIRE_ANNUAL_RETURN,
  });
  const debtFreeDateIso = addWeeksFromToday(debtFreeWeeks);
  const millionaireDateIso = addWeeksFromToday(millionaireSim.weeksToTarget);

  return {
    debtTotals: {
      total_active_debt: money(totalActiveDebtCents),
      active_debt_count: activeDebtCount,
      total_min_pay_monthly: money(totalMinPayMonthlyCents),
      total_min_pay_weekly: money(Math.round(totalMinPayMonthlyCents / 4.33)),
      available_cash: money(cashBalance.availableCashCents),
      starting_net_worth: money(startingNetWorthCents),
    },
    projection: {
      wpc: money(projection.wpcCents),
      mwe: money(projection.mweCents),
      avg_earnings: money(projection.avgEarningsCents),
      recent_earnings: projection.recentEarningsCents.map(money),
      recent_cashflow: projection.recentCashflowCents.map(money),
      weeks_remaining: projection.weeksRemaining,
      ytd_cashflow: money(projection.ytdCfCents),
      ytd_earnings: money(projection.ytdEarningsCents),
      ytd_wage_net: money(projection.ytdWageNetCents),
      avg_wage_net: money(projection.avgWageNetCents),
      ypgc: money(projection.ypgcCents),
      ypwi_net: money(projection.ypwiNetCents),
      ypwi_gross: money(projection.ypwiGrossCents),
      withheld_year_to_date: money(projection.withheldYrCents),
      fed_liability: money(projection.fedLiabilityCents),
      ct_liability: money(projection.ctLiabilityCents),
      fica_liability: money(projection.ficaLiabilityCents),
      total_liability: money(projection.totalLiabilityCents),
      est_remaining_tax_owed: money(
        Math.max(0, projection.totalLiabilityCents - projection.withheldYrCents),
      ),
      ypnc: money(projection.ypncCents),
    },
    planMetrics: {
      weekly_tax_due: money(weeklyTaxDueCents),
      investable_weekly_cashflow: money(investableWeeklyCashflowCents),
      debt_free_date_iso: debtFreeDateIso,
      millionaire_date_iso: millionaireDateIso,
      age_at_millionaire:
        millionaireDateIso === null ? null : calculateAgeOnDate(millionaireDateIso),
      millionaire_duration_label:
        millionaireSim.weeksToTarget === null
          ? null
          : formatWeekDuration(millionaireSim.weeksToTarget),
      cash_balance_source: cashBalance.source,
      cash_balance_stale: cashBalance.stale,
      cash_balance_last_refreshed_at: cashBalance.asOf,
    },
  };
}

function buildHistory({
  weeks,
  activeWeek,
  projectionExclusions,
}: {
  weeks: WeekTotalRow[];
  activeWeek: WeekTotalRow | null;
  projectionExclusions: ProjectionExclusionRow[];
}) {
  const exclusionsByWeek = new Map(
    projectionExclusions.map((row) => [row.week_id, row]),
  );
  const closedWeeks = weeks.filter((week) => week.status === "closed");
  const currentWeek = activeWeek ?? weeks.at(-1) ?? null;

  return {
    current_week:
      currentWeek === null
        ? null
        : mapHistoryWeek(currentWeek, exclusionsByWeek.get(currentWeek.week_id)),
    closed_week_count: closedWeeks.length,
    summary: {
      total_earnings: money(
        sumIncludedHistory(closedWeeks, exclusionsByWeek, "earnings"),
      ),
      total_spend: money(
        sumIncludedHistory(closedWeeks, exclusionsByWeek, "spend"),
      ),
      avg_earnings: nullableMoney(
        averageIncludedHistory(closedWeeks, exclusionsByWeek, "earnings"),
      ),
      avg_spend: nullableMoney(
        averageIncludedHistory(closedWeeks, exclusionsByWeek, "spend"),
      ),
      avg_cashflow: nullableMoney(
        averageIncludedHistory(closedWeeks, exclusionsByWeek, "cashflow"),
      ),
      median_earnings: nullableMoney(
        medianIncludedHistory(closedWeeks, exclusionsByWeek, "earnings"),
      ),
      median_spend: nullableMoney(
        medianIncludedHistory(closedWeeks, exclusionsByWeek, "spend"),
      ),
      median_cashflow: nullableMoney(
        medianIncludedHistory(closedWeeks, exclusionsByWeek, "cashflow"),
      ),
    },
    recent_closed_weeks: closedWeeks
      .slice(-52)
      .map((week) => mapHistoryWeek(week, exclusionsByWeek.get(week.week_id))),
  };
}

type HistoryProjectionField = "earnings" | "spend" | "cashflow";

function mapHistoryWeek(
  week: WeekTotalRow,
  exclusions: ProjectionExclusionRow | undefined,
) {
  return {
    week_id: week.week_id,
    start_date: week.start_date,
    end_date: week.end_date,
    display_week_number: Math.round(toNumber(week.display_week_number)),
    status: week.status,
    pay_period_role: week.pay_period_role,
    earnings: money(dollarsToCents(toNumber(week.earnings_total))),
    spend: money(dollarsToCents(toNumber(week.spend_total))),
    base: money(dollarsToCents(toNumber(week.base_total))),
    cashflow: money(dollarsToCents(toNumber(week.cashflow_total))),
    running_balance: money(dollarsToCents(toNumber(week.running_balance))),
    exclusions: {
      earnings: exclusions?.exclude_earnings ?? false,
      spend: exclusions?.exclude_spend ?? false,
      cashflow: exclusions?.exclude_cashflow ?? false,
    },
  };
}

function sumIncludedHistory(
  weeks: WeekTotalRow[],
  exclusionsByWeek: Map<string, ProjectionExclusionRow>,
  field: HistoryProjectionField,
) {
  return weeks.reduce((sum, week) => {
    if (isHistoryFieldExcluded(exclusionsByWeek.get(week.week_id), field)) {
      return sum;
    }

    return sum + historyFieldCents(week, field);
  }, 0);
}

function averageIncludedHistory(
  weeks: WeekTotalRow[],
  exclusionsByWeek: Map<string, ProjectionExclusionRow>,
  field: HistoryProjectionField,
) {
  const included = weeks.filter(
    (week) => !isHistoryFieldExcluded(exclusionsByWeek.get(week.week_id), field),
  );

  if (included.length === 0) {
    return null;
  }

  return Math.round(
    sumIncludedHistory(included, exclusionsByWeek, field) / included.length,
  );
}

function medianIncludedHistory(
  weeks: WeekTotalRow[],
  exclusionsByWeek: Map<string, ProjectionExclusionRow>,
  field: HistoryProjectionField,
) {
  const values = weeks
    .filter(
      (week) => !isHistoryFieldExcluded(exclusionsByWeek.get(week.week_id), field),
    )
    .map((week) => historyFieldCents(week, field))
    .sort((left, right) => left - right);

  if (values.length === 0) {
    return null;
  }

  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[middle];
  }

  return Math.round((values[middle - 1] + values[middle]) / 2);
}

function historyFieldCents(
  week: WeekTotalRow,
  field: HistoryProjectionField,
) {
  if (field === "earnings") {
    return dollarsToCents(toNumber(week.earnings_total));
  }

  if (field === "spend") {
    return dollarsToCents(toNumber(week.spend_total));
  }

  return dollarsToCents(toNumber(week.cashflow_total));
}

function isHistoryFieldExcluded(
  exclusions: ProjectionExclusionRow | undefined,
  field: HistoryProjectionField,
) {
  if (field === "earnings") {
    return exclusions?.exclude_earnings ?? false;
  }

  if (field === "spend") {
    return exclusions?.exclude_spend ?? false;
  }

  return exclusions?.exclude_cashflow ?? false;
}

function buildSpending({
  dayTotals,
  weeks,
  transactions,
  thisWeekStartIso,
  thisWeekEndIso,
  payPeriodStartIso,
  payPeriodEndIso,
  rolling30StartIso,
  todayIso,
}: {
  dayTotals: DayTotalRow[];
  weeks: WeekTotalRow[];
  transactions: TransactionRow[];
  thisWeekStartIso: string;
  thisWeekEndIso: string;
  payPeriodStartIso: string;
  payPeriodEndIso: string;
  rolling30StartIso: string;
  todayIso: string;
}) {
  const rolling30TotalCents = sumDayMoney(
    dayTotals,
    "spend_total",
    rolling30StartIso,
    todayIso,
  );
  const ytdRollupCents = weeks.reduce(
    (sum, week) => sum + dollarsToCents(toNumber(week.spend_total)),
    0,
  );

  return {
    this_week_total: money(
      sumWeekMoney(weeks, "spend_total", thisWeekStartIso, thisWeekEndIso),
    ),
    current_pay_period_total: money(
      sumWeekMoney(weeks, "spend_total", payPeriodStartIso, payPeriodEndIso),
    ),
    rolling_30d_total: money(rolling30TotalCents),
    ytd_total: money(ytdRollupCents || sumDayMoney(dayTotals, "spend_total")),
    top_categories_rolling_30d: buildTopCategories(
      transactions,
      rolling30StartIso,
      todayIso,
      rolling30TotalCents,
    ),
  };
}

function buildTopCategories(
  transactions: TransactionRow[],
  startIso: string,
  endIso: string,
  totalCents: number,
) {
  const byCategory = new Map<string, number>();

  transactions.forEach((transaction) => {
    if (
      transaction.status !== "applied" ||
      transaction.date < startIso ||
      transaction.date > endIso
    ) {
      return;
    }

    const amountCents = Math.max(0, dollarsToCents(toNumber(transaction.amount)));
    if (amountCents <= 0) return;

    const category = transaction.category?.trim() || "Uncategorized";
    byCategory.set(category, (byCategory.get(category) ?? 0) + amountCents);
  });

  return [...byCategory.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 7)
    .map(([category, amountCents]) => ({
      category,
      amount: money(amountCents),
      pct_of_total: totalCents > 0 ? round2((amountCents / totalCents) * 100) : 0,
    }));
}

function sumDayMoney(
  dayTotals: DayTotalRow[],
  field: "earnings_total" | "spend_total" | "base_amount" | "cashflow_total",
  startIso?: string,
  endIso?: string,
) {
  return dayTotals.reduce((sum, day) => {
    if (startIso && day.date < startIso) return sum;
    if (endIso && day.date > endIso) return sum;
    return sum + dollarsToCents(toNumber(day[field]));
  }, 0);
}

function sumWeekMoney(
  weeks: WeekTotalRow[],
  field: "earnings_total" | "spend_total" | "base_total" | "cashflow_total",
  startIso?: string,
  endIso?: string,
) {
  return weeks.reduce((sum, week) => {
    if (startIso && week.start_date < startIso) return sum;
    if (endIso && week.start_date > endIso) return sum;
    return sum + dollarsToCents(toNumber(week[field]));
  }, 0);
}

function sumGrossCents({
  days,
  slots,
  settings,
  startIso,
  endIso,
}: {
  days: DayRow[];
  slots: EarnSlotRow[];
  settings: SettingsRow;
  startIso?: string;
  endIso?: string;
}) {
  const dayById = new Map(days.map((day) => [day.id, day]));
  const prestigeRegularGrossRate = netToGrossRate(
    toNumber(settings.prestige_regular_net_rate) || DEFAULT_PRESTIGE_REGULAR_NET_RATE,
  );
  const prestigeOvertimeGrossRate = netToGrossRate(
    toNumber(settings.prestige_ot_net_rate) || DEFAULT_PRESTIGE_OVERTIME_NET_RATE,
  );
  const prestigeIlstRegularGrossRate = netToGrossRate(
    toNumber(settings.prestige_ilst_net_rate) ||
      DEFAULT_PRESTIGE_ILST_REGULAR_NET_RATE,
  );
  const prestigeIlstOvertimeGrossRate = netToGrossRate(
    toNumber(settings.prestige_ilst_ot_net_rate) ||
      DEFAULT_PRESTIGE_ILST_OVERTIME_NET_RATE,
  );

  return slots.reduce((sum, slot) => {
    const day = dayById.get(slot.day_id);
    if (!day) return sum;
    if (startIso && day.date < startIso) return sum;
    if (endIso && day.date > endIso) return sum;

    return sum + dollarsToCents(grossForSlot(slot, {
      prestigeRegularGrossRate,
      prestigeOvertimeGrossRate,
      prestigeIlstRegularGrossRate,
      prestigeIlstOvertimeGrossRate,
    }));
  }, 0);
}

function grossForSlot(
  slot: EarnSlotRow,
  rates: {
    prestigeRegularGrossRate: number;
    prestigeOvertimeGrossRate: number;
    prestigeIlstRegularGrossRate: number;
    prestigeIlstOvertimeGrossRate: number;
  },
) {
  const regularHours =
    slot.pay_type === "split" || slot.pay_type === "regular"
      ? toNumber(slot.regular_hours || slot.hours_or_units)
      : 0;
  const overtimeHours =
    slot.pay_type === "split" || slot.pay_type === "overtime"
      ? toNumber(slot.overtime_hours || slot.hours_or_units)
      : 0;

  if (slot.job_type === "ability" || slot.job_type === "ability_incentive") {
    const wageGross =
      regularHours * ABILITY_REGULAR_GROSS_RATE +
      overtimeHours * ABILITY_OVERTIME_GROSS_RATE;
    return wageGross + incentiveGrossForSlot(slot);
  }

  if (slot.job_type === "prestige") {
    return regularHours * rates.prestigeRegularGrossRate + overtimeHours * rates.prestigeOvertimeGrossRate;
  }

  if (slot.job_type === "prestige_ilst") {
    return regularHours * rates.prestigeIlstRegularGrossRate + overtimeHours * rates.prestigeIlstOvertimeGrossRate;
  }

  return toNumber(slot.hours_or_units);
}

function incentiveGrossForSlot(slot: EarnSlotRow): number {
  if (slot.incentive_mode === "lump_sum") {
    return toNumber(slot.incentive_amount);
  }

  if (slot.incentive_mode === "rate") {
    return toNumber(slot.incentive_rate) * toNumber(slot.hours_or_units);
  }

  return 0;
}

function netToGrossRate(netRate: number): number {
  return netRate / (1 - PRESTIGE_WITHHOLDING_RATE);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;

function authorizeLedgerRequest(
  request: Request,
):
  | { ok: true }
  | { ok: false; response: NextResponse<{ error: string }> } {
  const token = process.env[LEDGER_TOKEN_ENV];

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${LEDGER_TOKEN_ENV} is not configured.` },
        { status: 500 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (provided !== token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}

async function resolveLedgerUserId(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const configuredUserId = process.env[LEDGER_USER_ID_ENV];

  if (configuredUserId) {
    return configuredUserId;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data?.id) {
    throw new Error(`Unable to resolve ledger user: ${error?.message ?? "missing profile"}`);
  }

  return data.id as string;
}

function methodNotAllowed() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

function mapDebt(row: DebtRow) {
  const balanceCents = dollarsToCents(toNumber(row.balance));

  return {
    id: row.id,
    type: inferDebtType(row.name),
    balance: money(balanceCents),
    apr: round2(toNumber(row.apr) * 100),
    minimum_payment: money(dollarsToCents(toNumber(row.minimum_payment))),
    minimum_due_date: null,
    status: row.status,
    starting_balance: money(balanceCents),
    priority_order: Math.round(toNumber(row.priority_order)),
  };
}

function mapCreditCard(row: CreditCardAccountRow) {
  return {
    id: row.id,
    name: row.name,
    issuer: row.issuer,
    last_four: row.last_four,
    account_kind: row.account_kind,
    account_status: row.account_status,
    raw_current_balance: nullableDollarValue(row.raw_current_balance),
    planning_balance: money(dollarsToCents(toNumber(row.planning_balance))),
    statement_balance: nullableDollarValue(row.statement_balance),
    statement_date: row.statement_date,
    pending_total: nullableDollarValue(row.pending_total),
    credit_limit: nullableDollarValue(row.credit_limit),
    available_credit: nullableDollarValue(row.available_credit),
    minimum_due: nullableDollarValue(row.minimum_due),
    due_date: row.due_date,
    autopay: {
      status: row.autopay_status,
      mode: row.autopay_mode,
      day: row.autopay_day == null ? null : Math.round(toNumber(row.autopay_day)),
      source: row.autopay_source_label,
    },
    apr: row.apr == null ? null : round2(toNumber(row.apr) * 100),
    verification_status: row.verification_status,
    verified_at: row.verified_at,
    disputed_total: money(dollarsToCents(toNumber(row.disputed_total))),
    risk_status: row.risk_status,
    notes: row.notes,
  };
}

function nullableDollarValue(value: NumericValue): number | null {
  return value == null ? null : money(dollarsToCents(toNumber(value)));
}

function mapAccounts(assets: AssetRow[]) {
  const emergencyCents = findAssetValue(assets, ["emergency", "cushion"]);
  const propertyCents = findAssetValue(assets, ["property", "fund"]);

  return [
    {
      id: "emergency_cushion",
      label: "Emergency cushion",
      balance: money(emergencyCents),
    },
    {
      id: "property_fund",
      label: "Property fund",
      balance: money(propertyCents),
    },
  ];
}

function findAssetValue(assets: AssetRow[], needles: string[]): number {
  const asset = assets.find((item) => {
    const name = item.name.toLowerCase();
    return needles.some((needle) => name.includes(needle));
  });

  return dollarsToCents(toNumber(asset?.value ?? 0));
}

function inferDebtType(name: string): "auto_loan" | "credit_card" | "debt" {
  const normalized = name.toLowerCase();

  if (normalized.includes("auto") || normalized.includes("loan")) {
    return "auto_loan";
  }

  if (
    normalized.includes("card") ||
    normalized.includes("capital") ||
    normalized.includes("best buy") ||
    normalized.includes("aspire") ||
    normalized.includes("fortiva") ||
    normalized.includes("mission lane")
  ) {
    return "credit_card";
  }

  return "debt";
}

function mondayOnOrBeforeIso(todayIso: string): string {
  const date = new Date(`${todayIso}T00:00:00.000Z`);
  const dayIndex = date.getUTCDay();
  const daysSinceMonday = (dayIndex + 6) % 7;
  return addDaysIso(todayIso, -daysSinceMonday);
}

function addWeeksFromToday(weeks: number | null): string | null {
  if (weeks === null) {
    return null;
  }

  const todayIso = getTodayIso();
  return addDaysIso(todayIso, weeks * 7);
}

function calculateAgeOnDate(iso: string): number {
  const date = new Date(`${iso}T00:00:00.000Z`);
  const birthdayHasPassed =
    date.getUTCMonth() > OWNER_BIRTH_MONTH ||
    (date.getUTCMonth() === OWNER_BIRTH_MONTH &&
      date.getUTCDate() >= OWNER_BIRTH_DAY);

  return (
    date.getUTCFullYear() -
    OWNER_BIRTH_YEAR -
    (birthdayHasPassed ? 0 : 1)
  );
}

function money(cents: number): number {
  return round2(centsToDollars(cents));
}

function nullableMoney(cents: number | null): number | null {
  return cents === null ? null : money(cents);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: NumericValue): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
