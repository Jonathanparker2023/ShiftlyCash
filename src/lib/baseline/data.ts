import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { getTodayIso } from "@/lib/dashboard/dates";
import type {
  BaselineData,
  BaselineExpense,
  BaselineViewTotals,
} from "@/lib/baseline/types";
import { dollarsToCents } from "@/lib/domain/money";

type NumericValue = number | string | null;

type ExpenseRow = {
  id: string;
  name: string;
  amount: NumericValue;
  withdrawal_day: number | null;
  expiration_date: string | null;
  is_active: boolean;
  sort_order: number;
};

type ExpenseTotalRow = {
  monthly_total: NumericValue;
  weekly_average: NumericValue;
  projected_daily_base: NumericValue;
};

export async function getBaselineData(): Promise<BaselineData> {
  const { supabase, user } = await requireUserWithBootstrapStatus();
  const [
    { data: expenseData, error: expenseError },
    { data: totalData, error: totalError },
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select("id,name,amount,withdrawal_day,expiration_date,is_active,sort_order")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("v_active_expense_totals")
      .select("monthly_total,weekly_average,projected_daily_base")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (expenseError) {
    throw new Error(`Unable to load expenses: ${expenseError.message}`);
  }

  if (totalError) {
    throw new Error(`Unable to load baseline totals: ${totalError.message}`);
  }

  return {
    todayIso: getTodayIso(),
    expenses: ((expenseData ?? []) as ExpenseRow[]).map(mapExpenseRow),
    totals: mapExpenseTotals(totalData as ExpenseTotalRow | null),
  };
}

function mapExpenseRow(row: ExpenseRow): BaselineExpense {
  return {
    id: row.id,
    name: row.name,
    amountCents: dollarsToCents(toNumber(row.amount)),
    withdrawalDay: row.withdrawal_day,
    expirationDate: row.expiration_date,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

function mapExpenseTotals(row: ExpenseTotalRow | null): BaselineViewTotals {
  return {
    monthlyTotalCents: dollarsToCents(toNumber(row?.monthly_total ?? 0)),
    weeklyAverageCents: dollarsToCents(toNumber(row?.weekly_average ?? 0)),
    projectedDailyBaseCents: dollarsToCents(
      toNumber(row?.projected_daily_base ?? 0),
    ),
  };
}

function toNumber(value: NumericValue): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
