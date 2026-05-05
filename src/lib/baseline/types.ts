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

export type BaselineData = {
  todayIso: string;
  expenses: BaselineExpense[];
  totals: BaselineViewTotals;
};
