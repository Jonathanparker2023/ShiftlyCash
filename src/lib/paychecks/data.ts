import { requireUser } from "@/lib/auth";
import { getSundayOnOrBeforeTodayIso } from "@/lib/dashboard/dates";
import { dollarsToCents } from "@/lib/domain/money";
import { getPayPeriodInfo } from "@/lib/domain/pay";
import { estimateBiweeklyWithholding } from "@/lib/domain/withholding";

const ABILITY_REGULAR_GROSS_RATE = 19.055;
const ABILITY_OVERTIME_GROSS_RATE = 28.5825;

type NumericValue = number | string | null;

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
};

export type PaycheckWeekSummary = {
  id: string;
  startDate: string;
  endDate: string;
  displayWeekNumber: number;
  role: "week_1" | "week_2";
  status: "active" | "closed";
  ability: {
    regularHours: number;
    overtimeHours: number;
    totalHours: number;
    grossCents: number;
  };
};

export type PaycheckPeriod = {
  id: "previous" | "current";
  label: string;
  startDate: string;
  endDate: string;
  paycheckDueDate: string | null;
  actualWeekId: string | null;
  weeks: PaycheckWeekSummary[];
  ability: {
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
          .select("week_id,ability_actual_amount")
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
        weeks,
        days,
        slots: (slotData ?? []) as EarnSlotRow[],
        actuals: (actualData ?? []) as PaycheckActualRow[],
      }),
      buildPeriod({
        id: "current",
        label: "Current pay period",
        periodStart: currentPeriodStart,
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
  weeks,
  days,
  slots,
  actuals,
}: {
  id: "previous" | "current";
  label: string;
  periodStart: string;
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
  const weekSummaries = periodWeeks.map((week) => {
    const abilityHours = sumAbilityHoursForWeek(week.week_id, dayToWeekId, slots);
    const gross =
      abilityHours.regularHours * ABILITY_REGULAR_GROSS_RATE +
      abilityHours.overtimeHours * ABILITY_OVERTIME_GROSS_RATE;

    return {
      id: week.week_id,
      startDate: week.start_date,
      endDate: week.end_date,
      displayWeekNumber: week.display_week_number,
      role: week.pay_period_role,
      status: week.status,
      ability: {
        regularHours: abilityHours.regularHours,
        overtimeHours: abilityHours.overtimeHours,
        totalHours: abilityHours.regularHours + abilityHours.overtimeHours,
        grossCents: dollarsToCents(gross),
      },
    };
  });
  const abilityHours = weekSummaries.reduce(
    (total, slot) => {
      total.regularHours += slot.ability.regularHours;
      total.overtimeHours += slot.ability.overtimeHours;
      return total;
    },
    { regularHours: 0, overtimeHours: 0 },
  );
  const gross =
    abilityHours.regularHours * ABILITY_REGULAR_GROSS_RATE +
    abilityHours.overtimeHours * ABILITY_OVERTIME_GROSS_RATE;
  const withholding = estimateBiweeklyWithholding({
    jobType: "ability",
    biweeklyGross: gross,
  });
  const actualWeek = periodWeeks.find((week) => week.pay_period_role === "week_2");
  const actual = actuals.find((row) => row.week_id === actualWeek?.week_id);
  const actualNetCents =
    actual?.ability_actual_amount === null ||
    actual?.ability_actual_amount === undefined
      ? null
      : dollarsToCents(toNumber(actual.ability_actual_amount));
  const estimatedNetCents = dollarsToCents(gross - withholding.tax);

  return {
    id,
    label,
    startDate: periodStart,
    endDate: periodEnd,
    paycheckDueDate: actualWeek?.paycheck_due_date ?? null,
    actualWeekId: actualWeek?.week_id ?? null,
    weeks: weekSummaries,
    ability: {
      regularRate: ABILITY_REGULAR_GROSS_RATE,
      overtimeRate: ABILITY_OVERTIME_GROSS_RATE,
      regularHours: abilityHours.regularHours,
      overtimeHours: abilityHours.overtimeHours,
      totalHours: abilityHours.regularHours + abilityHours.overtimeHours,
      grossCents: dollarsToCents(gross),
      estimatedTaxCents: dollarsToCents(withholding.tax),
      estimatedNetCents,
      actualNetCents,
      differenceCents:
        actualNetCents === null ? null : actualNetCents - estimatedNetCents,
    },
  };
}

function sumAbilityHoursForWeek(
  weekId: string,
  dayToWeekId: Map<string, string>,
  slots: EarnSlotRow[],
): { regularHours: number; overtimeHours: number } {
  return slots.reduce(
    (total, slot) => {
      if (dayToWeekId.get(slot.day_id) !== weekId || slot.job_type !== "ability") {
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
