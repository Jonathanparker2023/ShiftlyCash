import { requireUser } from "@/lib/auth";
import { getSundayOnOrBeforeTodayIso } from "@/lib/dashboard/dates";
import { dollarsToCents } from "@/lib/domain/money";
import { getPayPeriodInfo } from "@/lib/domain/pay";
import { estimateBiweeklyWithholding } from "@/lib/domain/withholding";

const ABILITY_REGULAR_GROSS_RATE = 19.055;
const ABILITY_OVERTIME_GROSS_RATE = 28.5825;
const PRESTIGE_WITHHOLDING_RATE = 0.18;
const DEFAULT_PRESTIGE_REGULAR_NET_RATE = 14.28;
const DEFAULT_PRESTIGE_OVERTIME_NET_RATE = 21.42;

type NumericValue = number | string | null;
export type PaycheckJobKey = "ability" | "prestige";

type WeekTotalRow = {
  week_id: string;
  start_date: string;
  end_date: string;
  display_week_number: number;
  pay_period_role: "week_1" | "week_2";
  paycheck_due_date: string | null;
  status: "active" | "closed";
};

type DayRow = {
  id: string;
  week_id: string;
};

type EarnSlotRow = {
  day_id: string;
  job_type: "ability" | "prestige" | "incentive" | "other" | "none";
  pay_type: "regular" | "overtime" | "unit" | "none";
  hours_or_units: NumericValue;
};

type PaycheckActualRow = {
  week_id: string;
  ability_actual_amount: NumericValue;
  prestige_actual_amount: NumericValue;
};

type SettingsRow = {
  prestige_regular_net_rate: NumericValue;
  prestige_ot_net_rate: NumericValue;
};

type PaycheckWeekJobSummary = {
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
  grossCents: number;
};

export type PaycheckJobSummary = {
  label: string;
  rateNote: string;
  regularRate: number;
  overtimeRate: number;
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
  grossCents: number;
  estimatedTaxCents: number;
  estimatedNetCents: number;
  actualNetCents: number | null;
  differenceCents: number | null;
};

export type PaycheckWeekSummary = {
  id: string;
  startDate: string;
  endDate: string;
  displayWeekNumber: number;
  role: "week_1" | "week_2";
  status: "active" | "closed";
  jobs: Record<PaycheckJobKey, PaycheckWeekJobSummary>;
};

export type PaycheckPeriod = {
  id: "previous" | "current";
  label: string;
  startDate: string;
  endDate: string;
  paycheckDueDate: string | null;
  actualWeekId: string | null;
  weeks: PaycheckWeekSummary[];
  jobs: Record<PaycheckJobKey, PaycheckJobSummary>;
};

export type PaycheckAuditData = {
  periods: PaycheckPeriod[];
};

