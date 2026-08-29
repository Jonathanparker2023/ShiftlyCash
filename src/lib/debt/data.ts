import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/domain/money";
import { mark, since, timed } from "@/lib/perf";
import { formatWeekDuration } from "@/lib/domain/projection-format";
import {
  applyDebtLumpSum,
  calcWeeklyProjection,
  legacyDebtPaydownTrajectory,
  legacyInvestedTrajectory,
  simulateDebtFree,
  simulateLegacyMillionaire,
  type DebtRow,
  type WeekRow,
} from "@/lib/domain/projections";
import { getProjectionCashBalance } from "@/lib/plaid/projectionCash";
import { createAdminClient } from "@/lib/supabase/admin";

export type DebtPageData = {
  debts: DebtRow[];
  creditCards: CreditCardAccountSnapshot[];
  totalActiveDebtCents: number;
  activeDebtCount: number;
  totalMinPayCents: number;
  availableCashCents: number;
  cashAppliedToDebtCents: number;
  startingNetWorthCents: number;
  cashBalanceSource: "plaid" | "cache" | "unavailable";
  cashBalanceStale: boolean;
  cashBalanceAsOf: string | null;
  projection: ReturnType<typeof calcWeeklyProjection>;
  debtFreeDateIso: string | null;
  millionaireDateIso: string | null;
  millionaireDurationLabel: string;
  ageAtMillionaire: number | null;
  weeklyTaxDueCents: number;
  investableWeeklyCashflowCents: number;
  weeklyBalances: number[];
  millionaireBalances: number[];
  principalMillionaireBalances: number[];
  netWorthTrajectory: number[];
  investedNetWorthTrajectory: number[];
  millionairePayoffEvents: Array<{ week: number; name: string; freedCents: number }>;
  projectionSource: {
    closedWeekCount: number;
    rollingWindowWeeks: number;
    recentWeekNumbers: number[];
  };
};

export type CreditCardAccountSnapshot = {
  id: string;
  name: string;
  issuer: string;
  lastFour: string | null;
  accountKind: "credit_card" | "store_card";
  accountStatus: "active" | "paid" | "replacement_pending" | "unverified";
  rawCurrentBalanceCents: number | null;
  planningBalanceCents: number;
  statementBalanceCents: number | null;
  statementDate: string | null;
  pendingTotalCents: number | null;
  creditLimitCents: number | null;
  availableCreditCents: number | null;
  minimumDueCents: number | null;
  dueDate: string | null;
  autopayStatus: "on" | "off" | "unknown" | "paused";
  autopayMode: string | null;
  autopayDay: number | null;
  autopaySourceLabel: string | null;
  aprBps: number | null;
  monthlyFeeCents: number | null;
  annualFeeCents: number | null;
  creditProtectionAmountCents: number | null;
  verificationStatus: "verified" | "user_reported" | "unverified" | "disputed";
  verifiedAt: string | null;
  disputedTotalCents: number;
  riskStatus: "clear" | "open_dispute" | "unverified";
  notes: string | null;
};

const OWNER_BIRTH_YEAR = 1998;
const OWNER_BIRTH_MONTH = 0;
const OWNER_BIRTH_DAY = 12;
const MILLIONAIRE_TARGET_CENTS = 100_000_000;
const MILLIONAIRE_ANNUAL_RETURN = 0.1;
const ROLLING_WINDOW_WEEKS = 2;

