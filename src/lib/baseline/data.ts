import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { mark, since, timed } from "@/lib/perf";
import { getTodayIso } from "@/lib/dashboard/dates";
import type {
  BaselineAmortizedExpense,
  BaselineBucket,
  BaselineBucketItem,
  BaselineData,
  BaselineExpense,
  BaselineViewTotals,
} from "@/lib/baseline/types";
import { dollarsToCents } from "@/lib/domain/money";

type NumericValue = number | string | null;

type AmortizedExpenseRow = {
  id: string;
  merchant_name: string;
  original_amount_cents: NumericValue;
  start_date: string;
  end_date: string;
  period_days: NumericValue;
  source_transaction_id: string | null;
};

type BucketRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  period_days: NumericValue;
  status: string;
};

type BucketItemRow = {
  id: string;
  bucket_id: string;
  item_index: number;
  label: string;
  amount_cents: NumericValue;
};

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
  const tTotal = mark();
  const { supabase, user } = await timed("baseline:auth", () =>
    requireUserWithBootstrapStatus(),
  );
  const tBatch = mark();
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
  since("baseline:reads", tBatch);

  if (expenseError) {
    throw new Error(`Unable to load expenses: ${expenseError.message}`);
  }

  if (totalError) {
    throw new Error(`Unable to load baseline totals: ${totalError.message}`);
  }

  // Amortized Income buckets + items. Soft-fail: pre-migration the tables are
  // absent and the Fixed page still renders, just without the income section.
  let buckets: BaselineBucket[] = [];
  const [
    { data: bucketData, error: bucketError },
    { data: itemData, error: itemError },
  ] = await Promise.all([
    supabase
      .from("amortization_bucket")
      .select("id,name,start_date,end_date,period_days,status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("amortization_item")
      .select("id,bucket_id,item_index,label,amount_cents")
      .eq("user_id", user.id)
      .order("item_index", { ascending: true }),
  ]);
  if (bucketError || itemError) {
    console.warn(
      `[baseline] amortization buckets unavailable: ${(bucketError ?? itemError)?.message}`,
    );
  } else {
    buckets = assembleBuckets(
      (bucketData ?? []) as BucketRow[],
      (itemData ?? []) as BucketItemRow[],
    );
  }

  // Amortized expenses (one-time costs spread over a window — the dashboard
  // "amortize this" feature). Shown so the Fixed page matches the dashboard's
  // Fixed breakdown. Soft-fail like the buckets above.
  const todayIso = getTodayIso();
  let amortizedExpenses: BaselineAmortizedExpense[] = [];
  const { data: amortData, error: amortError } = await supabase
    .from("amortized_expenses")
    .select(
      "id,merchant_name,original_amount_cents,start_date,end_date,period_days,source_transaction_id",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("start_date", { ascending: true });
  if (amortError) {
    console.warn(`[baseline] amortized expenses unavailable: ${amortError.message}`);
  } else {
    amortizedExpenses = ((amortData ?? []) as AmortizedExpenseRow[]).map((row) =>
      mapAmortizedExpenseRow(row, todayIso),
    );
  }
  const amortizedDailyTodayCents = amortizedExpenses.reduce(
    (sum, expense) => sum + expense.todaySliceCents,
    0,
  );

  // The canonical daily fixed for today, read from the SAME view the dashboard
  // uses (v_day_totals). This is the single source of truth for the headline
  // number — it cannot disagree with the dashboard because it IS the dashboard's
  // value. Soft-fail to null (then the page falls back to the component sum).
  let dailyFixedTodayCents: number | null = null;
  const { data: todayTotalData, error: todayTotalError } = await supabase
    .from("v_day_totals")
    .select("base_amount")
    .eq("user_id", user.id)
    .eq("date", todayIso)
    .maybeSingle();
  if (todayTotalError) {
    console.warn(
      `[baseline] today fixed total unavailable: ${todayTotalError.message}`,
    );
  } else if (todayTotalData) {
    dailyFixedTodayCents = dollarsToCents(
      toNumber((todayTotalData as { base_amount: NumericValue }).base_amount),
    );
  }

  const result = {
    todayIso,
    expenses: ((expenseData ?? []) as ExpenseRow[]).map(mapExpenseRow),
    totals: mapExpenseTotals(totalData as ExpenseTotalRow | null),
    buckets,
    amortizedExpenses,
    amortizedDailyTodayCents,
    dailyFixedTodayCents,
  };
  since("baseline:total", tTotal);
  return result;
}

// Exact cumulative-floor slice for today, matching the dashboard's
// v_day_amortization / v_day_base_allocations math. 0 if today is outside the
// [start, end] window.
function mapAmortizedExpenseRow(
  row: AmortizedExpenseRow,
  todayIso: string,
): BaselineAmortizedExpense {
  const originalAmountCents = Math.round(toNumber(row.original_amount_cents));
  const periodDays = Math.max(1, Math.round(toNumber(row.period_days)));
  const startMs = Date.parse(`${row.start_date}T00:00:00Z`);
  const endMs = Date.parse(`${row.end_date}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  let todaySliceCents = 0;
  if (todayMs >= startMs && todayMs <= endMs) {
    const k = Math.round((todayMs - startMs) / 86_400_000);
    todaySliceCents =
      Math.floor((originalAmountCents * (k + 1)) / periodDays) -
      Math.floor((originalAmountCents * k) / periodDays);
  }
  return {
    id: row.id,
    merchantName: row.merchant_name,
    originalAmountCents,
    startDate: row.start_date,
    endDate: row.end_date,
    periodDays,
    dailyCents: Math.round(originalAmountCents / periodDays),
    todaySliceCents,
    sourceTransactionId: row.source_transaction_id,
  };
}

function assembleBuckets(
  bucketRows: BucketRow[],
  itemRows: BucketItemRow[],
): BaselineBucket[] {
  const itemsByBucket = new Map<string, BaselineBucketItem[]>();
  for (const row of itemRows) {
    const list = itemsByBucket.get(row.bucket_id) ?? [];
    list.push({
      id: row.id,
      itemIndex: row.item_index,
      label: row.label,
      amountCents: Math.round(toNumber(row.amount_cents)),
    });
    itemsByBucket.set(row.bucket_id, list);
  }

  return bucketRows.map((row) => {
    const items = (itemsByBucket.get(row.id) ?? []).sort(
      (a, b) => a.itemIndex - b.itemIndex,
    );
    const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
    const periodDays = Math.max(1, Math.round(toNumber(row.period_days)));
    return {
      id: row.id,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      periodDays,
      status: row.status === "archived" ? "archived" : "active",
      items,
      totalCents,
      dailyRateCents: Math.round(totalCents / periodDays),
    };
  });
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
