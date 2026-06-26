import { requireUser } from "@/lib/auth";
import { getSundayOnOrBeforeTodayIso } from "@/lib/dashboard/dates";
import { dollarsToCents } from "@/lib/domain/money";
import { getPayPeriodInfo } from "@/lib/domain/pay";

const PRESTIGE_WITHHOLDING_RATE = 0.14;
const DEFAULT_PRESTIGE_REGULAR_NET_RATE = 14.62;
const DEFAULT_PRESTIGE_OVERTIME_NET_RATE = 21.93;
const DEFAULT_PRESTIGE_ILST_REGULAR_NET_RATE = 15.48;
const DEFAULT_PRESTIGE_ILST_OVERTIME_NET_RATE = 23.22;

type NumericValue = number | string | null;

// A job key on the paycheck audit is either the "prestige" built-in or a
// custom job, keyed "custom:<uuid>". Ability has been retired from this page.
export type PaycheckJobKey = string;

export const PRESTIGE_JOB_KEY = "prestige";

export function customJobKey(customJobId: string): string {
  return `custom:${customJobId}`;
}

export function isCustomJobKey(key: string): boolean {
  return key.startsWith("custom:");
}

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
  job_type:
    | "ability"
    | "ability_incentive"
    | "prestige"
    | "prestige_ilst"
    | "incentive"
    | "other"
    | "none";
  custom_job_id: string | null;
  pay_type: "regular" | "overtime" | "split" | "unit" | "none";
  hours_or_units: NumericValue;
  regular_hours: NumericValue;
  overtime_hours: NumericValue;
};

type CustomJobRow = {
  id: string;
  name: string;
  regular_gross_rate_cents: NumericValue;
  ot_gross_rate_cents: NumericValue;
  withholding_rate: NumericValue;
  active: boolean;
};

type PaycheckActualRow = {
  week_id: string;
  prestige_actual_amount: NumericValue;
  job_actuals: Record<string, NumericValue> | null;
};

type SettingsRow = {
  prestige_regular_net_rate: NumericValue;
  prestige_ot_net_rate: NumericValue;
  prestige_ilst_net_rate: NumericValue;
  prestige_ilst_ot_net_rate: NumericValue;
};

type PaycheckWeekJobSummary = {
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
  grossCents: number;
};

export type PaycheckJobSummary = {
  key: string;
  label: string;
  kind: "builtin" | "custom";
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
  jobs: Record<string, PaycheckWeekJobSummary>;
};

export type PaycheckPeriod = {
  id: "previous" | "current";
  label: string;
  startDate: string;
  endDate: string;
  paycheckDueDate: string | null;
  actualWeekId: string | null;
  weeks: PaycheckWeekSummary[];
  jobs: PaycheckJobSummary[];
};

export type PaycheckAuditData = {
  periods: PaycheckPeriod[];
};

// A job present on the page, with a closure that yields its hours+gross for one
// week. Prestige folds in its ILST variant (different rate); custom jobs use
// their own stored gross rates.
type JobSpec = {
  key: string;
  label: string;
  kind: "builtin" | "custom";
  rateNote: string;
  regularRate: number;
  overtimeRate: number;
  withholdingRate: number;
  weekSummary: (weekId: string) => PaycheckWeekJobSummary;
};

