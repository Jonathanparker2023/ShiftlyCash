import { requireUserWithBootstrapStatus } from "@/lib/auth";
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

export type TrendsData = {
  weeks: TrendsWeek[];
};

export async function getTrendsData(): Promise<TrendsData> {
  const { supabase, user } = await requireUserWithBootstrapStatus();
  const { data, error } = await supabase
    .from("v_week_totals")
    .select(
      "week_id,start_date,end_date,display_week_number,status,earnings_total,spend_total,base_total,cashflow_total",
    )
    .eq("user_id", user.id)
    .order("start_date", { ascending: true });

  if (error) {
    throw new Error(`Unable to load trends: ${error.message}`);
  }

  return {
    weeks: ((data ?? []) as WeekTotalRow[]).map(mapTrendsWeek),
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
