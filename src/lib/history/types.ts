import type { JobType, PayType } from "@/lib/domain/pay";

export type ProjectionExclusionField = "earnings" | "spend" | "cashflow";

export type HistoryWeek = {
  id: string;
  startDate: string;
  endDate: string;
  displayWeekNumber: number;
  status: "active" | "closed";
  archivedAt: string | null;
  earningsCents: number;
  spendCents: number;
  baseCents: number;
  cashflowCents: number;
  runningBalanceCents: number;
  exclusions: {
    earnings: boolean;
    spend: boolean;
    cashflow: boolean;
  };
};

export type HistoryData = {
  weeks: HistoryWeek[];
};

export type HistoryDetailSlot = {
  id: string;
  slotIndex: number;
  jobType: JobType;
  payType: PayType;
  hoursOrUnits: number;
  regularHours: number;
  overtimeHours: number;
  computedEarningsCents: number;
  label: string;
  source: string;
};

export type HistoryDetailTransaction = {
  id: string;
  date: string;
  time: string | null;
  createdAt: string;
  merchantName: string;
  amountCents: number;
  source: string;
  status: string;
  category: string | null;
};

export type HistoryDetailDay = {
  id: string;
  date: string;
  dayIndex: number;
  label: string;
  spendLocked: boolean;
  baseCents: number;
  manualSpendCents: number;
  transactionSpendCents: number;
  earningsCents: number;
  spendCents: number;
  cashflowCents: number;
  slots: HistoryDetailSlot[];
  transactions: HistoryDetailTransaction[];
};

export type SnapshotSummary = {
  id: string;
  snapshotType: string;
  createdAt: string;
  dayCount: number;
  earnSlotCount: number;
  transactionCount: number;
  payloadJson: string;
};

export type HistoryDetailData = {
  week: HistoryWeek;
  days: HistoryDetailDay[];
  snapshots: SnapshotSummary[];
};