export async function getPaycheckAuditData(): Promise<PaycheckAuditData> {
  const { supabase } = await requireUser();
  const activeStartDate = getSundayOnOrBeforeTodayIso();
  const currentRole = getPayPeriodInfo(activeStartDate).role;
  const currentPeriodStart =
    currentRole === "week_1" ? activeStartDate : addDaysIso(activeStartDate, -7);
  const previousPeriodStart = addDaysIso(currentPeriodStart, -14);
  const weekStarts = [
    previousPeriodStart,
    addDaysIso(previousPeriodStart, 7),
    currentPeriodStart,
    addDaysIso(currentPeriodStart, 7),
  ];

  const { data: weekData, error: weekError } = await supabase
    .from("v_week_totals")
    .select(
      "week_id,start_date,end_date,display_week_number,pay_period_role,paycheck_due_date,status",
    )
    .in("start_date", weekStarts);

  if (weekError) {
    throw new Error(`Unable to load paycheck weeks: ${weekError.message}`);
  }

  const { data: settingsData, error: settingsError } = await supabase
    .from("settings")
    .select("prestige_regular_net_rate,prestige_ot_net_rate")
    .single();

  if (settingsError) {
    throw new Error(`Unable to load paycheck settings: ${settingsError.message}`);
  }

  const weeks = (weekData ?? []) as WeekTotalRow[];
  const weekIds = weeks.map((week) => week.week_id);
  const { data: dayData, error: dayError } =
    weekIds.length > 0
      ? await supabase.from("days").select("id,week_id").in("week_id", weekIds)
      : { data: [], error: null };

  if (dayError) {
    throw new Error(`Unable to load paycheck days: ${dayError.message}`);
  }

  const days = (dayData ?? []) as DayRow[];
  const dayIds = days.map((day) => day.id);
  const { data: slotData, error: slotError } =
    dayIds.length > 0
      ? await supabase
          .from("earn_slots")
          .select("day_id,job_type,pay_type,hours_or_units")
          .in("day_id", dayIds)
      : { data: [], error: null };

  if (slotError) {
    throw new Error(`Unable to load paycheck earn slots: ${slotError.message}`);
  }

  const weekTwoIds = weeks
    .filter((week) => week.pay_period_role === "week_2")
    .map((week) => week.week_id);
  const { data: actualData, error: actualError } =
    weekTwoIds.length > 0
      ? await supabase
          .from("paycheck_actuals")
          .select("week_id,ability_actual_amount,prestige_actual_amount")
          .in("week_id", weekTwoIds)
      : { data: [], error: null };

  if (actualError) {
    throw new Error(`Unable to load paycheck actuals: ${actualError.message}`);
  }

  return {
    periods: [
      buildPeriod({
        id: "previous",
        label: "Previous pay period",
        periodStart: previousPeriodStart,
        settings: settingsData as SettingsRow,
        weeks,
        days,
        slots: (slotData ?? []) as EarnSlotRow[],
        actuals: (actualData ?? []) as PaycheckActualRow[],
      }),
      buildPeriod({
        id: "current",
        label: "Current pay period",
        periodStart: currentPeriodStart,
        settings: settingsData as SettingsRow,
        weeks,
        days,
        slots: (slotData ?? []) as EarnSlotRow[],
        actuals: (actualData ?? []) as PaycheckActualRow[],
      }),
    ],
  };
}

function buildPeriod({
  id,
  label,
  periodStart,
  settings,
  weeks,
  days,
  slots,
  actuals,
}: {
  id: "previous" | "current";
  label: string;
  periodStart: string;
  settings: SettingsRow;
  weeks: WeekTotalRow[];
  days: DayRow[];
  slots: EarnSlotRow[];
  actuals: PaycheckActualRow[];
}): PaycheckPeriod {
  const periodEnd = addDaysIso(periodStart, 13);
  const periodWeeks = weeks
    .filter((week) => week.start_date >= periodStart && week.start_date <= periodEnd)
    .sort((left, right) => left.start_date.localeCompare(right.start_date));
  const dayToWeekId = new Map(days.map((day) => [day.id, day.week_id]));
  const prestigeRegularGrossRate = netToGrossRate(
    toNumber(settings.prestige_regular_net_rate) || DEFAULT_PRESTIGE_REGULAR_NET_RATE,
  );
  const prestigeOvertimeGrossRate = netToGrossRate(
    toNumber(settings.prestige_ot_net_rate) || DEFAULT_PRESTIGE_OVERTIME_NET_RATE,
  );
  const weekSummaries = periodWeeks.map((week) => {
    const abilityHours = sumHoursForWeek("ability", week.week_id, dayToWeekId, slots);
    const prestigeHours = sumHoursForWeek("prestige", week.week_id, dayToWeekId, slots);
    const abilityGross =
      abilityHours.regularHours * ABILITY_REGULAR_GROSS_RATE +
      abilityHours.overtimeHours * ABILITY_OVERTIME_GROSS_RATE;
    const prestigeGross =
      prestigeHours.regularHours * prestigeRegularGrossRate +
      prestigeHours.overtimeHours * prestigeOvertimeGrossRate;

    return {
      id: week.week_id,
      startDate: week.start_date,
      endDate: week.end_date,
      displayWeekNumber: week.display_week_number,
      role: week.pay_period_role,
      status: week.status,
      jobs: {
        ability: buildWeekJobSummary(abilityHours, abilityGross),
        prestige: buildWeekJobSummary(prestigeHours, prestigeGross),
      },
    };
  });
  const abilityHours = sumJobHours(weekSummaries, "ability");
  const prestigeHours = sumJobHours(weekSummaries, "prestige");
  const abilityGross =
    abilityHours.regularHours * ABILITY_REGULAR_GROSS_RATE +
    abilityHours.overtimeHours * ABILITY_OVERTIME_GROSS_RATE;
  const prestigeGross =
    prestigeHours.regularHours * prestigeRegularGrossRate +
    prestigeHours.overtimeHours * prestigeOvertimeGrossRate;
  const actualWeek = periodWeeks.find((week) => week.pay_period_role === "week_2");
  const actual = actuals.find((row) => row.week_id === actualWeek?.week_id);

  return {
    id,
    label,
    startDate: periodStart,
    endDate: periodEnd,
    paycheckDueDate: actualWeek?.paycheck_due_date ?? null,
    actualWeekId: actualWeek?.week_id ?? null,
    weeks: weekSummaries,
    jobs: {
      ability: buildJobSummary({
        label: "Ability",
        rateNote: "UKG gross rates",
        jobType: "ability",
        regularRate: ABILITY_REGULAR_GROSS_RATE,
        overtimeRate: ABILITY_OVERTIME_GROSS_RATE,
        regularHours: abilityHours.regularHours,
        overtimeHours: abilityHours.overtimeHours,
        gross: abilityGross,
        actualValue: actual?.ability_actual_amount,
      }),
      prestige: buildJobSummary({
        label: "Prestige",
        rateNote: "gross estimate from saved Prestige net rates",
        jobType: "prestige",
        regularRate: prestigeRegularGrossRate,
        overtimeRate: prestigeOvertimeGrossRate,
        regularHours: prestigeHours.regularHours,
        overtimeHours: prestigeHours.overtimeHours,
        gross: prestigeGross,
        actualValue: actual?.prestige_actual_amount,
      }),
    },
  };
}

