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

// A one-time cost spread over a window (the dashboard "amortize this" feature).
// Contributes to daily fixed cost via amortized slices — shown here so the Fixed
// page matches the dashboard's Fixed breakdown one-to-one.
export type BaselineAmortizedExpense = {
  id: string;
  merchantName: string;
  originalAmountCents: number;
  startDate: string;
  endDate: string;
  periodDays: number;
  dailyCents: number; // nominal round(original / period)
  todaySliceCents: number; // exact cumulative-floor slice for today (0 if outside window)
  sourceTransactionId: string | null;
};

export type BaselineData = {
  todayIso: string;
  expenses: BaselineExpense[];
  totals: BaselineViewTotals;
  buckets: BaselineBucket[];
  amortizedExpenses: BaselineAmortizedExpense[];
  amortizedDailyTodayCents: number; // sum of today's slices (matches dashboard)
};
