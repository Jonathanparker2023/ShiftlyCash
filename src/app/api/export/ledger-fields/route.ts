import { NextResponse } from "next/server";

import { addDaysIso, getTodayIso } from "@/lib/dashboard/dates";
import { centsToDollars, dollarsToCents } from "@/lib/domain/money";
import { createAdminClient } from "@/lib/supabase/admin";

type NumericValue = number | string | null;

type DebtRow = {
  id: string;
  name: string;
  balance: NumericValue;
  minimum_payment: NumericValue;
  apr: NumericValue;
  status: "active" | "paid";
};

type AssetRow = {
  id: string;
  name: string;
  value: NumericValue;
  category: string;
};

type WeekTotalRow = {
  week_id: string;
  start_date: string;
  end_date: string;
  status: string;
  pay_period_role: "week_1" | "week_2";
  paycheck_due_date: string | null;
  earnings_total: NumericValue;
  ability_paycheck_earnings: NumericValue;
  prestige_paycheck_earnings: NumericValue;
  spend_total: NumericValue;
  base_total: NumericValue;
  cashflow_total: NumericValue;
};

type DayTotalRow = {
  date: string;
  earnings_total: NumericValue;
  spend_total: NumericValue;
  base_amount: NumericValue;
  cashflow_total: NumericValue;
};

type DayRow = {
  id: string;
  date: string;
};

type EarnSlotRow = {
  day_id: string;
  job_type:
    | "ability"
    | "prestige"
    | "prestige_ilst"
    | "incentive"
    | "other"
    | "none";
  pay_type: "regular" | "overtime" | "split" | "unit" | "none";
  hours_or_units: NumericValue;
  regular_hours: NumericValue;
  overtime_hours: NumericValue;
};

type SettingsRow = {
  prestige_regular_net_rate: NumericValue;
  prestige_ot_net_rate: NumericValue;
  prestige_ilst_net_rate: NumericValue;
  prestige_ilst_ot_net_rate: NumericValue;
};

type TransactionRow = {
  date: string;
  amount: NumericValue;
  category: string | null;
  status: string;
};

const LEDGER_TOKEN_ENV = "SHIFTLYCASH_LEDGER_TOKEN";
const LEDGER_USER_ID_ENV = "SHIFTLYCASH_LEDGER_USER_ID";
const ABILITY_REGULAR_GROSS_RATE = 19.055;
const ABILITY_OVERTIME_GROSS_RATE = 28.5825;
const PRESTIGE_WITHHOLDING_RATE = 0.14;
const DEFAULT_PRESTIGE_REGULAR_NET_RATE = 14.62;
const DEFAULT_PRESTIGE_OVERTIME_NET_RATE = 21.93;
const DEFAULT_PRESTIGE_ILST_REGULAR_NET_RATE = 15.48;
const DEFAULT_PRESTIGE_ILST_OVERTIME_NET_RATE = 23.22;

