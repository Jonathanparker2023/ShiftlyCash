import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { getTodayIso } from "@/lib/dashboard/dates";
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
  start_date: string | null;
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
      periodEndDate: string;
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
        "id,merchant_name,fill_date,previous_fill_date,start_date,gas_amount_cents,original_amount_cents,remainder_amount_cents,is_active,created_at,updated_at",
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("fill_date", { ascending: false })
      .order("updated_at", { ascending: false }),
  ]);

  if (error) {
    throw new Error(`Unable to load trends: ${error.message}`);
  }
  if (gasError) {
    throw new Error(`Unable to load gas tracker: ${gasError.message}`);
  }

  return {
    weeks: ((data ?? []) as WeekTotalRow[]).map(mapTrendsWeek),
    gasTracker: mapGasTracker((gasData ?? []) as GasAllocationRow[]),
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

// Mirrors v_day_gas_spend_totals: the gas tracker is the whole-history
// CONVERGING daily average — total active gas / inclusive days from the FIRST
// tank start to today — NOT a single fill's window (which collapses to ~1 day
// and shows the entire tank as the "daily" rate).
function mapGasTracker(rows: GasAllocationRow[]): TrendsGasTracker {
  if (rows.length === 0) {
    return { status: "waiting_for_fill" };
  }

  // Rows are ordered fill_date desc — [0] is the most recent fill (used for the
  // merchant + previous-fill context lines).
  const latest = rows[0];
  const sum = (pick: (row: GasAllocationRow) => NumericValue) =>
    rows.reduce((total, row) => total + Math.round(toNumber(pick(row))), 0);
  const gasAmountCents = sum((row) => row.gas_amount_cents);
  const remainderAmountCents = sum((row) => row.remainder_amount_cents);
  const originalAmountCents = sum((row) => row.original_amount_cents);

  // first_date = earliest tank START across active fills (start_date, falling
  // back to fill_date). ISO dates compare chronologically as strings.
  const firstDate = rows
    .map((row) => row.start_date ?? row.fill_date)
    .reduce((min, date) => (date < min ? date : min));
  const today = getTodayIso();
  const periodDays = inclusiveDateDiff(firstDate, today);

  return {
    status: "active",
    allocationId: latest.id,
    merchantName: latest.merchant_name,
    previousFillDate: latest.previous_fill_date,
    periodStartDate: firstDate,
    periodEndDate: today,
    periodDays,
    gasAmountCents,
    averageDailyGasCents: Math.round(gasAmountCents / periodDays),
    originalAmountCents,
    remainderAmountCents,
    updatedAt: latest.updated_at ?? latest.created_at,
  };
}

function inclusiveDateDiff(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00.000Z`);
  const end = Date.parse(`${endIso}T00:00:00.000Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  return Number.isFinite(days) && days > 0 ? days : 1;
}
