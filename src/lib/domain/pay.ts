import {
  dollarsToCents,
  multiplyCents,
  roundCentsToNearestTenDollars,
  type MoneyCents,
} from "@/lib/domain/money";

export type JobType =
  | "ability"
  | "prestige"
  | "prestige_ilst"
  | "incentive"
  | "other"
  | "none";
export type PayType = "regular" | "overtime" | "unit" | "none";
export type PayPeriodRole = "week_1" | "week_2";

export type PaySettings = {
  abilityRegularNetRateCents: MoneyCents;
  abilityOvertimeNetRateCents: MoneyCents;
  prestigeRegularNetRateCents: MoneyCents;
  prestigeOvertimeNetRateCents: MoneyCents;
  prestigeIlstRegularNetRateCents: MoneyCents;
  prestigeIlstOvertimeNetRateCents: MoneyCents;
  // Net-of-tax multiplier for the Ability paycheck. Incentive pay is treated
  // as Ability income for tax purposes, so it uses this same multiplier.
  abilityNetMultiplier: number;
};

export type EarnSlotInput = {
  jobType: JobType;
  payType?: PayType;
  hoursOrUnits?: number;
  label?: string;
};

export type EarnSlotTotals = {
  earningsCents: MoneyCents;
  abilityPaycheckCents: MoneyCents;
  prestigePaycheckCents: MoneyCents;
  wageHours: number;
};

export type DayInput = {
  earnSlots: EarnSlotInput[];
  spendCents?: MoneyCents;
  baseCents?: MoneyCents;
};

export type DayTotals = {
  earningsCents: MoneyCents;
  abilityPaycheckCents: MoneyCents;
  prestigePaycheckCents: MoneyCents;
  wageHours: number;
  spendCents: MoneyCents;
  baseCents: MoneyCents;
  cashflowCents: MoneyCents;
  legacyRoundedCashflowCents: MoneyCents;
};

export type WeekInput = {
  days: DayInput[];
};

export type WeekTotals = DayTotals & {
  dayCount: number;
};

export type PayPeriodInfo = {
  displayWeekNumber: number;
  role: PayPeriodRole;
  paycheckDueDate: string | null;
};

export const DEFAULT_PAY_SETTINGS: PaySettings = {
  abilityRegularNetRateCents: 1563,
  abilityOvertimeNetRateCents: 2173,
  prestigeRegularNetRateCents: 1462,
  prestigeOvertimeNetRateCents: 2193,
  prestigeIlstRegularNetRateCents: 1548,
  prestigeIlstOvertimeNetRateCents: 2322,
  abilityNetMultiplier: 0.7348,
};

// Live weeks compute Ability/Prestige splits here. Summary-only legacy imports
// get a 68/32 fallback inside v_week_totals so projections can gross them up.
export function calculateEarnSlot(
  slot: EarnSlotInput,
  settings: PaySettings = DEFAULT_PAY_SETTINGS,
): EarnSlotTotals {
  const amount = Math.max(0, slot.hoursOrUnits ?? 0);

  if (slot.jobType === "none" || amount === 0) {
    return emptyEarnSlotTotals();
  }

  if (slot.jobType === "ability") {
    const rate =
      slot.payType === "overtime"
        ? settings.abilityOvertimeNetRateCents
        : settings.abilityRegularNetRateCents;
    const earningsCents = Math.round(amount * rate);

    return {
      earningsCents,
      abilityPaycheckCents: earningsCents,
      prestigePaycheckCents: 0,
      wageHours: amount,
    };
  }

  if (slot.jobType === "prestige" || slot.jobType === "prestige_ilst") {
    // v0 stopgap: Prestige OT uses simple 1.5x net rates. Real Prestige OT is
    // FLSA weighted-average per workweek and belongs in the next rebuild.
    const isIlst = slot.jobType === "prestige_ilst";
    const rate =
      slot.payType === "overtime"
        ? isIlst
          ? settings.prestigeIlstOvertimeNetRateCents
          : settings.prestigeOvertimeNetRateCents
        : isIlst
          ? settings.prestigeIlstRegularNetRateCents
          : settings.prestigeRegularNetRateCents;
    const earningsCents = Math.round(amount * rate);

    return {
      earningsCents,
      abilityPaycheckCents: 0,
      prestigePaycheckCents: earningsCents,
      wageHours: amount,
    };
  }

  if (slot.jobType === "incentive") {
    const earningsCents = multiplyCents(
      dollarsToCents(amount),
      settings.abilityNetMultiplier,
    );

    return {
      earningsCents,
      abilityPaycheckCents: earningsCents,
      prestigePaycheckCents: 0,
      wageHours: 0,
    };
  }

  const earningsCents = dollarsToCents(amount);

  return {
    earningsCents,
    abilityPaycheckCents: 0,
    prestigePaycheckCents: 0,
    wageHours: 0,
  };
}