export async function GET(request: Request) {
  const authResult = authorizeLedgerRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const supabase = createAdminClient();
    const userId = await resolveLedgerUserId(supabase);
    const asOf = new Date();
    const asOfIso = asOf.toISOString();
    const todayIso = getTodayIso();
    const weekOf = mondayOnOrBeforeIso(todayIso);
    const rolling30StartIso = addDaysIso(todayIso, -29);
    const yearStartIso = `${todayIso.slice(0, 4)}-01-01`;
    const [debtsRes, assetsRes, weeksRes, dayTotalsRes, daysRes, settingsRes, transactionsRes] =
      await Promise.all([
      supabase
        .from("debts")
        .select("id,name,balance,minimum_payment,apr,status")
        .eq("user_id", userId)
        .eq("status", "active")
        .gt("balance", 0)
        .order("priority_order", { ascending: true }),
      supabase
        .from("assets")
        .select("id,name,value,category")
        .eq("user_id", userId)
        .order("name", { ascending: true }),
      supabase
        .from("v_week_totals")
        .select(
          "week_id,start_date,end_date,status,pay_period_role,paycheck_due_date,earnings_total,ability_paycheck_earnings,prestige_paycheck_earnings,spend_total,base_total,cashflow_total",
        )
        .eq("user_id", userId)
        .order("start_date", { ascending: true }),
      supabase
        .from("v_day_totals")
        .select("date,earnings_total,spend_total,base_amount,cashflow_total")
        .eq("user_id", userId)
        .gte("date", yearStartIso)
        .lte("date", todayIso)
        .order("date", { ascending: true }),
      supabase
        .from("days")
        .select("id,date")
        .eq("user_id", userId)
        .gte("date", yearStartIso)
        .lte("date", todayIso)
        .order("date", { ascending: true }),
      supabase
        .from("settings")
        .select(
          "prestige_regular_net_rate,prestige_ot_net_rate,prestige_ilst_net_rate,prestige_ilst_ot_net_rate",
        )
        .eq("user_id", userId)
        .single(),
      supabase
        .from("transactions")
        .select("date,amount,category,status")
        .eq("user_id", userId)
        .gte("date", yearStartIso)
        .lte("date", todayIso)
        .order("date", { ascending: true }),
    ]);

    if (debtsRes.error) throw new Error(`Debts: ${debtsRes.error.message}`);
    if (assetsRes.error) throw new Error(`Assets: ${assetsRes.error.message}`);
    if (weeksRes.error) throw new Error(`Weeks: ${weeksRes.error.message}`);
    if (dayTotalsRes.error) throw new Error(`Day totals: ${dayTotalsRes.error.message}`);
    if (daysRes.error) throw new Error(`Days: ${daysRes.error.message}`);
    if (settingsRes.error) throw new Error(`Settings: ${settingsRes.error.message}`);
    if (transactionsRes.error) {
      throw new Error(`Transactions: ${transactionsRes.error.message}`);
    }

    const weeks = (weeksRes.data ?? []) as WeekTotalRow[];
    const dayTotals = (dayTotalsRes.data ?? []) as DayTotalRow[];
    const days = (daysRes.data ?? []) as DayRow[];
    const dayIds = days.map((day) => day.id);
    const slotsRes =
      dayIds.length > 0
        ? await supabase
            .from("earn_slots")
            .select("day_id,job_type,pay_type,hours_or_units,regular_hours,overtime_hours")
            .in("day_id", dayIds)
        : { data: [], error: null };

    if (slotsRes.error) throw new Error(`Earn slots: ${slotsRes.error.message}`);

    const slots = (slotsRes.data ?? []) as EarnSlotRow[];
    const settings = settingsRes.data as SettingsRow;
    const activeWeek =
      weeks.find((week) => week.status === "active") ?? weeks.at(-1) ?? null;
    const thisWeekStartIso = activeWeek?.start_date ?? weekOf;
    const thisWeekEndIso = activeWeek?.end_date ?? addDaysIso(thisWeekStartIso, 6);
    const payPeriodStartIso =
      activeWeek?.pay_period_role === "week_2"
        ? addDaysIso(activeWeek.start_date, -7)
        : activeWeek?.start_date ?? weekOf;
    const payPeriodEndIso = addDaysIso(payPeriodStartIso, 13);
    const currentPayPeriodWeeks = weeks.filter(
      (week) =>
        week.start_date >= payPeriodStartIso && week.start_date <= payPeriodEndIso,
    );
    const activeCashflowCents = dollarsToCents(
      toNumber(activeWeek?.cashflow_total ?? 0),
    );
    const activePayPeriodCashflowCents = currentPayPeriodWeeks.reduce(
      (sum, week) => sum + dollarsToCents(toNumber(week.cashflow_total)),
      0,
    );
    const ytdDeployableCents = weeks.reduce(
      (sum, week) => sum + dollarsToCents(toNumber(week.cashflow_total)),
      0,
    );
    const closedCashflowCents = weeks
      .filter((week) => week.status === "closed")
      .map((week) => dollarsToCents(toNumber(week.cashflow_total)));
    const targetWeeklyDeployableCents =
      closedCashflowCents.length > 0
        ? Math.round(
            closedCashflowCents.reduce((sum, value) => sum + value, 0) /
              closedCashflowCents.length,
          )
        : activeCashflowCents;
    const income = buildIncome({
      weeks,
      dayTotals,
      days,
      slots,
      settings,
      thisWeekStartIso,
      thisWeekEndIso,
      payPeriodStartIso,
      payPeriodEndIso,
      rolling30StartIso,
      todayIso,
      currentPayPeriodWeeks,
    });
    const spending = buildSpending({
      dayTotals,
      weeks,
      transactions: (transactionsRes.data ?? []) as TransactionRow[],
      thisWeekStartIso,
      thisWeekEndIso,
      payPeriodStartIso,
      payPeriodEndIso,
      rolling30StartIso,
      todayIso,
    });
    const baseline = buildBaseline({
      dayTotals,
      weeks,
      thisWeekStartIso,
      thisWeekEndIso,
      payPeriodStartIso,
      payPeriodEndIso,
      rolling30StartIso,
      todayIso,
    });

    return NextResponse.json({
      as_of: asOfIso,
      week_of: weekOf,
      debts: ((debtsRes.data ?? []) as DebtRow[]).map(mapDebt),
      accounts: mapAccounts((assetsRes.data ?? []) as AssetRow[]),
      cashflow: {
        week_start: activeWeek?.start_date ?? weekOf,
        actual_deployable_this_week: money(activeCashflowCents),
        target_weekly_deployable: money(targetWeeklyDeployableCents),
        current_pay_period_total: money(activePayPeriodCashflowCents),
        ytd_deployable_actual: money(ytdDeployableCents),
      },
      income,
      spending,
      baseline,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ledger export failed." },
      { status: 500 },
    );
  }
}