export async function getDebtData(): Promise<DebtPageData> {
  const tTotal = mark();
  const { supabase, user } = await timed("debt:auth", () => requireUser());
  if (!user) redirect("/login");

  const tBatch = mark();
  const [debtsRes, creditCardsRes, weeksRes, settingsRes, assetsRes, cashBalance] =
    await Promise.all([
    supabase
      .from("debts")
      .select("id, name, balance, minimum_payment, apr, status, priority_order")
      .eq("user_id", user.id)
      .order("priority_order"),
    supabase
      .from("credit_card_accounts")
      .select(
        "id,name,issuer,last_four,account_kind,account_status,raw_current_balance,planning_balance,statement_balance,statement_date,pending_total,credit_limit,available_credit,minimum_due,due_date,autopay_status,autopay_mode,autopay_day,autopay_source_label,apr,monthly_fee,annual_fee,credit_protection_amount,verification_status,verified_at,disputed_total,risk_status,notes",
      )
      .eq("user_id", user.id)
      .order("name"),
    supabase
      .from("v_week_totals")
      .select(
        "start_date, display_week_number, earnings_total, cashflow_total, ability_paycheck_earnings, prestige_paycheck_earnings, status",
      )
      .eq("user_id", user.id)
      .order("start_date"),
    supabase
      .from("settings")
      .select(
        "ability_withholding_rate, prestige_withholding_rate, filing_fee, standard_deduction",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("assets")
      .select("linked_debt_id")
      .eq("user_id", user.id)
      .not("linked_debt_id", "is", null),
    getProjectionCashBalance({
      supabase: createAdminClient(),
      userId: user.id,
    }),
  ]);
  since("debt:reads(debts+cards+weeks+settings+assets+cash)", tBatch);

  if (debtsRes.error) throw new Error(`Debts: ${debtsRes.error.message}`);
  if (creditCardsRes.error) {
    throw new Error(`Credit cards: ${creditCardsRes.error.message}`);
  }
  if (weeksRes.error) throw new Error(`Weeks: ${weeksRes.error.message}`);
  if (settingsRes.error) throw new Error(`Settings: ${settingsRes.error.message}`);
  if (assetsRes.error) throw new Error(`Assets: ${assetsRes.error.message}`);

  const debts: DebtRow[] = (debtsRes.data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    balanceCents: dollarsToCents(Number(row.balance)),
    minimumPaymentCents: dollarsToCents(Number(row.minimum_payment)),
    aprBps: Math.round(Number(row.apr) * 10_000),
    status: (row.status as "active" | "paid") ?? "active",
    priorityOrder: Number(row.priority_order),
  }));
  const creditCards: CreditCardAccountSnapshot[] = (
    creditCardsRes.data ?? []
  ).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    issuer: row.issuer as string,
    lastFour: (row.last_four as string | null) ?? null,
    accountKind: row.account_kind as CreditCardAccountSnapshot["accountKind"],
    accountStatus: row.account_status as CreditCardAccountSnapshot["accountStatus"],
    rawCurrentBalanceCents: nullableDollarsToCents(row.raw_current_balance),
    planningBalanceCents: dollarsToCents(Number(row.planning_balance)),
    statementBalanceCents: nullableDollarsToCents(row.statement_balance),
    statementDate: (row.statement_date as string | null) ?? null,
    pendingTotalCents: nullableDollarsToCents(row.pending_total),
    creditLimitCents: nullableDollarsToCents(row.credit_limit),
    availableCreditCents: nullableDollarsToCents(row.available_credit),
    minimumDueCents: nullableDollarsToCents(row.minimum_due),
    dueDate: (row.due_date as string | null) ?? null,
    autopayStatus: row.autopay_status as CreditCardAccountSnapshot["autopayStatus"],
    autopayMode: (row.autopay_mode as string | null) ?? null,
    autopayDay: row.autopay_day == null ? null : Number(row.autopay_day),
    autopaySourceLabel: (row.autopay_source_label as string | null) ?? null,
    aprBps: row.apr == null ? null : Math.round(Number(row.apr) * 10_000),
    monthlyFeeCents: nullableDollarsToCents(row.monthly_fee),
    annualFeeCents: nullableDollarsToCents(row.annual_fee),
    creditProtectionAmountCents: nullableDollarsToCents(
      row.credit_protection_amount,
    ),
    verificationStatus:
      row.verification_status as CreditCardAccountSnapshot["verificationStatus"],
    verifiedAt: (row.verified_at as string | null) ?? null,
    disputedTotalCents: dollarsToCents(Number(row.disputed_total)),
    riskStatus: row.risk_status as CreditCardAccountSnapshot["riskStatus"],
    notes: (row.notes as string | null) ?? null,
  }));

  const allWeeks = weeksRes.data ?? [];
  const closedWeeks: WeekRow[] = allWeeks
    .filter((w) => w.status === "closed")
    .map((row) => ({
      startDate: row.start_date as string,
      earningsCents: dollarsToCents(Number(row.earnings_total)),
      cashflowCents: dollarsToCents(Number(row.cashflow_total)),
      abilityPaycheckCents: dollarsToCents(Number(row.ability_paycheck_earnings)),
      prestigePaycheckCents: dollarsToCents(Number(row.prestige_paycheck_earnings)),
    }));

  const currentActiveWeek = allWeeks.find((w) => w.status === "active");
  const currentWeekNumber = currentActiveWeek
    ? Number(currentActiveWeek.display_week_number)
    : closedWeeks.length + 1;

  const settings = settingsRes.data;
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
        1 - Number(settings?.ability_withholding_rate ?? 0.2652),
    },
    withholding: {
      ability: Number(settings?.ability_withholding_rate ?? 0.2652),
      prestige: Number(settings?.prestige_withholding_rate ?? 0.14),
      incentive: Number(settings?.ability_withholding_rate ?? 0.2652),
      filingFeeCents: dollarsToCents(Number(settings?.filing_fee ?? 160)),
      standardDeductionCents: dollarsToCents(
        Number(settings?.standard_deduction ?? 15000),
      ),
      overtimeExemptionCents: dollarsToCents(900),
    },
  });

  const totalActiveDebtCents = debts
    .filter((d) => d.status === "active")
    .reduce((s, d) => s + d.balanceCents, 0);
  const activeDebtCount = debts.filter((d) => d.status === "active").length;
  const totalMinPayCents = debts
    .filter((d) => d.status === "active")
    .reduce((s, d) => s + d.minimumPaymentCents, 0);
  const availableCashCents = cashBalance.availableCashCents;
  const cashAdjusted = applyDebtLumpSum(debts, availableCashCents);
  const cashAdjustedDebts = cashAdjusted.debts;
  const startingNetWorthCents = availableCashCents - totalActiveDebtCents;

  const weeklyTaxDueCents = Math.round(projection.estTaxCents / 52);
  const investableWeeklyCashflowCents = Math.max(
    0,
    projection.wpcCents - weeklyTaxDueCents,
  );

  const debtSim = simulateDebtFree(cashAdjustedDebts, projection.wpcCents);
  const linkedDebtIds = new Set(
    (assetsRes.data ?? [])
      .map((asset) => asset.linked_debt_id as string | null)
      .filter((id): id is string => typeof id === "string"),
  );
  const millionaireDebts = cashAdjustedDebts
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
  const principalMillionaireSim = simulateLegacyMillionaire({
    startingBalanceCents: startingNetWorthCents,
    weeklyCashflowCents: investableWeeklyCashflowCents,
    debtsList: millionaireDebts,
    targetCents: MILLIONAIRE_TARGET_CENTS,
    annualGrowthRate: 0,
    maxWeeks: millionaireSim.weeklyBalances.length,
  });
  const netWorthTrajectory = legacyDebtPaydownTrajectory(
    projection.wpcCents,
    startingNetWorthCents,
    520,
  );
  const investedNetWorthTrajectory = legacyInvestedTrajectory(
    projection.wpcCents,
    startingNetWorthCents,
    520,
    MILLIONAIRE_ANNUAL_RETURN,
  );

  const today = new Date();
  const debtFreeDateIso =
    debtSim.weeksToPayoff !== null
      ? new Date(today.getTime() + debtSim.weeksToPayoff * 7 * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : null;
  const millionaireDateIso =
    millionaireSim.weeksToTarget !== null
      ? new Date(today.getTime() + millionaireSim.weeksToTarget * 7 * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : null;
  const ageAtMillionaire =
    millionaireDateIso === null
      ? null
      : calculateAgeOnDate(millionaireDateIso);

  const result = {
    debts,
    creditCards,
    totalActiveDebtCents,
    activeDebtCount,
    totalMinPayCents,
    availableCashCents,
    cashAppliedToDebtCents: cashAdjusted.appliedCents,
    startingNetWorthCents,
    cashBalanceSource: cashBalance.source,
    cashBalanceStale: cashBalance.stale,
    cashBalanceAsOf: cashBalance.asOf,
    projection,
    debtFreeDateIso,
    millionaireDateIso,
    millionaireDurationLabel: formatWeekDuration(millionaireSim.weeksToTarget),
    ageAtMillionaire,
    weeklyTaxDueCents,
    investableWeeklyCashflowCents,
    weeklyBalances: debtSim.weeklyBalances,
    millionaireBalances: millionaireSim.weeklyBalances,
    principalMillionaireBalances: principalMillionaireSim.weeklyBalances,
    netWorthTrajectory,
    investedNetWorthTrajectory,
    millionairePayoffEvents: millionaireSim.payoffEvents,
    projectionSource: {
      closedWeekCount: closedWeeks.length,
      rollingWindowWeeks: ROLLING_WINDOW_WEEKS,
      recentWeekNumbers: allWeeks
        .filter((week) => week.status === "closed")
        .slice(-ROLLING_WINDOW_WEEKS)
        .map((week) => Number(week.display_week_number)),
    },
  };
  since("debt:total", tTotal);
  return result;
}

function nullableDollarsToCents(value: unknown): number | null {
  return value == null ? null : dollarsToCents(Number(value));
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
