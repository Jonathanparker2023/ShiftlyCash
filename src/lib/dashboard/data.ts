import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { mark, since, timed } from "@/lib/perf";
import {
  addDaysIso,
  formatDayLabel,
  getSundayOnOrBeforeTodayIso,
  getTodayIso,
} from "@/lib/dashboard/dates";
import type {
  AmortizationCreditRow,
  DashboardData,
  DashboardDay,
  DashboardSlot,
  DashboardTransaction,
  DashboardTransactionSource,
  DashboardTransactionStatus,
  EarnSlotSource,
  DashboardWeek,
  DashboardWeekNavigation,
} from "@/lib/dashboard/types";
import { sortDashboardTransactions } from "@/lib/dashboard/transactions";
import { applyDashboardProjectionMaintenance } from "@/lib/dashboard/projectionMaintenance";
import {
  deriveSpendProjection,
  type DashboardSpendProjection,
} from "@/lib/dashboard/spendProjection";
import {
  dollarsToCents,
  roundCentsToNearestTenDollars,
} from "@/lib/domain/money";
import { calculateGasAverage } from "@/lib/gas/average";
import type {
  IncentiveMode,
  JobType,
  PaySettings,
  PayType,
} from "@/lib/domain/pay";

type NumericValue = number | string | null;

type SettingsRow = {
  ability_regular_net_rate: NumericValue;
  ability_ot_net_rate: NumericValue;
  prestige_regular_net_rate: NumericValue;
  prestige_ot_net_rate: NumericValue;
  prestige_ilst_net_rate: NumericValue;
  prestige_ilst_ot_net_rate: NumericValue;
  ability_withholding_rate: NumericValue;
  hidden_builtin_jobs: string[] | null;
};

type WeekRow = {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
};

type AdjacentWeekRow = Pick<WeekRow, "id" | "status">;

type DayRow = {
  id: string;
  week_id: string;
  date: string;
  day_index: number;
  base_amount: NumericValue;
  manual_spend_adjustment: NumericValue;
  spend_locked: boolean;
};

type EarnSlotRow = {
  id: string;
  day_id: string;
  slot_index: number;
  job_type: JobType;
  pay_type: PayType;
  hours_or_units: NumericValue;
  regular_hours: NumericValue;
  overtime_hours: NumericValue;
  incentive_mode: IncentiveMode | null;
  incentive_rate: NumericValue;
  incentive_amount: NumericValue;
  label: string | null;
  source: EarnSlotSource;
  custom_job_id: string | null;
  reconciled_net_cents: number | null;
};

type CustomJobRow = {
  id: string;
  name: string;
  color: string;
  regular_rate_cents: NumericValue;
  ot_rate_cents: NumericValue;
  active: boolean;
};

type AdjacentEarnSlotRow = {
  job_type: JobType;
  pay_type: PayType;
  hours_or_units: NumericValue;
  regular_hours: NumericValue;
  overtime_hours: NumericValue;
  incentive_mode: IncentiveMode | null;
  incentive_rate: NumericValue;
  incentive_amount: NumericValue;
};

type TransactionRow = {
  id: string;
  day_id: string | null;
  date: string;
  datetime: string | null;
  legacy_time: string | null;
  created_at: string;
  merchant_name: string;
  amount: NumericValue;
  category: string | null;
  source: DashboardTransactionSource;
  status: DashboardTransactionStatus | "pending_review";
  review_reason: string | null;
  moved_to_yesterday: boolean;
};

type GasSpreadRow = {
  day_id: string;
  gas_spend_cents: NumericValue;
};

type EvChargeSpreadRow = {
  day_id: string;
  ev_charge_spend_cents: NumericValue;
};

type GasAllocationRow = {
  source_transaction_id: string;
  fill_date: string;
  start_date: string | null;
  gas_amount_cents: NumericValue;
  remainder_amount_cents: NumericValue;
  is_active: boolean;
};

type EvChargeAllocationRow = {
  source_transaction_id: string;
  charge_date: string;
  start_date: string | null;
  charge_amount_cents: NumericValue;
  remainder_amount_cents: NumericValue;
  is_active: boolean;
};

type WeekTotalRow = {
  week_id: string;
  display_week_number: number;
  pay_period_role: "week_1" | "week_2";
  paycheck_due_date: string | null;
  earnings_total: NumericValue;
  ability_paycheck_earnings: NumericValue;
  prestige_paycheck_earnings: NumericValue;
  wage_hours_total: NumericValue;
  spend_total: NumericValue;
  base_total: NumericValue;
  cashflow_total: NumericValue;
  running_balance: NumericValue;
};

type ClosedWeekMetricRow = {
  earnings_total: NumericValue;
  spend_total: NumericValue;
  cashflow_total: NumericValue;
};

type ProjectionWeekRow = {
  spend_for_projection: NumericValue;
  start_date: string;
};

// Below this many closed weeks in the new year, the year median is noisier than
// the trailing window it replaced — so January falls back. Mirrors the same
// threshold in apply_future_day_projection.
const PROJECTION_MIN_YEAR_WEEKS = 4;
const PROJECTION_FALLBACK_WEEKS = 12;

/**
 * Pick the weeks the autofill median is taken from: the calendar year, or a
 * trailing window when the year is too young to be stable.
 */
