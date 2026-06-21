import { requireUserWithBootstrapStatus } from "@/lib/auth";
import {
  deriveSpendProjection,
  type DashboardSpendProjection,
} from "@/lib/dashboard/spendProjection";
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

type ProjectionWeekRow = {
  week_id: string;
  start_date: string;
  display_week_number: number;
  spend_for_projection: NumericValue;
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

export type TrendsSpendProjectionWeek = {
  weekId: string;
  startDate: string;
  weekNumber: number;
  spendCents: number;
};

export type TrendsSpendProjection = DashboardSpendProjection & {
  sourceWeeks: TrendsSpendProjectionWeek[];
};

export type TrendsData = {
  weeks: TrendsWeek[];
  spendProjection: TrendsSpendProjection;
};

export async function getTrendsData(): Promise<TrendsData> {
  const { supabase, user } = await requireUserWithBootstrapStatus();
  const [
    { data, error },
    { data: projectionData, error: projectionError },
  ] = await Promise.all([
    supabase
      .from("v_week_totals")
      .select(
        "week_id,start_date,end_date,display_week_number,status,earnings_total,spend_total,base_total,cashflow_total",
      )
      .eq("user_id", user.id)
      .order("start_date", { ascending: true }),
    supabase
      .from("v_projection_weeks")
      .select("week_id,start_date,display_week_number,spend_for_projection")
      .eq("user_id", user.id)
      .not("spend_for_projection", "is", null)
      .order("start_date", { ascending: true }),
  ]);

  if (error) {
    throw new Error(`Unable to load trends: ${error.message}`);
  }
  if (projectionError) {
    throw new Error(
      `Unable to load spend projection: ${projectionError.message}`,
    );
  }

  const projectionWeeks = ((projectionData ?? []) as ProjectionWeekRow[])
    .map(mapProjectionWeek)
    .filter((week) => week.spendCents > 0);
  const projection = deriveSpendProjection(projectionWeeks);

  return {
    weeks: ((data ?? []) as WeekTotalRow[]).map(mapTrendsWeek),
    spendProjection: {
      ...projection,
      sourceWeeks: projectionWeeks,
    },
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

function mapProjectionWeek(row: ProjectionWeekRow): TrendsSpendProjectionWeek {
  return {
    weekId: row.week_id,
    startDate: row.start_date,
    weekNumber: row.display_week_number,
    spendCents: dollarsToCents(toNumber(row.spend_for_projection)),
  };
}

function toNumber(value: NumericValue): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