function buildIncome({
  weeks,
  dayTotals,
  days,
  slots,
  settings,
  thisWeekStartIso,
  thisWeekEndIso,
  payPeriodStartIso,
  payPeriodEndIso,
  rolling30StartIso,
  todayIso,
  currentPayPeriodWeeks,
}: {
  weeks: WeekTotalRow[];
  dayTotals: DayTotalRow[];
  days: DayRow[];
  slots: EarnSlotRow[];
  settings: SettingsRow;
  thisWeekStartIso: string;
  thisWeekEndIso: string;
  payPeriodStartIso: string;
  payPeriodEndIso: string;
  rolling30StartIso: string;
  todayIso: string;
  currentPayPeriodWeeks: WeekTotalRow[];
}) {
  const thisWeekNetCents = sumDayMoney(
    dayTotals,
    "earnings_total",
    thisWeekStartIso,
    thisWeekEndIso,
  );
  const payPeriodNetCents = sumDayMoney(
    dayTotals,
    "earnings_total",
    payPeriodStartIso,
    payPeriodEndIso,
  );
  const rolling30NetCents = sumDayMoney(
    dayTotals,
    "earnings_total",
    rolling30StartIso,
    todayIso,
  );
  const ytdNetCents = sumDayMoney(dayTotals, "earnings_total");
  const ytdNetRollupCents = weeks.reduce(
    (sum, week) => sum + dollarsToCents(toNumber(week.earnings_total)),
    0,
  );
  const currentPayPeriodNetCents = currentPayPeriodWeeks.reduce(
    (sum, week) => sum + dollarsToCents(toNumber(week.earnings_total)),
    0,
  );
  const paycheckDueDate =
    currentPayPeriodWeeks.find((week) => week.pay_period_role === "week_2")
      ?.paycheck_due_date ??
    currentPayPeriodWeeks.at(-1)?.paycheck_due_date ??
    payPeriodEndIso;

  return {
    this_week_net: money(thisWeekNetCents),
    this_week_gross: money(
      sumGrossCents({ days, slots, settings, startIso: thisWeekStartIso, endIso: thisWeekEndIso }),
    ),
    current_pay_period_net: money(payPeriodNetCents),
    current_pay_period_gross: money(
      sumGrossCents({ days, slots, settings, startIso: payPeriodStartIso, endIso: payPeriodEndIso }),
    ),
    rolling_30d_net: money(rolling30NetCents),
    ytd_net: money(ytdNetRollupCents || ytdNetCents),
    ytd_gross: money(sumGrossCents({ days, slots, settings })),
    paychecks_this_period: [
      {
        date: paycheckDueDate,
        amount: money(currentPayPeriodNetCents || payPeriodNetCents),
      },
    ],
  };
}

function buildBaseline({
  dayTotals,
  weeks,
  thisWeekStartIso,
  thisWeekEndIso,
  payPeriodStartIso,
  payPeriodEndIso,
  rolling30StartIso,
  todayIso,
}: {
  dayTotals: DayTotalRow[];
  weeks: WeekTotalRow[];
  thisWeekStartIso: string;
  thisWeekEndIso: string;
  payPeriodStartIso: string;
  payPeriodEndIso: string;
  rolling30StartIso: string;
  todayIso: string;
}) {
  const ytdRollupCents = weeks.reduce(
    (sum, week) => sum + dollarsToCents(toNumber(week.base_total)),
    0,
  );

  return {
    this_week_total: money(
      sumDayMoney(dayTotals, "base_amount", thisWeekStartIso, thisWeekEndIso),
    ),
    current_pay_period_total: money(
      sumDayMoney(dayTotals, "base_amount", payPeriodStartIso, payPeriodEndIso),
    ),
    rolling_30d_total: money(
      sumDayMoney(dayTotals, "base_amount", rolling30StartIso, todayIso),
    ),
    ytd_total: money(ytdRollupCents || sumDayMoney(dayTotals, "base_amount")),
  };
}

