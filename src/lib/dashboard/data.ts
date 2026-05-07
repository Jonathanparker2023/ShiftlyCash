import { requireUserWithBootstrapStatus } from "@/lib/auth";
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

export async function getDashboardData(): Promise<DashboardData> {
  const { supabase } = await requireUserWithBootstrapStatus();
  const startDate = getSundayOnOrBeforeTodayIso();
  const todayIso = getTodayIso();

  const { data: weekId, error: ensureError } = await supabase.rpc(
    "ensure_current_active_week",
    { p_start_date: startDate },
  );

  if (ensureError) {
    throw new Error(`Unable to ensure active week: ${ensureError.message}`);
  }

  if (typeof weekId !== "string") {
    throw new Error("Active week RPC did not return a week id.");
  }

  // Clear any future-day projections that have rolled into today (or past),
  // and apply projections to remaining future days. Both use the user's local
  // date so timezone drift doesn't cause off-by-one errors.
  await supabase.rpc("cleanup_expired_projections", { p_today: todayIso });
  await supabase.rpc("apply_future_day_projection", {
    p_week_id: weekId,
    p_today: todayIso,
  });

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
        "ability_regular_net_rate, ability_ot_net_rate, prestige_regular_net_rate, prestige_ot_net_rate, ability_withholding_rate",
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

  if (slotError) {
    throw new Error(`Unable to load earn slots: ${slotError.message}`);
  }
  if (transactionError) {
    throw new Error(`Unable to load transactions: ${transactionError.message}`);
  }

  return mapDashboardData({
    settings: settingsData as SettingsRow,
    week: weekData as WeekRow,
    days,
    dayTotals: (dayTotalData ?? []) as DayTotalRow[],
    slots: (slotData ?? []) as EarnSlotRow[],
    transactions: (transactionData ?? []) as TransactionRow[],
    weekTotal: weekTotalData as WeekTotalRow,
    baselineTotal: baselineTotalData as BaselineTotalRow | null,
    closedWeekMetrics: (closedWeekMetricData ?? []) as ClosedWeekMetricRow[],
    todayIso: getTodayIso(),
  });
}

function mapDashboardData(input: {
  settings: SettingsRow;
  week: WeekRow;
  days: DayRow[];
  dayTotals: DayTotalRow[];
  slots: EarnSlotRow[];
  transactions: TransactionRow[];
  weekTotal: WeekTotalRow;
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
