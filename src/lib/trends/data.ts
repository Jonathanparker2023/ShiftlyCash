import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { addDaysIso, getTodayIso } from "@/lib/dashboard/dates";
import { dollarsToCents } from "@/lib/domain/money";

const ROLLING_WINDOW_DAYS = 30; // covers both the 7d and 30d windows below

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
      // Whole-history converging average — the "true daily gas cost" headline.
      periodStartDate: string;
      periodEndDate: string;
      periodDays: number;
      gasAmountCents: number;
      averageDailyGasCents: number;
      updatedAt: string;
      fills: Array<{
        id: string;
        fillDate: string;
        merchantName: string;
        gasAmountCents: number;
      }>;
      // Rolling-window practical metrics (task: gas metrics upgrade).
      last7d: {
        totalCents: number;
        avgPerDayCents: number;
        fillUps: number;
      };
      last30d: {
        totalCents: number;
        avgPerDayCents: number;
        fillUps: number;
        highestFillCents: number;
        avgPerFillCents: number;
      };
    };

export type TrendsData = {
  weeks: TrendsWeek[];
  gasTracker: TrendsGasTracker;
};

export async function getTrendsData(): Promise<TrendsData> {
  const { supabase, user } = await requireUserWithBootstrapStatus();
  const todayIso = getTodayIso();
  const windowStartIso = addDaysIso(todayIso, -(ROLLING_WINDOW_DAYS - 1));

  const [
    { data, error },
    { data: gasData, error: gasError },
    { data: dayRows, error: dayError },
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
        "id,merchant_name,fill_date,previous_fill_date,start_date,gas_amount_cents,is_active,created_at,updated_at",
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("fill_date", { ascending: false })
      .order("updated_at", { ascending: false }),
    // Last 30 calendar days of `days` rows, so we can attach a real date to
    // each v_day_gas_spend_totals slice (that view only exposes day_id).
    supabase
      .from("days")
      .select("id,date")
      .eq("user_id", user.id)
      .gte("date", windowStartIso)
      .lte("date", todayIso),
  ]);

  if (error) {
    throw new Error(`Unable to load trends: ${error.message}`);
  }
  if (gasError) {
    throw new Error(`Unable to load gas tracker: ${gasError.message}`);
  }
  if (dayError) {
    throw new Error(`Unable to load recent days for gas metrics: ${dayError.message}`);
  }

  const recentDayRows = (dayRows ?? []) as { id: string; date: string }[];
  const dayIds = recentDayRows.map((row) => row.id);
  let gasSpreadByDate = new Map<string, number>();
  if (dayIds.length > 0) {
    const { data: spreadData, error: spreadError } = await supabase
      .from("v_day_gas_spend_totals")
      .select("day_id,gas_spend_cents")
      .in("day_id", dayIds);
    if (spreadError) {
      throw new Error(`Unable to load gas spread: ${spreadError.message}`);
    }
    const dateByDayId = new Map(recentDayRows.map((row) => [row.id, row.date]));
    gasSpreadByDate = new Map(
      ((spreadData ?? []) as { day_id: string; gas_spend_cents: NumericValue }[])
        .map((row) => [dateByDayId.get(row.day_id), Math.round(toNumber(row.gas_spend_cents))])
        .filter((entry): entry is [string, number] => Boolean(entry[0])),
    );
  }

  return {
    weeks: ((data ?? []) as WeekTotalRow[]).map(mapTrendsWeek),
    gasTracker: mapGasTracker(
      (gasData ?? []) as GasAllocationRow[],
      gasSpreadByDate,
      todayIso,
    ),
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

// Mirrors v_day_gas_spend_totals: the whole-history headline is a CONVERGING
// daily average — total active gas / inclusive days from the FIRST tank start
// to today — NOT a single fill's window (which collapses to ~1 day and shows
// the entire tank as the "daily" rate). Rolling 7d/30d metrics below answer
// the more practical "is gas creeping up right now" question that headline
// can't: they're windowed off the real per-day gas-spread slices + individual
// fill events, so a quiet month doesn't get diluted by a busy year.
function mapGasTracker(
  rows: GasAllocationRow[],
  gasSpreadByDate: Map<string, number>,
  todayIso: string,
): TrendsGasTracker {
  if (rows.length === 0) {
    return { status: "waiting_for_fill" };
  }

  // Rows are ordered fill_date desc — [0] is the most recent fill (used for the
  // merchant + previous-fill context lines).
  const latest = rows[0];
  const gasAmountCents = rows.reduce(
    (total, row) => total + Math.round(toNumber(row.gas_amount_cents)),
    0,
  );

  // first_date = earliest tank START across active fills (start_date, falling
  // back to fill_date). ISO dates compare chronologically as strings.
  const firstDate = rows
    .map((row) => row.start_date ?? row.fill_date)
    .reduce((min, date) => (date < min ? date : min));
  const periodDays = inclusiveDateDiff(firstDate, todayIso);

  const last7dStart = addDaysIso(todayIso, -6);
  const last30dStart = addDaysIso(todayIso, -29);

  const sumSpread = (fromIso: string) => {
    let total = 0;
    for (const [date, cents] of gasSpreadByDate) {
      if (date >= fromIso && date <= todayIso) {
        total += cents;
      }
    }
    return total;
  };
  const last7dTotalCents = sumSpread(last7dStart);
  const last30dTotalCents = sumSpread(last30dStart);
  const last7dAvgPerDayCents = Math.round(last7dTotalCents / 7);
  const last30dAvgPerDayCents = Math.round(last30dTotalCents / 30);

  const fillsIn = (fromIso: string) =>
    rows.filter((row) => row.fill_date >= fromIso && row.fill_date <= todayIso);
  const fills7d = fillsIn(last7dStart);
  const fills30d = fillsIn(last30dStart);
  const fillAmount = (row: GasAllocationRow) => Math.round(toNumber(row.gas_amount_cents));
  const highestFillCents30d =
    fills30d.length > 0 ? Math.max(...fills30d.map(fillAmount)) : 0;
  // Average per fill-up over the last 30 days; fall back to all-time average
  // if nothing was filled in that window so the stat isn't a misleading $0.
  const avgPerFillCents30d =
    fills30d.length > 0
      ? Math.round(fills30d.reduce((sum, row) => sum + fillAmount(row), 0) / fills30d.length)
      : Math.round(gasAmountCents / rows.length);

  return {
    status: "active",
    allocationId: latest.id,
    merchantName: latest.merchant_name,
    previousFillDate: latest.previous_fill_date,
    periodStartDate: firstDate,
    periodEndDate: todayIso,
    periodDays,
    gasAmountCents,
    averageDailyGasCents: Math.round(gasAmountCents / periodDays),
    updatedAt: latest.updated_at ?? latest.created_at,
    fills: rows.map((row) => ({
      id: row.id,
      fillDate: row.fill_date,
      merchantName: row.merchant_name,
      gasAmountCents: fillAmount(row),
    })),
    last7d: {
      totalCents: last7dTotalCents,
      avgPerDayCents: last7dAvgPerDayCents,
      fillUps: fills7d.length,
    },
    last30d: {
      totalCents: last30dTotalCents,
      avgPerDayCents: last30dAvgPerDayCents,
      fillUps: fills30d.length,
      highestFillCents: highestFillCents30d,
      avgPerFillCents: avgPerFillCents30d,
    },
  };
}

function inclusiveDateDiff(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00.000Z`);
  const end = Date.parse(`${endIso}T00:00:00.000Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  return Number.isFinite(days) && days > 0 ? days : 1;
}