function buildSpending({
  dayTotals,
  weeks,
  transactions,
  thisWeekStartIso,
  thisWeekEndIso,
  payPeriodStartIso,
  payPeriodEndIso,
  rolling30StartIso,
  todayIso,
}: {
  dayTotals: DayTotalRow[];
  weeks: WeekTotalRow[];
  transactions: TransactionRow[];
  thisWeekStartIso: string;
  thisWeekEndIso: string;
  payPeriodStartIso: string;
  payPeriodEndIso: string;
  rolling30StartIso: string;
  todayIso: string;
}) {
  const rolling30TotalCents = sumDayMoney(
    dayTotals,
    "spend_total",
    rolling30StartIso,
    todayIso,
  );
  const ytdRollupCents = weeks.reduce(
    (sum, week) => sum + dollarsToCents(toNumber(week.spend_total)),
    0,
  );

  return {
    this_week_total: money(
      sumDayMoney(dayTotals, "spend_total", thisWeekStartIso, thisWeekEndIso),
    ),
    current_pay_period_total: money(
      sumDayMoney(dayTotals, "spend_total", payPeriodStartIso, payPeriodEndIso),
    ),
    rolling_30d_total: money(rolling30TotalCents),
    ytd_total: money(ytdRollupCents || sumDayMoney(dayTotals, "spend_total")),
    top_categories_rolling_30d: buildTopCategories(
      transactions,
      rolling30StartIso,
      todayIso,
      rolling30TotalCents,
    ),
  };
}

function buildTopCategories(
  transactions: TransactionRow[],
  startIso: string,
  endIso: string,
  totalCents: number,
) {
  const byCategory = new Map<string, number>();

  transactions.forEach((transaction) => {
    if (
      transaction.status !== "applied" ||
      transaction.date < startIso ||
      transaction.date > endIso
    ) {
      return;
    }

    const amountCents = Math.max(0, dollarsToCents(toNumber(transaction.amount)));
    if (amountCents <= 0) return;

    const category = transaction.category?.trim() || "Uncategorized";
    byCategory.set(category, (byCategory.get(category) ?? 0) + amountCents);
  });

  return [...byCategory.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 7)
    .map(([category, amountCents]) => ({
      category,
      amount: money(amountCents),
      pct_of_total: totalCents > 0 ? round2((amountCents / totalCents) * 100) : 0,
    }));
}

function sumDayMoney(
  dayTotals: DayTotalRow[],
  field: "earnings_total" | "spend_total" | "base_amount" | "cashflow_total",
  startIso?: string,
  endIso?: string,
) {
  return dayTotals.reduce((sum, day) => {
    if (startIso && day.date < startIso) return sum;
    if (endIso && day.date > endIso) return sum;
    return sum + dollarsToCents(toNumber(day[field]));
  }, 0);
}

function sumGrossCents({
  days,
  slots,
  settings,
  startIso,
  endIso,
}: {
  days: DayRow[];
  slots: EarnSlotRow[];
  settings: SettingsRow;
  startIso?: string;
  endIso?: string;
}) {
  const dayById = new Map(days.map((day) => [day.id, day]));
  const prestigeRegularGrossRate = netToGrossRate(
    toNumber(settings.prestige_regular_net_rate) || DEFAULT_PRESTIGE_REGULAR_NET_RATE,
  );
  const prestigeOvertimeGrossRate = netToGrossRate(
    toNumber(settings.prestige_ot_net_rate) || DEFAULT_PRESTIGE_OVERTIME_NET_RATE,
  );
  const prestigeIlstRegularGrossRate = netToGrossRate(
    toNumber(settings.prestige_ilst_net_rate) ||
      DEFAULT_PRESTIGE_ILST_REGULAR_NET_RATE,
  );
  const prestigeIlstOvertimeGrossRate = netToGrossRate(
    toNumber(settings.prestige_ilst_ot_net_rate) ||
      DEFAULT_PRESTIGE_ILST_OVERTIME_NET_RATE,
  );

  return slots.reduce((sum, slot) => {
    const day = dayById.get(slot.day_id);
    if (!day) return sum;
    if (startIso && day.date < startIso) return sum;
    if (endIso && day.date > endIso) return sum;

    return sum + dollarsToCents(grossForSlot(slot, {
      prestigeRegularGrossRate,
      prestigeOvertimeGrossRate,
      prestigeIlstRegularGrossRate,
      prestigeIlstOvertimeGrossRate,
    }));
  }, 0);
}

