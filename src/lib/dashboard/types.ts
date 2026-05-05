import type {
  DayTotals,
  EarnSlotInput,
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
  category: string | null;
  source: DashboardTransactionSource;
  status: DashboardTransactionStatus;
  date: string;
  time: string | null;
  createdAt: string;
};

export type DashboardSlot = EarnSlotInput & {
  id: string | null;
  dayId: string;
  slotIndex: number;
  hoursOrUnits: number;
  label: string;
  source: EarnSlotSource;
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
  spendLocked: boolean;
  totals: DayTotals;
  slots: DashboardSlot[];
  appliedTransactions: DashboardTransaction[];
  excludedTransactions: DashboardTransaction[];
};

export type DashboardWeek = {
  id: string;
  startDate: string;
  endDate: string;
  displayWeekNumber: number;
  payPeriodRole: "week_1" | "week_2";
  paycheckDueDate: string | null;
  runningBalanceCents: number;
  totals: WeekTotals;
};

export type DashboardBaselineTotals = {
  monthlyTotalCents: number;
  weeklyAverageCents: number;
  projectedDailyBaseCents: number;
};

export type DashboardData = {
  todayIso: string;
  settings: PaySettings;
  week: DashboardWeek;
  days: DashboardDay[];
  baselineTotals: DashboardBaselineTotals;
};

export type SaveState = "idle" | "saving" | "saved" | "error";
