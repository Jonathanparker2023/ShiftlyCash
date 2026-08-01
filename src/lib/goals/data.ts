import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/domain/money";
import type { DebtBalance, GoalRungRecord, TargetKind } from "@/lib/goals/ladder";
import { getProjectionCashBalance } from "@/lib/plaid/projectionCash";
import { createAdminClient } from "@/lib/supabase/admin";

type NumericValue = number | string | null;

type WeekRow = {
  start_date: string;
  display_week_number: NumericValue;
  status: string;
  cashflow_total: NumericValue;
};

type DebtRow = {
  name: string;
  balance: NumericValue;
  status: string;
};

type RungRow = {
  id: string;
  order_index: number;
  title: string;
  kicker: string;
  description: string;
  image_src: string | null;
  target_kind: string;
  target_cents: NumericValue;
  debt_match: string | null;
  deadline_on: string | null;
  deadline_label: string | null;
};

export type GoalsData = {
  weekLabel: string;
  todayIso: string;
  medianWeeklyCashflowCents: number;
  /** Live Plaid checking + savings, the same figure the Debt page shows. */
  availableCashCents: number;
  cashBalanceSource: "plaid" | "cache" | "unavailable";
  cashBalanceStale: boolean;
  debts: DebtBalance[];
  rungs: GoalRungRecord[];
};

export async function getGoalsData(): Promise<GoalsData> {
  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const [weeksRes, debtsRes, rungsRes, cashBalance] = await Promise.all([
    supabase
      .from("v_week_totals")
      .select("start_date,display_week_number,status,cashflow_total")
      .eq("user_id", user.id)
      .order("start_date", { ascending: true }),
    supabase.from("debts").select("name,balance,status").eq("user_id", user.id),
    supabase
      .from("goal_rungs")
      .select(
        "id,order_index,title,kicker,description,image_src,target_kind,target_cents,debt_match,deadline_on,deadline_label",
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("order_index", { ascending: true }),
    // Same source the Debt page reads, so the two pages can never disagree
    // about how much cash is actually on hand.
    getProjectionCashBalance({
      supabase: createAdminClient(),
      userId: user.id,
    }),
  ]);

  if (weeksRes.error) {
    throw new Error(`Unable to load goal weeks: ${weeksRes.error.message}`);
  }
  if (debtsRes.error) {
    throw new Error(`Unable to load goal debts: ${debtsRes.error.message}`);
  }
  if (rungsRes.error) {
    throw new Error(`Unable to load goal rungs: ${rungsRes.error.message}`);
  }

  const weeks = (weeksRes.data ?? []) as WeekRow[];
  const latest = weeks.at(-1);
  const active = weeks.find((week) => week.status === "active") ?? latest;
  const weekNumber = Math.round(toNumber(active?.display_week_number ?? 0));

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

  const debts = ((debtsRes.data ?? []) as DebtRow[])
    .filter((debt) => debt.status !== "paid")
    .map((debt) => ({
      name: debt.name,
      cents: dollarsToCents(toNumber(debt.balance)),
    }));

  const rungs: GoalRungRecord[] = ((rungsRes.data ?? []) as RungRow[]).map(
    (row) => ({
      id: row.id,
      orderIndex: row.order_index,
      title: row.title,
      kicker: row.kicker,
      description: row.description,
      imageSrc: row.image_src,
      targetKind: row.target_kind as TargetKind,
      targetCents: Math.round(toNumber(row.target_cents)),
      debtMatch: row.debt_match,
      deadlineOn: row.deadline_on,
      deadlineLabel: row.deadline_label,
    }),
  );

  return {
    weekLabel: weekNumber > 0 ? `Week ${weekNumber}` : "Current week",
    todayIso: new Date().toISOString().slice(0, 10),
    medianWeeklyCashflowCents,
    availableCashCents: Math.max(0, cashBalance.availableCashCents),
    cashBalanceSource: cashBalance.source,
    cashBalanceStale: cashBalance.stale,
    debts,
    rungs,
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
