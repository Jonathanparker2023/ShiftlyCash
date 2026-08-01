import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/domain/money";

type NumericValue = number | string | null;

type WeekRow = {
  start_date: string;
  display_week_number: NumericValue;
  status: string;
  running_balance: NumericValue;
  cashflow_total: NumericValue;
};

type DebtRow = {
  id: string;
  name: string;
  balance: NumericValue;
  status: string;
};

/** Primitives only — the client rebuilds the ladder as assumptions change. */
export type GoalsData = {
  weekLabel: string;
  todayIso: string;
  /** Cumulative cashflow banked this year: the pool that fills the ladder. */
  bankedCents: number;
  medianWeeklyCashflowCents: number;
  activeDebtCents: number;
  explorerCents: number;
  teslaCents: number;
};

export async function getGoalsData(): Promise<GoalsData> {
  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const [weeksRes, debtsRes] = await Promise.all([
    supabase
      .from("v_week_totals")
      .select(
        "start_date,display_week_number,status,running_balance,cashflow_total",
      )
      .eq("user_id", user.id)
      .order("start_date", { ascending: true }),
    supabase.from("debts").select("id,name,balance,status").eq("user_id", user.id),
  ]);

  if (weeksRes.error) {
    throw new Error(`Unable to load goal weeks: ${weeksRes.error.message}`);
  }
  if (debtsRes.error) {
    throw new Error(`Unable to load goal debts: ${debtsRes.error.message}`);
  }

  const weeks = (weeksRes.data ?? []) as WeekRow[];
  const latest = weeks.at(-1);
  const active = weeks.find((week) => week.status === "active") ?? latest;
  const weekNumber = Math.round(toNumber(active?.display_week_number ?? 0));
  const bankedCents = Math.max(
    0,
    dollarsToCents(toNumber(latest?.running_balance ?? 0)),
  );

  // Median of CLOSED weeks this year. Median rather than mean on purpose: one
  // $2,600 week should not drag the whole forecast optimistic.
  const year = (latest?.start_date ?? "2026-01-01").slice(0, 4);
  const medianWeeklyCashflowCents = median(
    weeks
      .filter(
        (week) => week.status !== "active" && week.start_date >= `${year}-01-01`,
      )
      .map((week) => dollarsToCents(toNumber(week.cashflow_total))),
  );

  const debts = ((debtsRes.data ?? []) as DebtRow[]).filter(
    (debt) => debt.status !== "paid",
  );
  const balanceOf = (pattern: RegExp) => {
    const match = debts.find((debt) => pattern.test(debt.name));
    return match ? dollarsToCents(toNumber(match.balance)) : 0;
  };

  return {
    weekLabel: weekNumber > 0 ? `Week ${weekNumber}` : "Current week",
    todayIso: new Date().toISOString().slice(0, 10),
    bankedCents,
    medianWeeklyCashflowCents,
    activeDebtCents: debts.reduce(
      (sum, debt) => sum + dollarsToCents(toNumber(debt.balance)),
      0,
    ),
    explorerCents: balanceOf(/explorer|holyoke/i),
    teslaCents: balanceOf(/tesla|td auto/i),
  };
}

function toNumber(value: NumericValue): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
