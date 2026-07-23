import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { addDaysIso, getTodayIso } from "@/lib/dashboard/dates";
import { dollarsToCents } from "@/lib/domain/money";
import { calculateGasAverage } from "@/lib/gas/average";

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

  const [{ data, error }, { data: gasData, error: gasError }] = await Promise.all([
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
  ]);

  if (error) {
    throw new Error(`Unable to load trends: ${error.message}`);
  }
  if (gasError) {
    throw new Error(`Unable to load gas tracker: ${gasError.message}`);
  }

  return {
    weeks: ((data ?? []) as WeekTotalRow[]).map(mapTrendsWeek),
    gasTracker: mapGasTracker((gasData ?? []) as GasAllocationRow[], todayIso),
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

// The whole-history "Total average" headline is a CONVERGING daily average —
// total active gas / inclusive days from the FIRST tank start to today (see
// calculateGasAverage). The rolling 7d/30d metrics answer the different,
// practical "is gas creeping up RIGHT NOW" question, so they are windowed off
// the RAW fills actually tagged inside each window (sum of those fills ÷ 7 or
// ÷ 30). This is deliberately NOT the amortized daily spread — reading the
// spread made all three averages collapse to the same smoothed number and hid
// recent fill activity. Raw-fill windows spike when you actually fill up.
function mapGasTracker(
  rows: GasAllocationRow[],
  todayIso: string,
): TrendsGasTracker {
  if (rows.length === 0) {
    return { status: "waiting_for_fill" };
  }

  // Rows are ordered fill_date desc — [0] is the most recent fill (used for the
  // merchant + previous-fill context lines).
  const latest = rows[0];
  const average = calculateGasAverage(
    rows.map((row) => ({
      gasAmountCents: toNumber(row.gas_amount_cents),
      startDate: row.start_date,
      fillDate: row.fill_date,
    })),
    todayIso,
  );
  if (!average) {
    return { status: "waiting_for_fill" };
  }

  const last7dStart = addDaysIso(todayIso, -6);
  const last30dStart = addDaysIso(todayIso, -29);

  const fillsIn = (fromIso: string) =>
    rows.filter((row) => row.fill_date >= fromIso && row.fill_date <= todayIso);
  const fills7d = fillsIn(last7dStart);
  const fills30d = fillsIn(last30dStart);
  const fillAmount = (row: GasAllocationRow) => Math.round(toNumber(row.gas_amount_cents));
  const sumFills = (fills: GasAllocationRow[]) =>
    fills.reduce((total, row) => total + fillAmount(row), 0);

  // Windows are sums of the RAW fills tagged in each window, divided by the
  // fixed calendar span (7 / 30) so the label matches the math: "the last 7
  // days of actual gas spend, per day".
  const last7dTotalCents = sumFills(fills7d);
  const last30dTotalCents = sumFills(fills30d);
  const last7dAvgPerDayCents = Math.round(last7dTotalCents / 7);
  const last30dAvgPerDayCents = Math.round(last30dTotalCents / 30);

  const highestFillCents30d =
    fills30d.length > 0 ? Math.max(...fills30d.map(fillAmount)) : 0;
  // Average per fill-up over the last 30 days; fall back to all-time average
  // if nothing was filled in that window so the stat isn't a misleading $0.
  const avgPerFillCents30d =
    fills30d.length > 0
      ? Math.round(fills30d.reduce((sum, row) => sum + fillAmount(row), 0) / fills30d.length)
      : Math.round(average.totalCents / rows.length);

  return {
    status: "active",
    allocationId: latest.id,
    merchantName: latest.merchant_name,
    previousFillDate: latest.previous_fill_date,
    periodStartDate: average.firstDate,
    periodEndDate: todayIso,
    periodDays: average.periodDays,
    gasAmountCents: average.totalCents,
    averageDailyGasCents: average.dailyAverageCents,
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
