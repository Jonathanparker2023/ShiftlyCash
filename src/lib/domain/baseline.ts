import { dollarsToCents, type MoneyCents } from "@/lib/domain/money";

export const WEEKS_PER_MONTH = 4.33;

export type BaselineExpenseInput = {
  amountCents: MoneyCents;
  expirationDate: string | null;
  isActive: boolean;
};

export type BaselineTotals = {
  monthlyTotalCents: MoneyCents;
  weeklyAverageCents: MoneyCents;
  projectedDailyBaseCents: MoneyCents;
};

export function isExpenseExpired(
  expirationDate: string | null,
  todayIso: string,
): boolean {
  return Boolean(expirationDate && expirationDate < todayIso);
}

export function isExpenseVisible(
  expense: Pick<BaselineExpenseInput, "expirationDate" | "isActive">,
  todayIso: string,
): boolean {
  return expense.isActive && !isExpenseExpired(expense.expirationDate, todayIso);
}

export function calculateBaselineTotals(
  expenses: BaselineExpenseInput[],
  todayIso: string,
): BaselineTotals {
  const monthlyTotalCents = expenses
    .filter((expense) => isExpenseVisible(expense, todayIso))
    .reduce((sum, expense) => sum + expense.amountCents, 0);
  const weeklyAverageCents = Math.round(monthlyTotalCents / WEEKS_PER_MONTH);
  const projectedDailyBaseCents = Math.round(weeklyAverageCents / 7);

  return {
    monthlyTotalCents,
    weeklyAverageCents,
    projectedDailyBaseCents,
  };
}

export function parseMonthlyAmountToCents(value: number): MoneyCents {
  return dollarsToCents(Math.max(0, value));
}
