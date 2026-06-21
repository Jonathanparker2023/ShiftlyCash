import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { addDaysIso } from "@/lib/dashboard/dates";
import { dollarsToCents } from "@/lib/domain/money";

type NumericValue = number | string | null;

type WeekTotalRow = {
  week_id: string;
  start_date: string;
  end_date: string;
  display_week_number: number;
  status: "active" | "closed";
  earnings_total: NumericValue;
  spend_total: NumericValue;
  base_total: NumericValue;
  cashflow_total: NumericValue;
};

export type TrendsWeek = {
  weekId: string;
  startDate: string;
  endDate: string;
  weekNumber: number;
  status: "active" | "closed";
  earningsCents: number;
  spendCents: number;
  baseCents: number;
  cashflowCents: number;
};

type GasAllocationRow = {
  id: string;
  merchant_name: string;
  fill_date: string;
  previous_fill_date: string;
  gas_amount_cents: NumericValue;
  original_amount_cents: NumericValue;
  remainder_amount_cents: NumericValue;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TrendsGasTracker =
  | {
      status: "waiting_for_fill";
    }
  | {
      status: "active";
      allocationId: string;
      merchantName: string;
      previousFillDate: string;
      periodStartDate: string;
      fillDate: string;
      periodDays: number;
      gasAmountCents: number;
      averageDailyGasCents: number;
      originalAmountCents: number;
      remainderAmountCents: number;
      updatedAt: string;
    };

export type TrendsData = {
  weeks: TrendsWeek[];
  gasTracker: TrendsGasTracker;
};

export async function getTrendsData(): Promise<TrendsData> {
  const { supabase, user } = await requireUserWithBootstrapStatus();
  const [
    { data, error },
    { data: gasData, error: gasError },
  ] = await Promise.all([
    supabase
      .from("v_week_totals")
      .select(
        "week_id,start_date,end_date,display_week_number,status,earnings_total,spend_total,base_total,cashflow_total",
      )
      .eq("user_id", user.id)
      .order("start_date", { ascending: true }),
    supabase
      .from("gas_allocations")
      .select(
        "id,merchant_name,fill_date,previous_fill_date,gas_amount_cents,original_amount_cents,remainder_amount_cents,is_active,created_at,updated_at",
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("fill_date", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);

  if (error) {
    throw new Error(`Unable to load trends: ${error.message}`);
  }
  if (gasError) {
    throw new Error(`Unable to load gas tracker: ${gasError.message}`);
  }

  return {
    weeks: ((data ?? []) as WeekTotalRow[]).map(mapTrendsWeek),
    gasTracker: mapGasTracker(((gasData ?? []) as GasAllocationRow[])[0]),
  };
}

function mapTrendsWeek(row: WeekTotalRow): TrendsWeek {
  return {
    weekId: row.week_id,
    startDate: row.start_date,
    endDate: row.end_date,
    weekNumber: row.display_week_number,
    status: row.status,
    earningsCents: dollarsToCents(toNumber(row.earnings_total)),
    spendCents: dollarsToCents(toNumber(row.spend_total)),
    baseCents: dollarsToCents(toNumber(row.base_total)),
    cashflowCents: dollarsToCents(toNumber(row.cashflow_total)),
  };
}

function toNumber(value: NumericValue): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapGasTracker(row: GasAllocationRow | undefined): TrendsGasTracker {
  if (!row) {
    return { status: "waiting_for_fill" };
  }

  const periodStartDate = addDaysIso(row.previous_fill_date, 1);
  const periodDays = inclusiveDateDiff(periodStartDate, row.fill_date);
  const gasAmountCents = Math.round(toNumber(row.gas_amount_cents));

  return {
    status: "active",
    allocationId: row.id,
    merchantName: row.merchant_name,
    previousFillDate: row.previous_fill_date,
    periodStartDate,
    fillDate: row.fill_date,
    periodDays,
    gasAmountCents,
    averageDailyGasCents: Math.round(gasAmountCents / periodDays),
    originalAmountCents: Math.round(toNumber(row.original_amount_cents)),
    remainderAmountCents: Math.round(toNumber(row.remainder_amount_cents)),
    updatedAt: row.updated_at ?? row.created_at,
  };
}

function inclusiveDateDiff(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00.000Z`);
  const end = Date.parse(`${endIso}T00:00:00.000Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  return Number.isFinite(days) && days > 0 ? days : 1;
}
