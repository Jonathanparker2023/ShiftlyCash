export type BaselineExpense = {
  id: string;
  name: string;
  amountCents: number;
  withdrawalDay: number | null;
  expirationDate: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type BaselineViewTotals = {
  monthlyTotalCents: number;
  weeklyAverageCents: number;
  projectedDailyBaseCents: number;
};

export type BaselineBucketItem = {
  id: string;
  itemIndex: number;
  label: string;
  amountCents: number; // SIGNED: a return is negative
};

export type BaselineBucket = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  periodDays: number;
  status: "active" | "archived";
  items: BaselineBucketItem[];
  totalCents: number; // sum of items (signed)
  dailyRateCents: number; // round(total / periodDays) — the display rate
};

export type BaselineData = {
  todayIso: string;
  expenses: BaselineExpense[];
  totals: BaselineViewTotals;
  buckets: BaselineBucket[];
};