function selectProjectionWindow(
  rows: ProjectionWeekRow[],
  todayIso: string,
): DashboardSpendProjection {
  const yearStart = `${todayIso.slice(0, 4)}-01-01`;
  const thisYear = rows.filter((row) => row.start_date >= yearStart);
  const useYear = thisYear.length >= PROJECTION_MIN_YEAR_WEEKS;
  const chosen = useYear ? thisYear : rows.slice(-PROJECTION_FALLBACK_WEEKS);

  return deriveSpendProjection(
    chosen.map((row) => ({
      spendCents: dollarsToCents(toNumber(row.spend_for_projection)),
    })),
    useYear ? "year_median" : "recent_twelve_median",
  );
}

type BaselineTotalRow = {
  monthly_total: NumericValue;
  weekly_average: NumericValue;
  projected_daily_base: NumericValue;
};

type DayTotalRow = {
  day_id: string;
  earnings_total: NumericValue;
  ability_paycheck_earnings: NumericValue;
  prestige_paycheck_earnings: NumericValue;
  wage_hours_total: NumericValue;
  transaction_spend_total: NumericValue;
  spend_total: NumericValue;
  base_amount: NumericValue;
  cashflow_total: NumericValue;
};

type BaseAllocationRow = {
  day_id: string;
  item_kind: "recurring" | "amortized";
  item_id: string;
  item_name: string;
  original_amount_cents: NumericValue;
  period_days: NumericValue | null;
  daily_alloc_cents: NumericValue;
  applied_cents: NumericValue;
  schedule_version: NumericValue;
};

type AdjacentAbilityPayPeriod = {
  adjacentWeekAbilityHours: number;
  adjacentWeekAbilityRegularHours: number;
  adjacentWeekAbilityOvertimeHours: number;
  adjacentWeekAbilityPaycheckCents: number;
  hasAdjacentWeek: boolean;
};

export async function getWeekDashboardData(
  weekId: string,
): Promise<DashboardData> {
  return getDashboardData({ weekId });
}

