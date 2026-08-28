import { requireUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/domain/money";
import {
  buildNetWorthProjection,
  type NetWorthProjectionPoint,
} from "@/lib/domain/netWorth";
import {
  calcWeeklyProjection,
  type WeekRow,
} from "@/lib/domain/projections";
import { getProjectionCashBalance } from "@/lib/plaid/projectionCash";
import { createAdminClient } from "@/lib/supabase/admin";

export type NetWorthAsset = {
  id: string;
  name: string;
  valueCents: number;
  category: string;
};

export type NetWorthPageData = {
  assets: NetWorthAsset[];
  totalAssetValueCents: number;
  totalDebtCents: number;
  startingBalanceCents: number;
  availableCashCents: number;
  cashBalanceSource: "plaid" | "cache" | "unavailable";
  cashBalanceStale: boolean;
  cashBalanceAsOf: string | null;
  weeklyContributionCents: number;
  annualReturnRate: number;
  horizonYears: number;
  projectionPoints: NetWorthProjectionPoint[];
  crossoverWeek: number | null;
  projectionSource: {
    closedWeekCount: number;
    currentWeekNumber: number;
    cashflowAverageCents: number;
    weeklyTaxDueCents: number;
  };
};

const DEFAULT_HORIZON_YEARS = 12;
const DEFAULT_ANNUAL_RETURN = 0.1;
const ROLLING_WINDOW_WEEKS = 2;

export async function getNetWorthData(): Promise<NetWorthPageData> {
  const { supabase, user } = await requireUser();

  const [assetsRes, debtsRes, weeksRes, settingsRes, cashBalance] =
    await Promise.all([
    supabase
      .from("assets")
      .select("id,name,value,category")
      .eq("user_id", user.id)
      .order("value", { ascending: false }),
    supabase
      .from("debts")
      .select("balance,status")
      .eq("user_id", user.id),
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
    getProjectionCashBalance({
      supabase: createAdminClient(),
      userId: user.id,
    }),
  ]);

  if (assetsRes.error) throw new Error(`Assets: ${assetsRes.error.message}`);
  if (debtsRes.error) throw new Error(`Debts: ${debtsRes.error.message}`);
  if (weeksRes.error) throw new Error(`Weeks: ${weeksRes.error.message}`);
  if (settingsRes.error) throw new Error(`Settings: ${settingsRes.error.message}`);

  const recordedAssets: NetWorthAsset[] = (assetsRes.data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    valueCents: dollarsToCents(Number(row.value ?? 0)),
    category: String(row.category ?? "other"),
  }));
  const assets: NetWorthAsset[] =
    cashBalance.source === "unavailable"
      ? recordedAssets
      : [
          {
            id: "plaid-available-cash",
            name: "Available cash",
            valueCents: cashBalance.availableCashCents,
            category:
              cashBalance.source === "plaid"
                ? "Plaid checking + savings"
                : "Cached Plaid checking + savings",
          },
          ...recordedAssets,
        ];
  const totalAssetValueCents = assets.reduce(
    (sum, asset) => sum + asset.valueCents,
    0,
  );
  const totalDebtCents = (debtsRes.data ?? [])
    .filter((row) => row.status === "active")
    .reduce((sum, row) => sum + dollarsToCents(Number(row.balance ?? 0)), 0);
  const startingBalanceCents = totalAssetValueCents - totalDebtCents;

  const allWeeks = weeksRes.data ?? [];
  const closedWeeks: WeekRow[] = allWeeks
    .filter((week) => week.status === "closed")
    .map((row) => ({
      startDate: row.start_date as string,
      earningsCents: dollarsToCents(Number(row.earnings_total)),
      cashflowCents: dollarsToCents(Number(row.cashflow_total)),
      abilityPaycheckCents: dollarsToCents(Number(row.ability_paycheck_earnings)),
      prestigePaycheckCents: dollarsToCents(Number(row.prestige_paycheck_earnings)),
    }));
  const currentActiveWeek = allWeeks.find((week) => week.status === "active");
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
  const weeklyTaxDueCents = Math.round(projection.estTaxCents / 52);
  const weeklyContributionCents = Math.max(
    0,
    projection.wpcCents - weeklyTaxDueCents,
  );
  const netWorthProjection = buildNetWorthProjection({
    startingBalanceCents,
    weeklyContributionCents,
    annualReturnRate: DEFAULT_ANNUAL_RETURN,
    horizonYears: DEFAULT_HORIZON_YEARS,
  });

  return {
    assets,
    totalAssetValueCents,
    totalDebtCents,
    startingBalanceCents,
    availableCashCents: cashBalance.availableCashCents,
    cashBalanceSource: cashBalance.source,
    cashBalanceStale: cashBalance.stale,
    cashBalanceAsOf: cashBalance.asOf,
    weeklyContributionCents,
    annualReturnRate: DEFAULT_ANNUAL_RETURN,
    horizonYears: DEFAULT_HORIZON_YEARS,
    projectionPoints: netWorthProjection.points,
    crossoverWeek: netWorthProjection.crossoverWeek,
    projectionSource: {
      closedWeekCount: closedWeeks.length,
      currentWeekNumber,
      cashflowAverageCents: projection.wpcCents,
      weeklyTaxDueCents,
    },
  };
}
