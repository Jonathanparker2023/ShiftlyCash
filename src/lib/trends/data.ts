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
  start_date: string | null;
  gas_amount_cents: NumericValue;
  created_at: string;
  updated_at: string;
};

type EvChargeAllocationRow = {
  id: string;
  merchant_name: string;
  charge_date: string;
  start_date: string | null;
  charge_amount_cents: NumericValue;
  created_at: string;
  updated_at: string;
};

export type TrendsEnergyTracker =
  | {
      status: "waiting";
    }
  | {
      status: "active";
      periodStartDate: string;
      periodEndDate: string;
      periodDays: number;
      totalCents: number;
      averageDailyCents: number;
      updatedAt: string;
      events: Array<{
        id: string;
        date: string;
        merchantName: string;
        amountCents: number;
      }>;
      weeklyAverages: Array<{
        weekId: string;
        weekNumber: number;
        startDate: string;
        endDate: string;
        periodEndDate: string;
        status: "active" | "closed";
        periodDays: number;
        totalCents: number;
        averageDailyCents: number;
        eventCount: number;
      }>;
      last7d: {
        totalCents: number;
        avgPerDayCents: number;
        eventCount: number;
      };
      last30d: {
        totalCents: number;
        avgPerDayCents: number;
        eventCount: number;
        highestEventCents: number;
        avgPerEventCents: number;
      };
    };

export type TrendsData = {
  weeks: TrendsWeek[];
  gasEndedOn: string | null;
  gasTracker: TrendsEnergyTracker;
  evChargeTracker: TrendsEnergyTracker;
};

export async function getTrendsData(): Promise<TrendsData> {
  const { supabase, user } = await requireUserWithBootstrapStatus();
  const todayIso = getTodayIso();

  const [
    { data: weekData, error: weekError },
    { data: gasData, error: gasError },
    { data: evData, error: evError },
    { data: settingsData, error: settingsError },
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
        "id,merchant_name,fill_date,start_date,gas_amount_cents,created_at,updated_at",
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("fill_date", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase
      .from("ev_charge_allocations")
      .select(
        "id,merchant_name,charge_date,start_date,charge_amount_cents,created_at,updated_at",
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("charge_date", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase
      .from("transport_energy_settings")
      .select("gas_ended_on")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (weekError) {
    throw new Error(`Unable to load trends: ${weekError.message}`);
  }
  if (gasError) {
    throw new Error(`Unable to load gas history: ${gasError.message}`);
  }
  if (evError) {
    throw new Error(`Unable to load EV charge history: ${evError.message}`);
  }
  if (settingsError) {
    throw new Error(
      `Unable to load transport settings: ${settingsError.message}`,
    );
  }

  const gasEndedOn =
    (settingsData as { gas_ended_on?: string | null } | null)?.gas_ended_on ??
    null;

  const weeks = ((weekData ?? []) as WeekTotalRow[]).map(mapTrendsWeek);

  return {
    weeks,
    gasEndedOn,
    gasTracker: mapEnergyTracker(
      ((gasData ?? []) as GasAllocationRow[]).map((row) => ({
        id: row.id,
        date: row.fill_date,
        startDate: row.start_date,
        merchantName: row.merchant_name,
        amountCents: Math.round(toNumber(row.gas_amount_cents)),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      gasEndedOn ?? todayIso,
    ),
    evChargeTracker: mapEnergyTracker(
      ((evData ?? []) as EvChargeAllocationRow[]).map((row) => ({
        id: row.id,
        date: row.charge_date,
        startDate: row.start_date,
        merchantName: row.merchant_name,
        amountCents: Math.round(toNumber(row.charge_amount_cents)),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      todayIso,
      weeks,
    ),
  };
}

type EnergyEvent = {
  id: string;
  date: string;
  startDate: string | null;
  merchantName: string;
  amountCents: number;
  createdAt: string;
  updatedAt: string;
};

export function mapEnergyTracker(
  events: EnergyEvent[],
  periodEndDate: string,
  weeks: TrendsWeek[] = [],
): TrendsEnergyTracker {
  if (events.length === 0) {
    return { status: "waiting" };
  }

  const average = calculateGasAverage(
    events.map((event) => ({
      gasAmountCents: event.amountCents,
      startDate: event.startDate,
      fillDate: event.date,
    })),
    periodEndDate,
  );
  if (!average) {
    return { status: "waiting" };
  }

  const eventsIn = (fromIso: string) =>
    events.filter(
      (event) => event.date >= fromIso && event.date <= periodEndDate,
    );
  const events7d = eventsIn(addDaysIso(periodEndDate, -6));
  const events30d = eventsIn(addDaysIso(periodEndDate, -29));
  const sumEvents = (rows: EnergyEvent[]) =>
    rows.reduce((total, event) => total + event.amountCents, 0);
  const total7d = sumEvents(events7d);
  const total30d = sumEvents(events30d);
  const sortedEvents = [...events].sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      right.updatedAt.localeCompare(left.updatedAt),
  );
  const latest = sortedEvents[0];
  const firstEventDate = sortedEvents.at(-1)?.date ?? periodEndDate;
  const weeklyAverages = weeks
    .filter(
      (week) =>
        week.endDate >= firstEventDate && week.startDate <= periodEndDate,
    )
    .map((week) => {
      const effectiveEndDate =
        week.endDate < periodEndDate ? week.endDate : periodEndDate;
      const weekEvents = events.filter(
        (event) =>
          event.date >= week.startDate && event.date <= effectiveEndDate,
      );
      const totalCents = sumEvents(weekEvents);
      const periodDays = inclusiveDays(week.startDate, effectiveEndDate);

      return {
        weekId: week.weekId,
        weekNumber: week.weekNumber,
        startDate: week.startDate,
        endDate: week.endDate,
        periodEndDate: effectiveEndDate,
        status: week.status,
        periodDays,
        totalCents,
        averageDailyCents: Math.round(totalCents / periodDays),
        eventCount: weekEvents.length,
      };
    })
    .sort((left, right) => right.startDate.localeCompare(left.startDate));

  return {
    status: "active",
    periodStartDate: average.firstDate,
    periodEndDate,
    periodDays: average.periodDays,
    totalCents: average.totalCents,
    averageDailyCents: average.dailyAverageCents,
    updatedAt: latest.updatedAt ?? latest.createdAt,
    events: sortedEvents.map((event) => ({
      id: event.id,
      date: event.date,
      merchantName: event.merchantName,
      amountCents: event.amountCents,
    })),
    weeklyAverages,
    last7d: {
      totalCents: total7d,
      avgPerDayCents: Math.round(total7d / 7),
      eventCount: events7d.length,
    },
    last30d: {
      totalCents: total30d,
      avgPerDayCents: Math.round(total30d / 30),
      eventCount: events30d.length,
      highestEventCents:
        events30d.length > 0
          ? Math.max(...events30d.map((event) => event.amountCents))
          : 0,
      avgPerEventCents:
        events30d.length > 0
          ? Math.round(total30d / events30d.length)
          : Math.round(average.totalCents / events.length),
    },
  };
}

function inclusiveDays(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00.000Z`);
  const to = Date.parse(`${toIso}T00:00:00.000Z`);
  return Math.max(1, Math.round((to - from) / 86_400_000) + 1);
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
