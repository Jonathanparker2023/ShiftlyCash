import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { mark, since, timed } from "@/lib/perf";
import {
  addDaysIso,
  formatDayLabel,
  getSundayOnOrBeforeTodayIso,
  getTodayIso,
} from "@/lib/dashboard/dates";
import type {
  DashboardData,
  DashboardDay,
  DashboardTransaction,
  DashboardTransactionSource,
  DashboardTransactionStatus,
  EarnSlotSource,
  DashboardWeek,
} from "@/lib/dashboard/types";
import { sortDashboardTransactions } from "@/lib/dashboard/transactions";
import {
  dollarsToCents,
  roundCentsToNearestTenDollars,
} from "@/lib/domain/money";
import type { JobType, PaySettings, PayType } from "@/lib/domain/pay";

type NumericValue = number | string | null;

type SettingsRow = {
  ability_regular_net_rate: NumericValue;
  ability_ot_net_rate: NumericValue;
  prestige_regular_net_rate: NumericValue;
  prestige_ot_net_rate: NumericValue;
  prestige_ilst_net_rate: NumericValue;
  prestige_ilst_ot_net_rate: NumericValue;
  ability_withholding_rate: NumericValue;
};

type WeekRow = {
  id: string;
  start_date: string;
  end_date: string;
};

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
  label: string | null;
  source: EarnSlotSource;
};

