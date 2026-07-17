import type { DashboardSpendProjection } from "@/lib/dashboard/spendProjection";
import type {
  DayTotals,
  EarnSlotInput,
  IncentiveMode,
  PaySettings,
  WeekTotals,
} from "@/lib/domain/pay";

export type EarnSlotSource = "template" | "user" | "migration" | "ai";
export type DashboardTransactionSource = "plaid" | "manual" | "migration";
export type DashboardTransactionStatus = "applied" | "excluded";

export type DashboardTransaction = {
  id: string;
  dayId: string;
  merchantName: string;
  amountCents: number;
  originalAmountCents: number;
  category: string | null;
  source: DashboardTransactionSource;
  status: DashboardTransactionStatus;
  isAmortized: boolean;
  isGasAllocated: boolean;
  gasAllocatedCents: number;
  gasRemainderCents: number;
  wasMovedToYesterday: boolean;
  date: string;
  time: string | null;
  createdAt: string;
};

export type DashboardSlot = EarnSlotInput & {
  id: string | null;
  dayId: string;
  slotIndex: number;
  hoursOrUnits: number;
  regularHours: number;
  overtimeHours: number;
  incentiveMode: IncentiveMode;
  incentiveRate: number;
  incentiveAmount: number;
  label: string;
  source: EarnSlotSource;
  // "earn" = a real, editable earn_slot. "bucket" = a synthetic, READ-ONLY row
  // surfacing an Amortized Income daily credit (derived, not a stored slot). Bucket
  // rows carry a signed creditCents and never consume a real slot_index.
  kind?: "earn" | "bucket";
  bucketId?: string | null;
  creditCents?: number;
  // Resolved from the linked custom job (jobType==='custom'). Rates feed the
  // client earnings calc; color/name drive the bar's inline-styled rendering.
  customJobId?: string | null;
  customRegularRateCents?: number;
  customOvertimeRateCents?: number;
  customColor?: string;
  customName?: string;
};

export type DashboardCustomJob = {
  id: string;
  name: string;
  color: string;
  regularRateCents: number;
  otRateCents: number;
};

// One row of v_day_amortization_credit_items (per day, per active bucket).
export type AmortizationCreditRow = {
  day_id: string;
  bucket_id: string;
  bucket_name: string;
  total_cents: number;
  period_days: number;
  daily_rate_cents: number;
  credit_cents: number;
  schedule_version: number;
};

export type DashboardBaseAllocation = {
  itemKind: "recurring" | "amortized";
  itemId: string;
  itemName: string;
  originalAmountCents: number;
  periodDays: number | null;
  dailyAllocCents: number;
  appliedCents: number;
  scheduleVersion: number;
};

export type DashboardDay = {
  id: string;
  weekId: string;
  date: string;
  dayIndex: number;
  label: string;
  baseCents: number;
  spendCents: number;
  transactionSpendCents: number;
  gasSpendCents: number;
  spendLocked: boolean;
  baseBreakdown: DashboardBaseAllocation[];
  totals: DayTotals;
  slots: DashboardSlot[];
  appliedTransactions: DashboardTransaction[];
  excludedTransactions: DashboardTransaction[];
};

export type DashboardWeek = {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  displayWeekNumber: number;
  payPeriodRole: "week_1" | "week_2";
  paycheckDueDate: string | null;
  runningBalanceCents: number;
  totals: WeekTotals;
};

export type DashboardWeekReference = {
  id: string;
  status: string;
};

export type DashboardWeekNavigation = {
  previous: DashboardWeekReference | null;
  next: DashboardWeekReference | null;
};

export type DashboardBaselineTotals = {
  monthlyTotalCents: number;
  weeklyAverageCents: number;
  projectedDailyBaseCents: number;
};

export type DashboardMetricMedians = {
  earningsCents: number;
  spendCents: number;
  cashflowCents: number;
};

export type DashboardAbilityPayPeriod = {
  adjacentWeekAbilityHours: number;
  adjacentWeekAbilityRegularHours: number;
  adjacentWeekAbilityOvertimeHours: number;
  adjacentWeekAbilityPaycheckCents: number;
  hasAdjacentWeek: boolean;
};

export type DashboardData = {
  todayIso: string;
  settings: PaySettings;
  week: DashboardWeek;
  weekNavigation: DashboardWeekNavigation;
  days: DashboardDay[];
  gasAverageDailyCents: number;
  customJobs: DashboardCustomJob[];
  // Built-in job keys ("ability" | "prestige" | "prestige_ilst") the user hid —
  // dropped from the job picker + net bar. Display only; history is unaffected.
  hiddenBuiltins: string[];
  baselineTotals: DashboardBaselineTotals;
  metricMedians: DashboardMetricMedians;
  abilityPayPeriod: DashboardAbilityPayPeriod;
  spendProjection: DashboardSpendProjection;
};

export type SaveState = "idle" | "saving" | "saved" | "error";