export async function getDashboardData(
  options?: { weekId?: string },
): Promise<DashboardData> {
  const tTotal = mark();
  const { supabase, user } = await timed("dashboard:auth", () =>
    requireUserWithBootstrapStatus(),
  );
  const startDate = getSundayOnOrBeforeTodayIso();
  const todayIso = getTodayIso();

  let weekId: string;
  if (options?.weekId) {
    // Historical (read-only) load: use the requested week and DO NOT ensure an
    // active week or run projection maintenance — those WRITE to live days.
    weekId = options.weekId;
  } else {
    const { data: ensuredWeekId, error: ensureError } = await timed(
      "dashboard:ensureWeek",
      () =>
        supabase.rpc("ensure_current_active_week", { p_start_date: startDate }),
    );

    if (ensureError) {
      throw new Error(`Unable to ensure active week: ${ensureError.message}`);
    }

    if (typeof ensuredWeekId !== "string") {
      throw new Error("Active week RPC did not return a week id.");
    }

    weekId = ensuredWeekId;

    await timed("dashboard:projectionMaintenance", () =>
      applyDashboardProjectionMaintenance(supabase, { weekId, todayIso }),
    );
  }

  const tBatchA = mark();
  const [
    { data: settingsData, error: settingsError },
    { data: weekData, error: weekError },
    { data: dayData, error: dayError },
    { data: dayTotalData, error: dayTotalError },
    { data: weekTotalData, error: weekTotalError },
    { data: baselineTotalData, error: baselineTotalError },
    { data: closedWeekMetricData, error: closedWeekMetricError },
    { data: projectionWeekData, error: projectionWeekError },
  ] = await Promise.all([
    supabase
      .from("settings")
      .select(
        "ability_regular_net_rate, ability_ot_net_rate, prestige_regular_net_rate, prestige_ot_net_rate, prestige_ilst_net_rate, prestige_ilst_ot_net_rate, ability_withholding_rate, hidden_builtin_jobs",
      )
      .single(),
    supabase
      .from("weeks")
      .select("id,start_date,end_date,status")
      .eq("id", weekId)
      .single(),
    supabase
      .from("days")
      .select(
        "id,week_id,date,day_index,base_amount,manual_spend_adjustment,spend_locked",
      )
      .eq("week_id", weekId)
      .order("day_index", { ascending: true }),
    supabase
      .from("v_day_totals")
      .select(
        "day_id,earnings_total,ability_paycheck_earnings,prestige_paycheck_earnings,wage_hours_total,transaction_spend_total,spend_total,base_amount,cashflow_total",
      )
      .eq("week_id", weekId),
    supabase
      .from("v_week_totals")
      .select(
        "week_id,display_week_number,pay_period_role,paycheck_due_date,earnings_total,ability_paycheck_earnings,prestige_paycheck_earnings,wage_hours_total,spend_total,base_total,cashflow_total,running_balance",
      )
      .eq("week_id", weekId)
      .single(),
    supabase
      .from("v_active_expense_totals")
      .select("monthly_total,weekly_average,projected_daily_base")
      .maybeSingle(),
    supabase
      .from("v_week_totals")
      .select("earnings_total,spend_total,cashflow_total")
      .eq("status", "closed")
      .order("start_date", { ascending: true }),
    supabase
      .from("v_projection_weeks")
      // start_date is needed to scope the median to the current year, matching
      // apply_future_day_projection — the two must agree or the dashboard
      // shows a different figure than the one written onto the days.
      .select("spend_for_projection,start_date")
      .eq("user_id", user.id)
      .not("spend_for_projection", "is", null)
      .order("start_date", { ascending: true }),
  ]);
  since("dashboard:batchA(settings+week+days+totals+baseline+closed)", tBatchA);

  if (settingsError) {
    throw new Error(`Unable to load settings: ${settingsError.message}`);
  }
  if (weekError) {
    throw new Error(`Unable to load active week: ${weekError.message}`);
  }
  if (dayError) {
    throw new Error(`Unable to load days: ${dayError.message}`);
  }
  if (dayTotalError) {
    throw new Error(`Unable to load day totals: ${dayTotalError.message}`);
  }
  if (weekTotalError) {
    throw new Error(`Unable to load week totals: ${weekTotalError.message}`);
  }
  if (baselineTotalError) {
    throw new Error(
      `Unable to load baseline totals: ${baselineTotalError.message}`,
    );
  }
  if (closedWeekMetricError) {
    throw new Error(
      `Unable to load metric medians: ${closedWeekMetricError.message}`,
    );
  }
  if (projectionWeekError) {
    throw new Error(
      `Unable to load spend projection weeks: ${projectionWeekError.message}`,
    );
  }

  const weekRow = weekData as WeekRow;
  const [previousWeekResult, nextWeekResult] = await Promise.all([
    supabase
      .from("weeks")
      .select("id,status")
      .eq("user_id", user.id)
      .lt("start_date", weekRow.start_date)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("weeks")
      .select("id,status")
      .eq("user_id", user.id)
      .gt("start_date", weekRow.start_date)
      .order("start_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (previousWeekResult.error) {
    console.warn(
      `[dashboard] previous week unavailable: ${previousWeekResult.error.message}`,
    );
  }
  if (nextWeekResult.error) {
    console.warn(
      `[dashboard] next week unavailable: ${nextWeekResult.error.message}`,
    );
  }
  const weekNavigation: DashboardWeekNavigation = {
    previous: previousWeekResult.data
      ? (previousWeekResult.data as AdjacentWeekRow)
      : null,
    next: nextWeekResult.data
      ? (nextWeekResult.data as AdjacentWeekRow)
      : null,
  };

  const days = (dayData ?? []) as DayRow[];
  const dayIds = days.map((day) => day.id);
  const tBatchB = mark();
  const [
    { data: slotData, error: slotError },
    { data: transactionData, error: transactionError },
  ] =
    dayIds.length > 0
      ? await Promise.all([
          supabase
            .from("earn_slots")
            .select(
              "id,day_id,slot_index,job_type,pay_type,hours_or_units,regular_hours,overtime_hours,incentive_mode,incentive_rate,incentive_amount,label,source,custom_job_id,reconciled_net_cents",
            )
            .in("day_id", dayIds)
            .order("slot_index", { ascending: true }),
          supabase
            .from("transactions")
            .select(
              "id,day_id,date,datetime,legacy_time,created_at,merchant_name,amount,category,source,status,review_reason,moved_to_yesterday",
            )
            .in("day_id", dayIds)
            .in("status", ["applied", "excluded"])
            .order("date", { ascending: true })
            .order("datetime", { ascending: true, nullsFirst: false })
            .order("legacy_time", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: true }),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];
  since("dashboard:batchB(slots+transactions)", tBatchB);

  if (slotError) {
    throw new Error(`Unable to load earn slots: ${slotError.message}`);
  }
  if (transactionError) {
    throw new Error(`Unable to load transactions: ${transactionError.message}`);
  }

  let gasAllocations: GasAllocationRow[] = [];
  const { data: gasData, error: gasError } = await supabase
    .from("gas_allocations")
    .select(
      "source_transaction_id,fill_date,start_date,gas_amount_cents,remainder_amount_cents,is_active",
    )
    .eq("user_id", user.id)
    .eq("is_active", true);
  if (gasError) {
    console.warn(`[dashboard] gas allocations unavailable: ${gasError.message}`);
  } else {
    gasAllocations = (gasData ?? []) as GasAllocationRow[];
  }

  let evChargeAllocations: EvChargeAllocationRow[] = [];
  const { data: evChargeData, error: evChargeError } = await supabase
    .from("ev_charge_allocations")
    .select(
      "source_transaction_id,charge_date,start_date,charge_amount_cents,remainder_amount_cents,is_active",
    )
    .eq("user_id", user.id)
    .eq("is_active", true);
  if (evChargeError) {
    console.warn(
      `[dashboard] EV charge allocations unavailable: ${evChargeError.message}`,
    );
  } else {
    evChargeAllocations = (evChargeData ?? []) as EvChargeAllocationRow[];
  }

  let gasEndedOn: string | null = null;
  const { data: transportSettingsData, error: transportSettingsError } =
    await supabase
      .from("transport_energy_settings")
      .select("gas_ended_on")
      .eq("user_id", user.id)
      .maybeSingle();
  if (transportSettingsError) {
    console.warn(
      `[dashboard] transport settings unavailable: ${transportSettingsError.message}`,
    );
  } else {
    gasEndedOn =
      (transportSettingsData as { gas_ended_on?: string | null } | null)
        ?.gas_ended_on ?? null;
  }

  // Per-day gas SPREAD (the converging daily slice). Surfaced so the dashboard
  // shows a visible "Gas" line on every day in the spread window, not only the
  // fill-day transaction. Soft-fail like the other overlays.
  let gasSpread: GasSpreadRow[] = [];
  if (dayIds.length > 0) {
    const { data: gasSpreadData, error: gasSpreadError } = await supabase
      .from("v_day_gas_spend_totals")
      .select("day_id,gas_spend_cents")
      .in("day_id", dayIds);
    if (gasSpreadError) {
      console.warn(`[dashboard] gas spread unavailable: ${gasSpreadError.message}`);
    } else {
      gasSpread = (gasSpreadData ?? []) as GasSpreadRow[];
    }
  }

  let evChargeSpread: EvChargeSpreadRow[] = [];
  if (dayIds.length > 0) {
    const { data: evSpreadData, error: evSpreadError } = await supabase
      .from("v_day_ev_charge_spend_totals")
      .select("day_id,ev_charge_spend_cents")
      .in("day_id", dayIds);
    if (evSpreadError) {
      console.warn(
        `[dashboard] EV charge spread unavailable: ${evSpreadError.message}`,
      );
    } else {
      evChargeSpread = (evSpreadData ?? []) as EvChargeSpreadRow[];
    }
  }

  // Per-day fixed-cost breakdown (the "Fixed" drill-down). Soft-fail: if the
  // derivation view isn't present yet (pre-migration) the dashboard still
  // renders, just with empty breakdowns.
  let baseAllocations: BaseAllocationRow[] = [];
  if (dayIds.length > 0) {
    const { data: allocData, error: allocError } = await supabase
      .from("v_day_base_allocations")
      .select(
        "day_id,item_kind,item_id,item_name,original_amount_cents,period_days,daily_alloc_cents,applied_cents,schedule_version",
      )
      .in("day_id", dayIds);
    if (allocError) {
      console.warn(
        `[dashboard] base allocations unavailable: ${allocError.message}`,
      );
    } else {
      baseAllocations = (allocData ?? []) as BaseAllocationRow[];
    }
  }

  // Amortized Income daily credits per day+bucket (the synthetic "Other" shift-bar
  // rows). Soft-fail: pre-migration the view is absent and the dashboard still
  // renders, just without bucket credits.
  let bucketCredits: AmortizationCreditRow[] = [];
  if (dayIds.length > 0) {
    const { data: creditData, error: creditError } = await supabase
      .from("v_day_amortization_credit_items")
      .select(
        "day_id,bucket_id,bucket_name,total_cents,period_days,daily_rate_cents,credit_cents,schedule_version",
      )
      .in("day_id", dayIds);
    if (creditError) {
      console.warn(
        `[dashboard] amortization credits unavailable: ${creditError.message}`,
      );
    } else {
      bucketCredits = (creditData ?? []) as AmortizationCreditRow[];
    }
  }

  // Custom jobs library (rates + colors). Soft-fail: pre-migration the table is
  // absent and the dashboard renders without custom-job pricing/colors.
  let customJobs: CustomJobRow[] = [];
  {
    const { data: jobData, error: jobError } = await supabase
      .from("custom_jobs")
      .select("id,name,color,regular_rate_cents,ot_rate_cents,active")
      .order("created_at", { ascending: true });
    if (jobError) {
      console.warn(`[dashboard] custom jobs unavailable: ${jobError.message}`);
    } else {
      customJobs = (jobData ?? []) as CustomJobRow[];
    }
  }

  const adjacentAbilityPayPeriod = await loadAdjacentAbilityPayPeriod({
    supabase,
    week: weekData as WeekRow,
    weekTotal: weekTotalData as WeekTotalRow,
  });

  const result = mapDashboardData({
    settings: settingsData as SettingsRow,
    week: weekData as WeekRow,
    weekNavigation,
    days,
    dayTotals: (dayTotalData ?? []) as DayTotalRow[],
    slots: (slotData ?? []) as EarnSlotRow[],
    transactions: (transactionData ?? []) as TransactionRow[],
    gasAllocations,
    evChargeAllocations,
    weekTotal: weekTotalData as WeekTotalRow,
    adjacentAbilityPayPeriod,
    baselineTotal: baselineTotalData as BaselineTotalRow | null,
    closedWeekMetrics: (closedWeekMetricData ?? []) as ClosedWeekMetricRow[],
    projectionWeeks: (projectionWeekData ?? []) as ProjectionWeekRow[],
    baseAllocations,
    bucketCredits,
    gasSpread,
    evChargeSpread,
    gasEndedOn,
    customJobs,
    todayIso,
  });
  since("dashboard:total", tTotal);
  return result;
}

function mapDashboardData(input: {
  settings: SettingsRow;
  week: WeekRow;
  weekNavigation: DashboardWeekNavigation;
  days: DayRow[];
  dayTotals: DayTotalRow[];
  slots: EarnSlotRow[];
  transactions: TransactionRow[];
  gasAllocations: GasAllocationRow[];
  evChargeAllocations: EvChargeAllocationRow[];
  weekTotal: WeekTotalRow;
  adjacentAbilityPayPeriod: AdjacentAbilityPayPeriod;
  baselineTotal: BaselineTotalRow | null;
  closedWeekMetrics: ClosedWeekMetricRow[];
  projectionWeeks: ProjectionWeekRow[];
  baseAllocations: BaseAllocationRow[];
  bucketCredits: AmortizationCreditRow[];
  gasSpread: GasSpreadRow[];
  evChargeSpread: EvChargeSpreadRow[];
  gasEndedOn: string | null;
  customJobs: CustomJobRow[];
  todayIso: string;
}): DashboardData {
  const customJobsById = new Map(
    input.customJobs.map((job) => [job.id, job]),
  );
  const settings = mapPaySettings(input.settings);
  const week: DashboardWeek = {
    id: input.week.id,
    startDate: input.week.start_date,
    endDate: input.week.end_date,
    status: input.week.status,
    displayWeekNumber: input.weekTotal.display_week_number,
    payPeriodRole: input.weekTotal.pay_period_role,
    paycheckDueDate: input.weekTotal.paycheck_due_date,
    runningBalanceCents: dollarsToCents(toNumber(input.weekTotal.running_balance)),
    totals: {
      dayCount: input.days.length,
      earningsCents: dollarsToCents(toNumber(input.weekTotal.earnings_total)),
      abilityPaycheckCents: dollarsToCents(
        toNumber(input.weekTotal.ability_paycheck_earnings),
      ),
      prestigePaycheckCents: dollarsToCents(
        toNumber(input.weekTotal.prestige_paycheck_earnings),
      ),
      wageHours: toNumber(input.weekTotal.wage_hours_total),
      spendCents: dollarsToCents(toNumber(input.weekTotal.spend_total)),
      baseCents: dollarsToCents(toNumber(input.weekTotal.base_total)),
      cashflowCents: dollarsToCents(toNumber(input.weekTotal.cashflow_total)),
      legacyRoundedCashflowCents: roundCentsToNearestTenDollars(
        dollarsToCents(toNumber(input.weekTotal.cashflow_total)),
      ),
    },
  };
  const slotsByDay = groupSlotsByDay(input.slots);
  const gasByTransactionId = new Map(
    input.gasAllocations.map((allocation) => [
      allocation.source_transaction_id,
      allocation,
    ]),
  );
  const evChargeByTransactionId = new Map(
    input.evChargeAllocations.map((allocation) => [
      allocation.source_transaction_id,
      allocation,
    ]),
  );
  const transactionsByDay = groupTransactionsByDay(
    input.transactions,
    gasByTransactionId,
    evChargeByTransactionId,
  );
  const totalsByDay = new Map(
    input.dayTotals.map((totals) => [totals.day_id, totals]),
  );
  const allocationsByDay = new Map<string, BaseAllocationRow[]>();
  for (const row of input.baseAllocations) {
    const list = allocationsByDay.get(row.day_id) ?? [];
    list.push(row);
    allocationsByDay.set(row.day_id, list);
  }
  const creditsByDay = new Map<string, AmortizationCreditRow[]>();
  for (const row of input.bucketCredits) {
    const list = creditsByDay.get(row.day_id) ?? [];
    list.push(row);
    creditsByDay.set(row.day_id, list);
  }
  const gasSpendByDay = new Map(
    input.gasSpread.map((row) => [
      row.day_id,
      Math.round(toNumber(row.gas_spend_cents)),
    ]),
  );
  const evChargeSpendByDay = new Map(
    input.evChargeSpread.map((row) => [
      row.day_id,
      Math.round(toNumber(row.ev_charge_spend_cents)),
    ]),
  );
  const days = input.days.map((day) =>
    mapDashboardDay(
      day,
      slotsByDay.get(day.id) ?? [],
      transactionsByDay.get(day.id) ?? [],
      totalsByDay.get(day.id),
      allocationsByDay.get(day.id) ?? [],
      creditsByDay.get(day.id) ?? [],
      gasSpendByDay.get(day.id) ?? 0,
      evChargeSpendByDay.get(day.id) ?? 0,
      customJobsById,
    ),
  );
  const gasAverage = calculateGasAverage(
    input.gasAllocations.map((allocation) => ({
      gasAmountCents: toNumber(allocation.gas_amount_cents),
      startDate: allocation.start_date,
      fillDate: allocation.fill_date,
    })),
    input.gasEndedOn ?? input.todayIso,
  );

  return {
    todayIso: input.todayIso,
    settings,
    week,
    weekNavigation: input.weekNavigation,
    days,
    gasAverageDailyCents: gasAverage?.dailyAverageCents ?? 0,
    gasEndedOn: input.gasEndedOn,
    hiddenBuiltins: (input.settings.hidden_builtin_jobs ?? []) as string[],
    customJobs: input.customJobs
      .filter((job) => job.active)
      .map((job) => ({
        id: job.id,
        name: job.name,
        color: job.color,
        regularRateCents: Math.round(toNumber(job.regular_rate_cents)),
        otRateCents: Math.round(toNumber(job.ot_rate_cents)),
      })),
    baselineTotals: {
      monthlyTotalCents: dollarsToCents(
        toNumber(input.baselineTotal?.monthly_total ?? 0),
      ),
      weeklyAverageCents: dollarsToCents(
        toNumber(input.baselineTotal?.weekly_average ?? 0),
      ),
      projectedDailyBaseCents: dollarsToCents(
        toNumber(input.baselineTotal?.projected_daily_base ?? 0),
      ),
    },
    metricMedians: {
      earningsCents: medianCents(
        input.closedWeekMetrics.map((row) => row.earnings_total),
      ),
      spendCents: medianCents(
        input.closedWeekMetrics.map((row) => row.spend_total),
      ),
      cashflowCents: medianCents(
        input.closedWeekMetrics.map((row) => row.cashflow_total),
      ),
    },
    abilityPayPeriod: input.adjacentAbilityPayPeriod,
    spendProjection: selectProjectionWindow(
      input.projectionWeeks,
      input.todayIso,
    ),
  };
}

async function loadAdjacentAbilityPayPeriod({
  supabase,
  week,
  weekTotal,
}: {
  supabase: Awaited<ReturnType<typeof requireUserWithBootstrapStatus>>["supabase"];
  week: WeekRow;
  weekTotal: WeekTotalRow;
}): Promise<AdjacentAbilityPayPeriod> {
  const adjacentStartDate = addDaysIso(
    week.start_date,
    weekTotal.pay_period_role === "week_1" ? 7 : -7,
  );
  const { data: adjacentWeekTotal, error: adjacentWeekError } = await supabase
    .from("v_week_totals")
    .select("week_id,ability_paycheck_earnings")
    .eq("start_date", adjacentStartDate)
    .maybeSingle();

  if (adjacentWeekError) {
    throw new Error(
      `Unable to load adjacent pay-period week: ${adjacentWeekError.message}`,
    );
  }

  const adjacentWeek = adjacentWeekTotal as
    | Pick<WeekTotalRow, "week_id" | "ability_paycheck_earnings">
    | null;

  if (!adjacentWeek) {
    return {
      adjacentWeekAbilityHours: 0,
      adjacentWeekAbilityRegularHours: 0,
      adjacentWeekAbilityOvertimeHours: 0,
      adjacentWeekAbilityPaycheckCents: 0,
      hasAdjacentWeek: false,
    };
  }

  const { data: adjacentDays, error: adjacentDaysError } = await supabase
    .from("days")
    .select("id")
    .eq("week_id", adjacentWeek.week_id);

  if (adjacentDaysError) {
    throw new Error(`Unable to load adjacent week days: ${adjacentDaysError.message}`);
  }

  const adjacentDayIds = ((adjacentDays ?? []) as Array<{ id: string }>).map(
    (day) => day.id,
  );
  const { data: adjacentSlots, error: adjacentSlotsError } =
    adjacentDayIds.length > 0
      ? await supabase
          .from("earn_slots")
          .select("job_type,pay_type,hours_or_units,regular_hours,overtime_hours,incentive_mode,incentive_rate,incentive_amount")
          .in("day_id", adjacentDayIds)
      : { data: [], error: null };

  if (adjacentSlotsError) {
    throw new Error(
      `Unable to load adjacent week earn slots: ${adjacentSlotsError.message}`,
    );
  }

  const adjacentAbilityHours = sumAbilityHours(
    (adjacentSlots ?? []) as AdjacentEarnSlotRow[],
  );

  return {
    adjacentWeekAbilityHours:
      adjacentAbilityHours.regularHours + adjacentAbilityHours.overtimeHours,
    adjacentWeekAbilityRegularHours: adjacentAbilityHours.regularHours,
    adjacentWeekAbilityOvertimeHours: adjacentAbilityHours.overtimeHours,
    adjacentWeekAbilityPaycheckCents: dollarsToCents(
      toNumber(adjacentWeek.ability_paycheck_earnings),
    ),
    hasAdjacentWeek: true,
  };
}

function medianCents(values: NumericValue[]): number {
  const cents = values
    .map((value) => dollarsToCents(toNumber(value)))
    .sort((left, right) => left - right);

  if (cents.length === 0) {
    return 0;
  }

  const middle = Math.floor(cents.length / 2);

  if (cents.length % 2 === 1) {
    return cents[middle];
  }

  return Math.round((cents[middle - 1] + cents[middle]) / 2);
}

function sumAbilityHours(slots: AdjacentEarnSlotRow[]): {
  regularHours: number;
  overtimeHours: number;
} {
  return slots.reduce(
    (total, slot) => {
    if (slot.job_type !== "ability" && slot.job_type !== "ability_incentive") {
      return total;
    }

      if (slot.pay_type === "split") {
        return {
          regularHours: total.regularHours + toNumber(slot.regular_hours),
          overtimeHours: total.overtimeHours + toNumber(slot.overtime_hours),
        };
      }

      if (slot.pay_type === "regular") {
        return {
          ...total,
          regularHours:
            total.regularHours +
            toNumber(slot.regular_hours ?? slot.hours_or_units),
        };
      }

      if (slot.pay_type === "overtime") {
        return {
          ...total,
          overtimeHours:
            total.overtimeHours +
            toNumber(slot.overtime_hours ?? slot.hours_or_units),
        };
      }

      return total;
    },
    { regularHours: 0, overtimeHours: 0 },
  );
}

function mapDashboardDay(
  day: DayRow,
  slots: EarnSlotRow[],
  transactions: DashboardTransaction[],
  totals: DayTotalRow | undefined,
  allocations: BaseAllocationRow[],
  credits: AmortizationCreditRow[],
  gasSpendCents: number,
  evChargeSpendCents: number,
  customJobsById: Map<string, CustomJobRow>,
): DashboardDay {
  const existingSlots = new Map(slots.map((slot) => [slot.slot_index, slot]));
  const spendCents = dollarsToCents(toNumber(day.manual_spend_adjustment));
  // Use the derived base from v_day_totals (amortization-aware, horizon-frozen)
  // so the displayed "Fixed" always matches the cashflow that subtracts it.
  // Pre-migration this equals day.base_amount; post-migration it's the derived
  // value within the freeze window.
  const baseCents = dollarsToCents(
    toNumber(totals?.base_amount ?? day.base_amount),
  );
  const transactionSpendCents = dollarsToCents(
    toNumber(totals?.transaction_spend_total ?? 0),
  );
  const cashflowCents = dollarsToCents(toNumber(totals?.cashflow_total ?? 0));

  return {
    id: day.id,
    weekId: day.week_id,
    date: day.date,
    dayIndex: day.day_index,
    label: formatDayLabel(day.date),
    baseCents,
    spendCents,
    transactionSpendCents,
    gasSpendCents,
    evChargeSpendCents,
    spendLocked: day.spend_locked,
    baseBreakdown: allocations
      .map((row) => ({
        itemKind: row.item_kind,
        itemId: row.item_id,
        itemName: row.item_name,
        originalAmountCents: Math.round(toNumber(row.original_amount_cents)),
        periodDays:
          row.period_days === null ? null : Math.round(toNumber(row.period_days)),
        dailyAllocCents: Math.round(toNumber(row.daily_alloc_cents)),
        appliedCents: Math.round(toNumber(row.applied_cents)),
        scheduleVersion: Math.round(toNumber(row.schedule_version)),
      }))
      .sort((a, b) => {
        if (a.itemKind !== b.itemKind) {
          return a.itemKind === "recurring" ? -1 : 1;
        }
        return a.itemName.localeCompare(b.itemName);
      }),
    totals: {
      earningsCents: dollarsToCents(toNumber(totals?.earnings_total ?? 0)),
      abilityPaycheckCents: dollarsToCents(
        toNumber(totals?.ability_paycheck_earnings ?? 0),
      ),
      prestigePaycheckCents: dollarsToCents(
        toNumber(totals?.prestige_paycheck_earnings ?? 0),
      ),
      wageHours: toNumber(totals?.wage_hours_total ?? 0),
      spendCents: totals
        ? dollarsToCents(toNumber(totals.spend_total))
        : spendCents + transactionSpendCents,
      baseCents,
      cashflowCents,
      legacyRoundedCashflowCents: roundCentsToNearestTenDollars(cashflowCents),
    },
    slots: [
      ...Array.from({ length: 4 }, (_, slotIndex): DashboardSlot => {
        const slot = existingSlots.get(slotIndex);
        const customJob =
          slot?.job_type === "custom" && slot.custom_job_id
            ? customJobsById.get(slot.custom_job_id)
            : undefined;

        return {
          id: slot?.id ?? null,
          dayId: day.id,
          slotIndex,
          jobType: slot?.job_type ?? "none",
          payType: slot?.pay_type ?? "none",
          hoursOrUnits: toNumber(slot?.hours_or_units ?? 0),
          regularHours: toNumber(slot?.regular_hours ?? 0),
          overtimeHours: toNumber(slot?.overtime_hours ?? 0),
          incentiveMode: mapIncentiveMode(slot?.incentive_mode ?? null),
          incentiveRate: toNumber(slot?.incentive_rate ?? 0),
          incentiveAmount: toNumber(slot?.incentive_amount ?? 0),
          label: slot?.label ?? "",
          source: slot?.source ?? "user",
          kind: "earn",
          reconciledNetCents:
            slot?.reconciled_net_cents == null
              ? null
              : Math.round(toNumber(slot.reconciled_net_cents)),
          customJobId: slot?.custom_job_id ?? null,
          customRegularRateCents: customJob
            ? Math.round(toNumber(customJob.regular_rate_cents))
            : undefined,
          customOvertimeRateCents: customJob
            ? Math.round(toNumber(customJob.ot_rate_cents))
            : undefined,
          customColor: customJob?.color,
          customName: customJob?.name,
        };
      }),
      // Synthetic READ-ONLY rows for Amortized Income daily credits. slotIndex >= 4
      // is a sentinel that never collides with real slots (0..3), so these never
      // consume a real slot or get treated as editable shifts.
      ...credits.map((credit, n): DashboardSlot => {
        const creditCents = Math.round(toNumber(credit.credit_cents));
        return {
          id: `bucket:${credit.bucket_id}`,
          dayId: day.id,
          slotIndex: 4 + n,
          jobType: "other",
          payType: "none",
          hoursOrUnits: creditCents / 100,
          regularHours: 0,
          overtimeHours: 0,
          incentiveMode: "none",
          incentiveRate: 0,
          incentiveAmount: 0,
          label: credit.bucket_name,
          source: "migration",
          kind: "bucket",
          bucketId: credit.bucket_id,
          creditCents,
        };
      }),
    ],
    appliedTransactions: transactions.filter(
      (transaction) => transaction.status === "applied",
    ),
    excludedTransactions: transactions.filter(
      (transaction) =>
        transaction.status === "excluded" && transaction.date === day.date,
    ),
  };
}

function mapIncentiveMode(value: string | null): IncentiveMode {
  if (value === "rate" || value === "lump_sum") {
    return value;
  }

  return "none";
}

function mapPaySettings(row: SettingsRow): PaySettings {
  return {
    abilityRegularNetRateCents: dollarsToCents(
      toNumber(row.ability_regular_net_rate),
    ),
    abilityOvertimeNetRateCents: dollarsToCents(toNumber(row.ability_ot_net_rate)),
    prestigeRegularNetRateCents: dollarsToCents(
      toNumber(row.prestige_regular_net_rate),
    ),
    prestigeOvertimeNetRateCents: dollarsToCents(
      toNumber(row.prestige_ot_net_rate),
    ),
    prestigeIlstRegularNetRateCents: dollarsToCents(
      toNumber(row.prestige_ilst_net_rate),
    ),
    prestigeIlstOvertimeNetRateCents: dollarsToCents(
      toNumber(row.prestige_ilst_ot_net_rate),
    ),
    abilityNetMultiplier: 1 - toNumber(row.ability_withholding_rate),
  };
}

function groupSlotsByDay(slots: EarnSlotRow[]) {
  const grouped = new Map<string, EarnSlotRow[]>();

  slots.forEach((slot) => {
    const rows = grouped.get(slot.day_id) ?? [];
    rows.push(slot);
    grouped.set(slot.day_id, rows);
  });

  return grouped;
}

function groupTransactionsByDay(
  transactions: TransactionRow[],
  gasByTransactionId: Map<string, GasAllocationRow>,
  evChargeByTransactionId: Map<string, EvChargeAllocationRow>,
) {
  const grouped = new Map<string, DashboardTransaction[]>();

  transactions.forEach((transaction) => {
    if (!transaction.day_id) {
      return;
    }

    const rows = grouped.get(transaction.day_id) ?? [];
    rows.push(
      mapDashboardTransaction(
        transaction,
        gasByTransactionId,
        evChargeByTransactionId,
      ),
    );
    grouped.set(transaction.day_id, rows);
  });

  grouped.forEach((rows, dayId) => {
    grouped.set(dayId, sortDashboardTransactions(rows));
  });

  return grouped;
}

function mapDashboardTransaction(
  row: TransactionRow,
  gasByTransactionId: Map<string, GasAllocationRow>,
  evChargeByTransactionId: Map<string, EvChargeAllocationRow>,
): DashboardTransaction {
  const originalAmountCents = dollarsToCents(toNumber(row.amount));
  const gasAllocation = gasByTransactionId.get(row.id);
  const hasActiveGasAllocation = gasAllocation?.is_active === true;
  const gasAllocatedCents =
    hasActiveGasAllocation
      ? Math.round(toNumber(gasAllocation.gas_amount_cents))
      : 0;
  const gasRemainderCents =
    hasActiveGasAllocation
      ? Math.round(toNumber(gasAllocation.remainder_amount_cents))
      : originalAmountCents;
  const evChargeAllocation = evChargeByTransactionId.get(row.id);
  const hasActiveEvChargeAllocation = evChargeAllocation?.is_active === true;
  const evChargeAllocatedCents = hasActiveEvChargeAllocation
    ? Math.round(toNumber(evChargeAllocation.charge_amount_cents))
    : 0;
  const evChargeRemainderCents = hasActiveEvChargeAllocation
    ? Math.round(toNumber(evChargeAllocation.remainder_amount_cents))
    : originalAmountCents;
  const amountCents = hasActiveGasAllocation
    ? gasRemainderCents
    : hasActiveEvChargeAllocation
      ? evChargeRemainderCents
      : originalAmountCents;
  return {
    id: row.id,
    dayId: row.day_id ?? "",
    merchantName: row.merchant_name,
    amountCents,
    originalAmountCents,
    category: row.category,
    source: row.source,
    status: row.status === "excluded" ? "excluded" : "applied",
    isAmortized: row.review_reason === "amortized_expense",
    isGasAllocated: hasActiveGasAllocation,
    gasAllocatedCents,
    gasRemainderCents,
    isEvChargeAllocated: hasActiveEvChargeAllocation,
    evChargeAllocatedCents,
    evChargeRemainderCents,
    wasMovedToYesterday: row.moved_to_yesterday === true,
    date: row.date,
    time: row.datetime ?? row.legacy_time,
    createdAt: row.created_at,
  };
}

function toNumber(value: NumericValue): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getExpectedDayDates(startDate: string) {
  return Array.from({ length: 7 }, (_, dayIndex) => addDaysIso(startDate, dayIndex));
}
