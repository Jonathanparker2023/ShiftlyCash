import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { formatDayLabel } from "@/lib/dashboard/dates";
import { sortChronologicalTransactions } from "@/lib/dashboard/transactions";
import { dollarsToCents } from "@/lib/domain/money";
import {
  calculateEarnSlot,
  type JobType,
  type PaySettings,
  type PayType,
} from "@/lib/domain/pay";
import type {
  HistoryData,
  HistoryDetailData,
  HistoryDetailDay,
  HistoryDetailSlot,
  HistoryDetailTransaction,
  HistoryWeek,
  SnapshotSummary,
} from "@/lib/history/types";

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

type WeekTotalRow = {
  week_id: string;
  start_date: string;
  end_date: string;
  display_week_number: number;
  status: "active" | "closed";
  archived_at: string | null;
  earnings_total: NumericValue;
  spend_total: NumericValue;
  base_total: NumericValue;
  cashflow_total: NumericValue;
  running_balance: NumericValue;
};

type ProjectionExclusionRow = {
  week_id: string;
  exclude_earnings: boolean;
  exclude_spend: boolean;
  exclude_cashflow: boolean;
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

type DayTotalRow = {
  day_id: string;
  transaction_spend_total: NumericValue;
  earnings_total: NumericValue;
  spend_total: NumericValue;
  cashflow_total: NumericValue;
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
  label: string | null;
  source: string;
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
  source: string;
  status: string;
  category: string | null;
};

type SnapshotRow = {
  id: string;
  snapshot_type: string;
  created_at: string;
  payload: JsonValue;
};

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export async function getHistoryData(): Promise<HistoryData> {
  const { supabase, user } = await requireUserWithBootstrapStatus();
  const { data: weekData, error: weekError } = await supabase
    .from("v_week_totals")
    .select(
      "week_id,start_date,end_date,display_week_number,status,archived_at,earnings_total,spend_total,base_total,cashflow_total,running_balance",
    )
    .eq("user_id", user.id)
    .eq("status", "closed")
    .order("start_date", { ascending: false });

  if (weekError) {
    throw new Error(`Unable to load history: ${weekError.message}`);
  }

  const weeks = (weekData ?? []) as WeekTotalRow[];
  const weekIds = weeks.map((week) => week.week_id);
  const exclusionsByWeek = await loadProjectionExclusions(weekIds);

  return {
    weeks: weeks.map((week) => mapHistoryWeek(week, exclusionsByWeek.get(week.week_id))),
  };

  async function loadProjectionExclusions(weekIdsToLoad: string[]) {
    if (weekIdsToLoad.length === 0) {
      return new Map<string, ProjectionExclusionRow>();
    }

    const { data, error } = await supabase
      .from("week_projection_exclusions")
      .select("week_id,exclude_earnings,exclude_spend,exclude_cashflow")
      .eq("user_id", user.id)
      .in("week_id", weekIdsToLoad);

    if (error) {
      throw new Error(`Unable to load projection exclusions: ${error.message}`);
    }

    return new Map(
      ((data ?? []) as ProjectionExclusionRow[]).map((row) => [row.week_id, row]),
    );
  }
}

export async function getHistoryDetailData(
  weekId: string,
): Promise<HistoryDetailData | null> {
  const { supabase, user } = await requireUserWithBootstrapStatus();
  const [
    { data: settingsData, error: settingsError },
    { data: weekData, error: weekError },
    { data: exclusionData, error: exclusionError },
    { data: dayData, error: dayError },
    { data: dayTotalData, error: dayTotalError },
    { data: snapshotData, error: snapshotError },
  ] = await Promise.all([
    supabase
      .from("settings")
      .select(
        "ability_regular_net_rate, ability_ot_net_rate, prestige_regular_net_rate, prestige_ot_net_rate, prestige_ilst_net_rate, prestige_ilst_ot_net_rate, ability_withholding_rate",
      )
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("v_week_totals")
      .select(
        "week_id,start_date,end_date,display_week_number,status,archived_at,earnings_total,spend_total,base_total,cashflow_total,running_balance",
      )
      .eq("user_id", user.id)
      .eq("week_id", weekId)
      .maybeSingle(),
    supabase
      .from("week_projection_exclusions")
      .select("week_id,exclude_earnings,exclude_spend,exclude_cashflow")
      .eq("user_id", user.id)
      .eq("week_id", weekId)
      .maybeSingle(),
    supabase
      .from("days")
      .select(
        "id,week_id,date,day_index,base_amount,manual_spend_adjustment,spend_locked",
      )
      .eq("user_id", user.id)
      .eq("week_id", weekId)
      .order("day_index", { ascending: true }),
    supabase
      .from("v_day_totals")
      .select(
        "day_id,transaction_spend_total,earnings_total,spend_total,cashflow_total",
      )
      .eq("user_id", user.id)
      .eq("week_id", weekId),
    supabase
      .from("state_snapshots")
      .select("id,snapshot_type,created_at,payload")
      .eq("user_id", user.id)
      .eq("week_id", weekId)
      .order("created_at", { ascending: false }),
  ]);

  if (settingsError) {
    throw new Error(`Unable to load pay settings: ${settingsError.message}`);
  }
  if (weekError) {
    throw new Error(`Unable to load history week: ${weekError.message}`);
  }
  if (exclusionError) {
    throw new Error(`Unable to load projection exclusions: ${exclusionError.message}`);
  }
  if (dayError) {
    throw new Error(`Unable to load history days: ${dayError.message}`);
  }
  if (dayTotalError) {
    throw new Error(`Unable to load day totals: ${dayTotalError.message}`);
  }
  if (snapshotError) {
    throw new Error(`Unable to load snapshots: ${snapshotError.message}`);
  }

  if (!weekData) {
    return null;
  }

  const days = (dayData ?? []) as DayRow[];
  const dayIds = days.map((day) => day.id);
  const settings = mapPaySettings(settingsData as SettingsRow);
  const [slotRows, transactionRows] = await Promise.all([
    loadEarnSlots(dayIds),
    loadTransactions(dayIds),
  ]);
  const totalsByDay = new Map(
    ((dayTotalData ?? []) as DayTotalRow[]).map((row) => [row.day_id, row]),
  );

  return {
    week: mapHistoryWeek(
      weekData as WeekTotalRow,
      (exclusionData as ProjectionExclusionRow | null) ?? undefined,
    ),
    days: days.map((day) =>
      mapHistoryDetailDay(
        day,
        totalsByDay.get(day.id),
        slotRows.filter((slot) => slot.day_id === day.id),
        transactionRows.filter((transaction) => transaction.day_id === day.id),
        settings,
      ),
    ),
    snapshots: ((snapshotData ?? []) as SnapshotRow[]).map(mapSnapshotSummary),
  };

  async function loadEarnSlots(dayIdsToLoad: string[]) {
    if (dayIdsToLoad.length === 0) {
      return [] as EarnSlotRow[];
    }

    const { data, error } = await supabase
      .from("earn_slots")
      .select(
        "id,day_id,slot_index,job_type,pay_type,hours_or_units,regular_hours,overtime_hours,label,source",
      )
      .eq("user_id", user.id)
      .in("day_id", dayIdsToLoad)
      .order("slot_index", { ascending: true });

    if (error) {
      throw new Error(`Unable to load earn slots: ${error.message}`);
    }

    return (data ?? []) as EarnSlotRow[];
  }

  async function loadTransactions(dayIdsToLoad: string[]) {
    if (dayIdsToLoad.length === 0) {
      return [] as TransactionRow[];
    }

    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id,day_id,date,datetime,legacy_time,created_at,merchant_name,amount,source,status,category",
      )
      .eq("user_id", user.id)
      .in("day_id", dayIdsToLoad)
      .order("date", { ascending: true })
      .order("datetime", { ascending: true, nullsFirst: false })
      .order("legacy_time", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Unable to load transactions: ${error.message}`);
    }

    return (data ?? []) as TransactionRow[];
  }
}

function mapHistoryWeek(
  week: WeekTotalRow,
  exclusions: ProjectionExclusionRow | undefined,
): HistoryWeek {
  return {
    id: week.week_id,
    startDate: week.start_date,
    endDate: week.end_date,
    displayWeekNumber: week.display_week_number,
    status: week.status,
    archivedAt: week.archived_at,
    earningsCents: dollarsToCents(toNumber(week.earnings_total)),
    spendCents: dollarsToCents(toNumber(week.spend_total)),
    baseCents: dollarsToCents(toNumber(week.base_total)),
    cashflowCents: dollarsToCents(toNumber(week.cashflow_total)),
    runningBalanceCents: dollarsToCents(toNumber(week.running_balance)),
    exclusions: {
      earnings: exclusions?.exclude_earnings ?? false,
      spend: exclusions?.exclude_spend ?? false,
      cashflow: exclusions?.exclude_cashflow ?? false,
    },
  };
}

function toNumber(value: NumericValue): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapHistoryDetailDay(
  day: DayRow,
  totals: DayTotalRow | undefined,
  slots: EarnSlotRow[],
  transactions: TransactionRow[],
  settings: PaySettings,
): HistoryDetailDay {
  return {
    id: day.id,
    date: day.date,
    dayIndex: day.day_index,
    label: formatDayLabel(day.date),
    spendLocked: day.spend_locked,
    baseCents: dollarsToCents(toNumber(day.base_amount)),
    manualSpendCents: dollarsToCents(toNumber(day.manual_spend_adjustment)),
    transactionSpendCents: dollarsToCents(
      toNumber(totals?.transaction_spend_total ?? 0),
    ),
    earningsCents: dollarsToCents(toNumber(totals?.earnings_total ?? 0)),
    spendCents: dollarsToCents(toNumber(totals?.spend_total ?? 0)),
    cashflowCents: dollarsToCents(toNumber(totals?.cashflow_total ?? 0)),
    slots: slots.map((slot) => mapHistoryDetailSlot(slot, settings)),
    transactions: sortChronologicalTransactions(
      transactions.map(mapHistoryDetailTransaction),
    ),
  };
}

function mapHistoryDetailSlot(
  row: EarnSlotRow,
  settings: PaySettings,
): HistoryDetailSlot {
  const slot = {
    jobType: row.job_type,
    payType: row.pay_type,
    hoursOrUnits: toNumber(row.hours_or_units),
    regularHours: toNumber(row.regular_hours),
    overtimeHours: toNumber(row.overtime_hours),
    label: row.label ?? "",
  };

  return {
    id: row.id,
    slotIndex: row.slot_index,
    ...slot,
    computedEarningsCents: calculateEarnSlot(slot, settings).earningsCents,
    source: row.source,
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

function mapHistoryDetailTransaction(
  row: TransactionRow,
): HistoryDetailTransaction {
  return {
    id: row.id,
    date: row.date,
    time: row.datetime ?? row.legacy_time,
    createdAt: row.created_at,
    merchantName: row.merchant_name,
    amountCents: dollarsToCents(toNumber(row.amount)),
    source: row.source,
    status: row.status,
    category: row.category,
  };
}

function mapSnapshotSummary(row: SnapshotRow): SnapshotSummary {
  return {
    id: row.id,
    snapshotType: row.snapshot_type,
    createdAt: row.created_at,
    dayCount: countSnapshotDays(row.payload),
    earnSlotCount: countSnapshotEarnSlots(row.payload),
    transactionCount: countSnapshotTransactions(row.payload),
    payloadJson: JSON.stringify(row.payload, null, 2),
  };
}

function countSnapshotDays(payload: JsonValue): number {
  return getSnapshotWeekPayloads(payload).reduce(
    (count, weekPayload) => count + getArrayProperty(weekPayload, "days").length,
    0,
  );
}

function countSnapshotEarnSlots(payload: JsonValue): number {
  return getSnapshotWeekPayloads(payload).reduce(
    (count, weekPayload) =>
      count +
      getArrayProperty(weekPayload, "days").reduce<number>(
        (slotCount, dayPayload) =>
          slotCount + getArrayProperty(dayPayload, "earn_slots").length,
        0,
      ),
    0,
  );
}

function countSnapshotTransactions(payload: JsonValue): number {
  return getSnapshotWeekPayloads(payload).reduce(
    (count, weekPayload) =>
      count +
      getArrayProperty(weekPayload, "days").reduce<number>(
        (transactionCount, dayPayload) =>
          transactionCount + getArrayProperty(dayPayload, "transactions").length,
        0,
      ) +
      getArrayProperty(weekPayload, "unassigned_transactions").length,
    0,
  );
}

function getSnapshotWeekPayloads(payload: JsonValue): JsonObject[] {
  if (!isJsonObject(payload)) {
    return [];
  }

  const nestedPayloads = ["closed_week", "active_week", "discarded_active_week", "reopened_week"]
    .map((key) => payload[key])
    .filter(isJsonObject);

  return nestedPayloads.length > 0 ? nestedPayloads : [payload];
}

type JsonObject = { [key: string]: JsonValue };

function getArrayProperty(payload: JsonValue, key: string): JsonValue[] {
  if (!isJsonObject(payload)) {
    return [];
  }

  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