type AdjacentEarnSlotRow = {
  job_type: JobType;
  pay_type: PayType;
  hours_or_units: NumericValue;
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

type AdjacentAbilityPayPeriod = {
  adjacentWeekAbilityHours: number;
  adjacentWeekAbilityRegularHours: number;
  adjacentWeekAbilityOvertimeHours: number;
  adjacentWeekAbilityPaycheckCents: number;
  hasAdjacentWeek: boolean;
};

export async function getDashboardData(): Promise<DashboardData> {
  const tTotal = mark();
  const { supabase } = await timed("dashboard:auth", () =>
    requireUserWithBootstrapStatus(),
  );
  const startDate = getSundayOnOrBeforeTodayIso();

  const { data: weekId, error: ensureError } = await timed(
    "dashboard:ensureWeek",
    () =>
      supabase.rpc("ensure_current_active_week", { p_start_date: startDate }),
  );

  if (ensureError) {
    throw new Error(`Unable to ensure active week: ${ensureError.message}`);
  }

  if (typeof weekId !== "string") {
    throw new Error("Active week RPC did not return a week id.");
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
  ] = await Promise.all([
    supabase
      .from("settings")
      .select(
        "ability_regular_net_rate, ability_ot_net_rate, prestige_regular_net_rate, prestige_ot_net_rate, prestige_ilst_net_rate, prestige_ilst_ot_net_rate, ability_withholding_rate",
      )
      .single(),
    supabase
      .from("weeks")
      .select("id,start_date,end_date")
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
              "id,day_id,slot_index,job_type,pay_type,hours_or_units,label,source",
            )
            .in("day_id", dayIds)
            .order("slot_index", { ascending: true }),
          supabase
            .from("transactions")
            .select(
              "id,day_id,date,datetime,legacy_time,created_at,merchant_name,amount,category,source,status",
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

  const adjacentAbilityPayPeriod = await loadAdjacentAbilityPayPeriod({
    supabase,
    week: weekData as WeekRow,
    weekTotal: weekTotalData as WeekTotalRow,
  });

  const result = mapDashboardData({
    settings: settingsData as SettingsRow,
    week: weekData as WeekRow,
    days,
    dayTotals: (dayTotalData ?? []) as DayTotalRow[],
    slots: (slotData ?? []) as EarnSlotRow[],
    transactions: (transactionData ?? []) as TransactionRow[],
    weekTotal: weekTotalData as WeekTotalRow,
    adjacentAbilityPayPeriod,
    baselineTotal: baselineTotalData as BaselineTotalRow | null,
    closedWeekMetrics: (closedWeekMetricData ?? []) as ClosedWeekMetricRow[],
    todayIso: getTodayIso(),
  });
  since("dashboard:total", tTotal);
  return result;
}

function mapDashboardData(input: {
  settings: SettingsRow;
  week: WeekRow;
  days: DayRow[];
  dayTotals: DayTotalRow[];
  slots: EarnSlotRow[];
  transactions: TransactionRow[];
  weekTotal: WeekTotalRow;
  adjacentAbilityPayPeriod: AdjacentAbilityPayPeriod;
  baselineTotal: BaselineTotalRow | null;
  closedWeekMetrics: ClosedWeekMetricRow[];
  todayIso: string;
}): DashboardData {
  const settings = mapPaySettings(input.settings);
  const week: DashboardWeek = {
    id: input.week.id,
    startDate: input.week.start_date,
    endDate: input.week.end_date,
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
  const transactionsByDay = groupTransactionsByDay(input.transactions);
  const totalsByDay = new Map(
    input.dayTotals.map((totals) => [totals.day_id, totals]),
  );
  const days = input.days.map((day) =>
    mapDashboardDay(
      day,
      slotsByDay.get(day.id) ?? [],
      transactionsByDay.get(day.id) ?? [],
      totalsByDay.get(day.id),
    ),
  );

  return {
    todayIso: input.todayIso,
    settings,
    week,
    days,
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
    spendProjection: deriveSpendProjection(input.closedWeekMetrics),
  };
}

function deriveSpendProjection(
  closedWeekMetrics: ClosedWeekMetricRow[],
): { previousWeekSpendCents: number; projectedDailySpendCents: number } {
  // closedWeekMetrics is ordered by start_date ASC, so the last entry is the
  // most recent closed week. If there is no closed week yet, the projection is
  // zero — UI will simply not render the placeholder.
  if (closedWeekMetrics.length === 0) {
    return { previousWeekSpendCents: 0, projectedDailySpendCents: 0 };
  }

  const previous = closedWeekMetrics[closedWeekMetrics.length - 1];
  const previousWeekSpendCents = dollarsToCents(toNumber(previous.spend_total));
  const projectedDailySpendCents = Math.round(previousWeekSpendCents / 7);

  return { previousWeekSpendCents, projectedDailySpendCents };
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
          .select("job_type,pay_type,hours_or_units")
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
    if (slot.job_type !== "ability") {
      return total;
    }

      if (slot.pay_type === "regular") {
        return {
          ...total,
          regularHours: total.regularHours + toNumber(slot.hours_or_units),
        };
      }

      if (slot.pay_type === "overtime") {
        return {
          ...total,
          overtimeHours: total.overtimeHours + toNumber(slot.hours_or_units),
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
): DashboardDay {
  const existingSlots = new Map(slots.map((slot) => [slot.slot_index, slot]));
  const spendCents = dollarsToCents(toNumber(day.manual_spend_adjustment));
  const baseCents = dollarsToCents(toNumber(day.base_amount));
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
    spendLocked: day.spend_locked,
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
    slots: Array.from({ length: 4 }, (_, slotIndex) => {
      const slot = existingSlots.get(slotIndex);

      return {
        id: slot?.id ?? null,
        dayId: day.id,
        slotIndex,
        jobType: slot?.job_type ?? "none",
        payType: slot?.pay_type ?? "none",
        hoursOrUnits: toNumber(slot?.hours_or_units ?? 0),
        label: slot?.label ?? "",
        source: slot?.source ?? "user",
      };
    }),
    appliedTransactions: transactions.filter(
      (transaction) => transaction.status === "applied",
    ),
    excludedTransactions: transactions.filter(
      (transaction) =>
        transaction.status === "excluded" && transaction.date === day.date,
    ),
  };
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

function groupTransactionsByDay(transactions: TransactionRow[]) {
  const grouped = new Map<string, DashboardTransaction[]>();

  transactions.forEach((transaction) => {
    if (!transaction.day_id) {
      return;
    }

    const rows = grouped.get(transaction.day_id) ?? [];
    rows.push(mapDashboardTransaction(transaction));
    grouped.set(transaction.day_id, rows);
  });

  grouped.forEach((rows, dayId) => {
    grouped.set(dayId, sortDashboardTransactions(rows));
  });

  return grouped;
}

function mapDashboardTransaction(row: TransactionRow): DashboardTransaction {
  return {
    id: row.id,
    dayId: row.day_id ?? "",
    merchantName: row.merchant_name,
    amountCents: dollarsToCents(toNumber(row.amount)),
    category: row.category,
    source: row.source,
    status: row.status === "excluded" ? "excluded" : "applied",
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