function buildWeekJobSummary(
  hours: { regularHours: number; overtimeHours: number },
  gross: number,
): PaycheckWeekJobSummary {
  return {
    regularHours: hours.regularHours,
    overtimeHours: hours.overtimeHours,
    totalHours: hours.regularHours + hours.overtimeHours,
    grossCents: dollarsToCents(gross),
  };
}

function sumJobHours(
  weeks: PaycheckWeekSummary[],
  jobType: PaycheckJobKey,
): { regularHours: number; overtimeHours: number } {
  return weeks.reduce(
    (total, week) => {
      total.regularHours += week.jobs[jobType].regularHours;
      total.overtimeHours += week.jobs[jobType].overtimeHours;
      return total;
    },
    { regularHours: 0, overtimeHours: 0 },
  );
}

function buildJobSummary({
  label,
  rateNote,
  jobType,
  regularRate,
  overtimeRate,
  regularHours,
  overtimeHours,
  gross,
  actualValue,
}: {
  label: string;
  rateNote: string;
  jobType: PaycheckJobKey;
  regularRate: number;
  overtimeRate: number;
  regularHours: number;
  overtimeHours: number;
  gross: number;
  actualValue: NumericValue | undefined;
}): PaycheckJobSummary {
  const withholding = estimateBiweeklyWithholding({
    jobType,
    biweeklyGross: gross,
  });
  const actualNetCents =
    actualValue === null || actualValue === undefined
      ? null
      : dollarsToCents(toNumber(actualValue));
  const estimatedNetCents = dollarsToCents(gross - withholding.tax);

  return {
    label,
    rateNote,
    regularRate,
    overtimeRate,
    regularHours,
    overtimeHours,
    totalHours: regularHours + overtimeHours,
    grossCents: dollarsToCents(gross),
    estimatedTaxCents: dollarsToCents(withholding.tax),
    estimatedNetCents,
    actualNetCents,
    differenceCents:
      actualNetCents === null ? null : actualNetCents - estimatedNetCents,
  };
}

function sumHoursForWeek(
  jobType: PaycheckJobKey,
  weekId: string,
  dayToWeekId: Map<string, string>,
  slots: EarnSlotRow[],
): { regularHours: number; overtimeHours: number } {
  return slots.reduce(
    (total, slot) => {
      if (dayToWeekId.get(slot.day_id) !== weekId || slot.job_type !== jobType) {
        return total;
      }

      if (slot.pay_type === "regular") {
        total.regularHours += toNumber(slot.hours_or_units);
      }

      if (slot.pay_type === "overtime") {
        total.overtimeHours += toNumber(slot.hours_or_units);
      }

      return total;
    },
    { regularHours: 0, overtimeHours: 0 },
  );
}

function netToGrossRate(netRate: number): number {
  return netRate / (1 - PRESTIGE_WITHHOLDING_RATE);
}

function toNumber(value: NumericValue): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addDaysIso(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