export function calculateDayTotals(
  day: DayInput,
  settings: PaySettings = DEFAULT_PAY_SETTINGS,
): DayTotals {
  const earnTotals = day.earnSlots
    .map((slot) => calculateEarnSlot(slot, settings))
    .reduce(combineEarnSlotTotals, emptyEarnSlotTotals());
  const spendCents = day.spendCents ?? 0;
  const baseCents = day.baseCents ?? 0;
  const cashflowCents = earnTotals.earningsCents - spendCents - baseCents;

  return {
    ...earnTotals,
    spendCents,
    baseCents,
    cashflowCents,
    legacyRoundedCashflowCents: roundCentsToNearestTenDollars(cashflowCents),
  };
}

export function calculateWeekTotals(
  week: WeekInput,
  settings: PaySettings = DEFAULT_PAY_SETTINGS,
): WeekTotals {
  const totals = week.days
    .map((day) => calculateDayTotals(day, settings))
    .reduce(combineDayTotals, emptyDayTotals());

  return {
    ...totals,
    dayCount: week.days.length,
    legacyRoundedCashflowCents: roundCentsToNearestTenDollars(
      totals.legacyRoundedCashflowCents,
    ),
  };
}

export function getFirstSundayOfYear(year: number): Date {
  const date = new Date(Date.UTC(year, 0, 1));
  const daysUntilSunday = (7 - date.getUTCDay()) % 7;
  date.setUTCDate(date.getUTCDate() + daysUntilSunday);
  return date;
}

export function getShiftlyDisplayWeekNumber(startDateIso: string): number {
  const startDate = parseIsoDate(startDateIso);
  const firstSunday = getFirstSundayOfYear(startDate.getUTCFullYear());
  const dayDiff = Math.floor(
    (startDate.getTime() - firstSunday.getTime()) / 86_400_000,
  );

  return Math.floor(dayDiff / 7) + 1;
}

export function getPayPeriodInfo(startDateIso: string): PayPeriodInfo {
  const displayWeekNumber = getShiftlyDisplayWeekNumber(startDateIso);
  const role: PayPeriodRole =
    displayWeekNumber % 2 === 0 ? "week_1" : "week_2";
  const paycheckDueDate =
    role === "week_2" ? addDaysIso(startDateIso, 11) : null;

  return { displayWeekNumber, role, paycheckDueDate };
}

function emptyEarnSlotTotals(): EarnSlotTotals {
  return {
    earningsCents: 0,
    abilityPaycheckCents: 0,
    prestigePaycheckCents: 0,
    wageHours: 0,
  };
}

function emptyDayTotals(): DayTotals {
  return {
    ...emptyEarnSlotTotals(),
    spendCents: 0,
    baseCents: 0,
    cashflowCents: 0,
    legacyRoundedCashflowCents: 0,
  };
}

function combineEarnSlotTotals(
  left: EarnSlotTotals,
  right: EarnSlotTotals,
): EarnSlotTotals {
  return {
    earningsCents: left.earningsCents + right.earningsCents,
    abilityPaycheckCents:
      left.abilityPaycheckCents + right.abilityPaycheckCents,
    prestigePaycheckCents:
      left.prestigePaycheckCents + right.prestigePaycheckCents,
    wageHours: left.wageHours + right.wageHours,
  };
}

function combineDayTotals(left: DayTotals, right: DayTotals): DayTotals {
  return {
    earningsCents: left.earningsCents + right.earningsCents,
    abilityPaycheckCents:
      left.abilityPaycheckCents + right.abilityPaycheckCents,
    prestigePaycheckCents:
      left.prestigePaycheckCents + right.prestigePaycheckCents,
    wageHours: left.wageHours + right.wageHours,
    spendCents: left.spendCents + right.spendCents,
    baseCents: left.baseCents + right.baseCents,
    cashflowCents: left.cashflowCents + right.cashflowCents,
    legacyRoundedCashflowCents:
      left.legacyRoundedCashflowCents + right.legacyRoundedCashflowCents,
  };
}

function parseIsoDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  return date;
}

function addDaysIso(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