function grossForSlot(
  slot: EarnSlotRow,
  rates: {
    prestigeRegularGrossRate: number;
    prestigeOvertimeGrossRate: number;
    prestigeIlstRegularGrossRate: number;
    prestigeIlstOvertimeGrossRate: number;
  },
) {
  const regularHours =
    slot.pay_type === "split" || slot.pay_type === "regular"
      ? toNumber(slot.regular_hours || slot.hours_or_units)
      : 0;
  const overtimeHours =
    slot.pay_type === "split" || slot.pay_type === "overtime"
      ? toNumber(slot.overtime_hours || slot.hours_or_units)
      : 0;

  if (slot.job_type === "ability") {
    return regularHours * ABILITY_REGULAR_GROSS_RATE + overtimeHours * ABILITY_OVERTIME_GROSS_RATE;
  }

  if (slot.job_type === "prestige") {
    return regularHours * rates.prestigeRegularGrossRate + overtimeHours * rates.prestigeOvertimeGrossRate;
  }

  if (slot.job_type === "prestige_ilst") {
    return regularHours * rates.prestigeIlstRegularGrossRate + overtimeHours * rates.prestigeIlstOvertimeGrossRate;
  }

  return toNumber(slot.hours_or_units);
}

function netToGrossRate(netRate: number): number {
  return netRate / (1 - PRESTIGE_WITHHOLDING_RATE);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;

function authorizeLedgerRequest(
  request: Request,
):
  | { ok: true }
  | { ok: false; response: NextResponse<{ error: string }> } {
  const token = process.env[LEDGER_TOKEN_ENV];

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${LEDGER_TOKEN_ENV} is not configured.` },
        { status: 500 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (provided !== token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}

async function resolveLedgerUserId(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const configuredUserId = process.env[LEDGER_USER_ID_ENV];

  if (configuredUserId) {
    return configuredUserId;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data?.id) {
    throw new Error(`Unable to resolve ledger user: ${error?.message ?? "missing profile"}`);
  }

  return data.id as string;
}

function methodNotAllowed() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

function mapDebt(row: DebtRow) {
  const balanceCents = dollarsToCents(toNumber(row.balance));

  return {
    id: row.id,
    type: inferDebtType(row.name),
    balance: money(balanceCents),
    apr: round2(toNumber(row.apr) * 100),
    minimum_payment: money(dollarsToCents(toNumber(row.minimum_payment))),
    minimum_due_date: null,
    status: row.status,
    starting_balance: money(balanceCents),
  };
}

function mapAccounts(assets: AssetRow[]) {
  const emergencyCents = findAssetValue(assets, ["emergency", "cushion"]);
  const propertyCents = findAssetValue(assets, ["property", "fund"]);

  return [
    {
      id: "emergency_cushion",
      label: "Emergency cushion",
      balance: money(emergencyCents),
    },
    {
      id: "property_fund",
      label: "Property fund",
      balance: money(propertyCents),
    },
  ];
}

function findAssetValue(assets: AssetRow[], needles: string[]): number {
  const asset = assets.find((item) => {
    const name = item.name.toLowerCase();
    return needles.some((needle) => name.includes(needle));
  });

  return dollarsToCents(toNumber(asset?.value ?? 0));
}

function inferDebtType(name: string): "auto_loan" | "credit_card" | "debt" {
  const normalized = name.toLowerCase();

  if (normalized.includes("auto") || normalized.includes("loan")) {
    return "auto_loan";
  }

  if (
    normalized.includes("card") ||
    normalized.includes("capital") ||
    normalized.includes("best buy") ||
    normalized.includes("aspire") ||
    normalized.includes("fortiva") ||
    normalized.includes("mission lane")
  ) {
    return "credit_card";
  }

  return "debt";
}

function mondayOnOrBeforeIso(todayIso: string): string {
  const date = new Date(`${todayIso}T00:00:00.000Z`);
  const dayIndex = date.getUTCDay();
  const daysSinceMonday = (dayIndex + 6) % 7;
  return addDaysIso(todayIso, -daysSinceMonday);
}

function money(cents: number): number {
  return round2(centsToDollars(cents));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: NumericValue): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
