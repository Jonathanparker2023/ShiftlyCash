import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/domain/money";
import { formatWeekDuration } from "@/lib/domain/projection-format";
import {
  calcWeeklyProjection,
  legacyDebtPaydownTrajectory,
  legacyInvestedTrajectory,
  simulateDebtFree,
  simulateLegacyMillionaire,
  type DebtRow,
  type WeekRow,
} from "@/lib/domain/projections";

export type DebtPageData = {
  debts: DebtRow[];
  totalActiveDebtCents: number;
  activeDebtCount: number;
  totalMinPayCents: number;
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

const OWNER_BIRTH_YEAR = 1998;
const OWNER_BIRTH_MONTH = 0;
const OWNER_BIRTH_DAY = 12;
const MILLIONAIRE_TARGET_CENTS = 100_000_000;
const MILLIONAIRE_ANNUAL_RETURN = 0.1;
const ROLLING_WINDOW_WEEKS = 2;

export async function getDebtData(): Promise<DebtPageData> {
  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const [debtsRes, weeksRes, settingsRes, assetsRes] = await Promise.all([
    supabase
      .from("debts")
      .select("id, name, balance, minimum_payment, apr, status, priority_order")
      .eq("user_id", user.id)
      .order("priority_order"),
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
        "ability_withholding_rate, prestige_withholding_rate, incentive_withholding_rate, filing_fee, standard_deduction",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("assets")
      .select("linked_debt_id")
      .eq("user_id", user.id)
      .not("linked_debt_id", "is", null),
  ]);

  if (debtsRes.error) throw new Error(`Debts: ${debtsRes.error.message}`);
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
      prestigeRegularNetRateCents: 1428,
      prestigeOvertimeNetRateCents: 2142,
      incentiveNetMultiplier: 0.7348,
    },
    withholding: {
      ability: Number(settings?.ability_withholding_rate ?? 0.2652),
      prestige: Number(settings?.prestige_withholding_rate ?? 0.18),
      incentive: Number(settings?.incentive_withholding_rate ?? 0.2652),
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

  const weeklyTaxDueCents = Math.round(projection.estTaxCents / 52);
  const investableWeeklyCashflowCents = Math.max(
    0,
    projection.wpcCents - weeklyTaxDueCents,
  );

  const debtSim = simulateDebtFree(debts, projection.wpcCents);
  const legacyDebtFreeWeeks =
    projection.wpcCents > 0
      ? Math.ceil(totalActiveDebtCents / projection.wpcCents)
      : null;
  const linkedDebtIds = new Set(
    (assetsRes.data ?? [])
      .map((asset) => asset.linked_debt_id as string | null)
      .filter((id): id is string => typeof id === "string"),
  );
  const millionaireDebts = debts
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
    startingBalanceCents: -totalActiveDebtCents,
    weeklyCashflowCents: investableWeeklyCashflowCents,
    debtsList: millionaireDebts,
    targetCents: MILLIONAIRE_TARGET_CENTS,
    annualGrowthRate: MILLIONAIRE_ANNUAL_RETURN,
  });
  const principalMillionaireSim = simulateLegacyMillionaire({
    startingBalanceCents: -totalActiveDebtCents,
    weeklyCashflowCents: investableWeeklyCashflowCents,
    debtsList: millionaireDebts,
    targetCents: MILLIONAIRE_TARGET_CENTS,
    annualGrowthRate: 0,
    maxWeeks: millionaireSim.weeklyBalances.length,
  });
  const netWorthTrajectory = legacyDebtPaydownTrajectory(
    projection.wpcCents,
    totalActiveDebtCents,
    520,
  );
  const investedNetWorthTrajectory = legacyInvestedTrajectory(
    projection.wpcCents,
    totalActiveDebtCents,
    520,
    MILLIONAIRE_ANNUAL_RETURN,
  );

  const today = new Date();
  const debtFreeDateIso =
    legacyDebtFreeWeeks !== null
      ? new Date(today.getTime() + legacyDebtFreeWeeks * 7 * 86_400_000)
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

  return {
    debts,
    totalActiveDebtCents,
    activeDebtCount,
    totalMinPayCents,
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