export async function getPaycheckAuditData(): Promise<PaycheckAuditData> {
  const { supabase, user } = await requireUser();
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
    .select(
      "prestige_regular_net_rate,prestige_ot_net_rate,prestige_ilst_net_rate,prestige_ilst_ot_net_rate",
    )
    .single();

  if (settingsError) {
    throw new Error(`Unable to load paycheck settings: ${settingsError.message}`);
  }

  const { data: customJobData, error: customJobError } = await supabase
    .from("custom_jobs")
    .select(
      "id,name,regular_gross_rate_cents,ot_gross_rate_cents,withholding_rate,active",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (customJobError) {
    throw new Error(`Unable to load custom jobs: ${customJobError.message}`);
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
          .select(
            "day_id,job_type,custom_job_id,pay_type,hours_or_units,regular_hours,overtime_hours",
          )
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
          .select("week_id,prestige_actual_amount,job_actuals")
          .in("week_id", weekTwoIds)
      : { data: [], error: null };

  if (actualError) {
    throw new Error(`Unable to load paycheck actuals: ${actualError.message}`);
  }

  const slots = (slotData ?? []) as EarnSlotRow[];
  const customJobs = (customJobData ?? []) as CustomJobRow[];
  const dayToWeekId = new Map(days.map((day) => [day.id, day.week_id]));

  const prestigeRegularGrossRate = netToGrossRate(
    toNumber(settingsData.prestige_regular_net_rate) ||
      DEFAULT_PRESTIGE_REGULAR_NET_RATE,
  );
  const prestigeOvertimeGrossRate = netToGrossRate(
    toNumber(settingsData.prestige_ot_net_rate) ||
      DEFAULT_PRESTIGE_OVERTIME_NET_RATE,
  );
  const prestigeIlstRegularGrossRate = netToGrossRate(
    toNumber(settingsData.prestige_ilst_net_rate) ||
      DEFAULT_PRESTIGE_ILST_REGULAR_NET_RATE,
  );
  const prestigeIlstOvertimeGrossRate = netToGrossRate(
    toNumber(settingsData.prestige_ilst_ot_net_rate) ||
      DEFAULT_PRESTIGE_ILST_OVERTIME_NET_RATE,
  );

  // Only jobs with logged entries in the visible weeks appear — so a new custom
  // job shows up automatically the moment its first shift is logged.
  const jobSpecs: JobSpec[] = [];

  const hasPrestige = slots.some(
    (slot) => slot.job_type === "prestige" || slot.job_type === "prestige_ilst",
  );
  if (hasPrestige) {
    jobSpecs.push({
      key: PRESTIGE_JOB_KEY,
      label: "Prestige",
      kind: "builtin",
      rateNote: "includes Prestige $17 and ILST $18; OT is simple 1.5x v0",
      regularRate: prestigeRegularGrossRate,
      overtimeRate: prestigeOvertimeGrossRate,
      withholdingRate: PRESTIGE_WITHHOLDING_RATE,
      weekSummary: (weekId) => {
        const main = sumHoursForJobType("prestige", weekId, dayToWeekId, slots);
        const ilst = sumHoursForJobType(
          "prestige_ilst",
          weekId,
          dayToWeekId,
          slots,
        );
        const grossDollars =
          main.regularHours * prestigeRegularGrossRate +
          main.overtimeHours * prestigeOvertimeGrossRate +
          ilst.regularHours * prestigeIlstRegularGrossRate +
          ilst.overtimeHours * prestigeIlstOvertimeGrossRate;
        const regularHours = main.regularHours + ilst.regularHours;
        const overtimeHours = main.overtimeHours + ilst.overtimeHours;
        return {
          regularHours,
          overtimeHours,
          totalHours: regularHours + overtimeHours,
          grossCents: dollarsToCents(grossDollars),
        };
      },
    });
  }

  for (const job of customJobs) {
    const hasEntries = slots.some((slot) => slot.custom_job_id === job.id);
    if (!hasEntries) {
      continue;
    }
    const regularRate = toNumber(job.regular_gross_rate_cents) / 100;
    const overtimeRate = toNumber(job.ot_gross_rate_cents) / 100;
    const withholdingRate = toNumber(job.withholding_rate);
    jobSpecs.push({
      key: customJobKey(job.id),
      label: job.name,
      kind: "custom",
      rateNote: `Custom job — ${(withholdingRate * 100).toFixed(0)}% withholding`,
      regularRate,
      overtimeRate,
      withholdingRate,
      weekSummary: (weekId) => {
        const hours = sumHoursForCustomJob(
          job.id,
          weekId,
          dayToWeekId,
          slots,
        );
        const grossDollars =
          hours.regularHours * regularRate + hours.overtimeHours * overtimeRate;
        return {
          regularHours: hours.regularHours,
          overtimeHours: hours.overtimeHours,
          totalHours: hours.regularHours + hours.overtimeHours,
          grossCents: dollarsToCents(grossDollars),
        };
      },
    });
  }

  const actuals = (actualData ?? []) as PaycheckActualRow[];

  return {
    periods: [
      buildPeriod({
        id: "previous",
        label: "Previous pay period",
        periodStart: previousPeriodStart,
        weeks,
        jobSpecs,
        actuals,
      }),
      buildPeriod({
        id: "current",
        label: "Current pay period",
        periodStart: currentPeriodStart,
        weeks,
        jobSpecs,
        actuals,
      }),
    ],
  };
}

function buildPeriod({
  id,
  label,
  periodStart,
  weeks,
  jobSpecs,
  actuals,
}: {
  id: "previous" | "current";
  label: string;
  periodStart: string;
  weeks: WeekTotalRow[];
  jobSpecs: JobSpec[];
  actuals: PaycheckActualRow[];
}): PaycheckPeriod {
  const periodEnd = addDaysIso(periodStart, 13);
  const periodWeeks = weeks
    .filter(
      (week) => week.start_date >= periodStart && week.start_date <= periodEnd,
    )
    .sort((left, right) => left.start_date.localeCompare(right.start_date));

  const weekSummaries: PaycheckWeekSummary[] = periodWeeks.map((week) => {
    const jobs: Record<string, PaycheckWeekJobSummary> = {};
    for (const spec of jobSpecs) {
      jobs[spec.key] = spec.weekSummary(week.week_id);
    }
    return {
      id: week.week_id,
      startDate: week.start_date,
      endDate: week.end_date,
      displayWeekNumber: week.display_week_number,
      role: week.pay_period_role,
      status: week.status,
      jobs,
    };
  });

  const actualWeek = periodWeeks.find(
    (week) => week.pay_period_role === "week_2",
  );
  const actual = actuals.find((row) => row.week_id === actualWeek?.week_id);

  const jobs: PaycheckJobSummary[] = jobSpecs.map((spec) => {
    const regularHours = weekSummaries.reduce(
      (total, week) => total + week.jobs[spec.key].regularHours,
      0,
    );
    const overtimeHours = weekSummaries.reduce(
      (total, week) => total + week.jobs[spec.key].overtimeHours,
      0,
    );
    const grossCents = weekSummaries.reduce(
      (total, week) => total + week.jobs[spec.key].grossCents,
      0,
    );
    const grossDollars = grossCents / 100;
    const tax = Math.max(0, grossDollars) * spec.withholdingRate;
    const estimatedTaxCents = dollarsToCents(tax);
    const estimatedNetCents = dollarsToCents(grossDollars - tax);
    const actualNetCents = readActual(actual, spec.key);

    return {
      key: spec.key,
      label: spec.label,
      kind: spec.kind,
      rateNote: spec.rateNote,
      regularRate: spec.regularRate,
      overtimeRate: spec.overtimeRate,
      regularHours,
      overtimeHours,
      totalHours: regularHours + overtimeHours,
      grossCents,
      estimatedTaxCents,
      estimatedNetCents,
      actualNetCents,
      differenceCents:
        actualNetCents === null ? null : actualNetCents - estimatedNetCents,
    };
  });

  return {
    id,
    label,
    startDate: periodStart,
    endDate: periodEnd,
    paycheckDueDate: actualWeek?.paycheck_due_date ?? null,
    actualWeekId: actualWeek?.week_id ?? null,
    weeks: weekSummaries,
    jobs,
  };
}

function readActual(
  actual: PaycheckActualRow | undefined,
  jobKey: string,
): number | null {
  if (!actual) {
    return null;
  }
  const fromJobActuals = actual.job_actuals?.[jobKey];
  if (fromJobActuals !== undefined && fromJobActuals !== null) {
    return dollarsToCents(toNumber(fromJobActuals));
  }
  // Legacy fallback so prestige actuals entered before the job_actuals column
  // still display.
  if (
    jobKey === PRESTIGE_JOB_KEY &&
    actual.prestige_actual_amount !== null &&
    actual.prestige_actual_amount !== undefined
  ) {
    return dollarsToCents(toNumber(actual.prestige_actual_amount));
  }
  return null;
}

function sumHoursForJobType(
  jobType: "prestige" | "prestige_ilst",
  weekId: string,
  dayToWeekId: Map<string, string>,
  slots: EarnSlotRow[],
): { regularHours: number; overtimeHours: number } {
  return sumHours(
    slots,
    (slot) =>
      dayToWeekId.get(slot.day_id) === weekId && slot.job_type === jobType,
  );
}

function sumHoursForCustomJob(
  customJobId: string,
  weekId: string,
  dayToWeekId: Map<string, string>,
  slots: EarnSlotRow[],
): { regularHours: number; overtimeHours: number } {
  return sumHours(
    slots,
    (slot) =>
      dayToWeekId.get(slot.day_id) === weekId &&
      slot.custom_job_id === customJobId,
  );
}

function sumHours(
  slots: EarnSlotRow[],
  matches: (slot: EarnSlotRow) => boolean,
): { regularHours: number; overtimeHours: number } {
  return slots.reduce(
    (total, slot) => {
      if (!matches(slot)) {
        return total;
      }

      if (slot.pay_type === "split") {
        total.regularHours += toNumber(slot.regular_hours);
        total.overtimeHours += toNumber(slot.overtime_hours);
      }

      if (slot.pay_type === "regular") {
        total.regularHours += toNumber(slot.regular_hours ?? slot.hours_or_units);
      }

      if (slot.pay_type === "overtime") {
        total.overtimeHours += toNumber(
          slot.overtime_hours ?? slot.hours_or_units,
        );
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
