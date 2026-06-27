import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/domain/money";

type NumericValue = number | string | null;

type WeekBalanceRow = {
  running_balance: NumericValue;
  display_week_number: NumericValue;
  start_date: string;
  end_date: string;
  status: string;
};

type DebtRow = {
  id: string;
  name: string;
  balance: NumericValue;
  status: string;
};

export type GoalKind = "balance_threshold" | "debt_clear";

export type GoalStatus = "locked" | "in_progress" | "unlocked";

export type Goal = {
  id: string;
  title: string;
  kicker: string;
  description: string;
  kind: GoalKind;
  currentCents: number;
  targetCents: number;
  remainingCents: number;
  progress: number;
  status: GoalStatus;
  accent: "brand" | "positive" | "warning" | "negative";
  unlockCopy: string;
};

export type GoalsData = {
  runningBalanceCents: number;
  activeDebtCents: number;
  weekLabel: string;
  goals: Goal[];
  timeline: Array<{
    id: string;
    title: string;
    caption: string;
    status: GoalStatus;
  }>;
};

const BALANCE_GOALS = [
  {
    id: "porsche-cayman-gts",
    title: "Porsche Cayman GTS",
    kicker: "Dream car",
    description: "Unlocked when running balance clears the Cayman threshold.",
    targetCents: 100_000_00,
    accent: "brand" as const,
    unlockCopy: "Cayman threshold unlocked",
  },
  {
    id: "four-family-brrr",
    title: "4-family BRRR",
    kicker: "Dream house",
    description: "Down payment, reserves, and rehab runway for the first BRRR move.",
    targetCents: 150_000_00,
    accent: "positive" as const,
    unlockCopy: "BRRR war chest unlocked",
  },
] as const;

export async function getGoalsData(): Promise<GoalsData> {
  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const [activeWeekRes, latestWeekRes, debtsRes] = await Promise.all([
    supabase
      .from("v_week_totals")
      .select("running_balance,display_week_number,start_date,end_date,status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("v_week_totals")
      .select("running_balance,display_week_number,start_date,end_date,status")
      .eq("user_id", user.id)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("debts")
      .select("id,name,balance,status")
      .eq("user_id", user.id),
  ]);

  if (activeWeekRes.error) {
    throw new Error(`Unable to load active running balance: ${activeWeekRes.error.message}`);
  }
  if (latestWeekRes.error) {
    throw new Error(`Unable to load latest running balance: ${latestWeekRes.error.message}`);
  }
  if (debtsRes.error) {
    throw new Error(`Unable to load goal debts: ${debtsRes.error.message}`);
  }

  const weekRow = (activeWeekRes.data ?? latestWeekRes.data) as WeekBalanceRow | null;
  const runningBalanceCents = dollarsToCents(toNumber(weekRow?.running_balance ?? 0));
  const weekNumber = Math.round(toNumber(weekRow?.display_week_number ?? 0));
  const debts = ((debtsRes.data ?? []) as DebtRow[]).filter(
    (debt) => debt.status !== "paid",
  );
  const activeDebtCents = debts.reduce(
    (sum, debt) => sum + dollarsToCents(toNumber(debt.balance)),
    0,
  );
  const explorerDebt = debts.find((debt) =>
    /ford|explorer/i.test(debt.name),
  );
  const explorerDebtCents = explorerDebt
    ? dollarsToCents(toNumber(explorerDebt.balance))
    : activeDebtCents;

  const balanceGoals: Goal[] = BALANCE_GOALS.map((goal) =>
    mapBalanceGoal(goal, runningBalanceCents),
  );
  const explorerGoal = mapDebtGoal({
    currentDebtCents: explorerDebtCents,
    label: explorerDebt?.name ?? "Ford Explorer debt",
  });
  const goals = [...balanceGoals, explorerGoal];

  return {
    runningBalanceCents,
    activeDebtCents,
    weekLabel: weekNumber > 0 ? `Week ${weekNumber}` : "Current week",
    goals,
    timeline: goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      caption:
        goal.kind === "debt_clear"
          ? `${formatShortMoney(goal.remainingCents)} remaining`
          : `${formatShortMoney(goal.targetCents)} threshold`,
      status: goal.status,
    })),
  };
}

function mapBalanceGoal(
  goal: (typeof BALANCE_GOALS)[number],
  runningBalanceCents: number,
): Goal {
  const remainingCents = Math.max(0, goal.targetCents - runningBalanceCents);
  const progress = clamp01(runningBalanceCents / goal.targetCents);

  return {
    ...goal,
    kind: "balance_threshold",
    currentCents: runningBalanceCents,
    remainingCents,
    progress,
    status: progress >= 1 ? "unlocked" : progress > 0 ? "in_progress" : "locked",
  };
}

function mapDebtGoal({
  currentDebtCents,
  label,
}: {
  currentDebtCents: number;
  label: string;
}): Goal {
  const isClear = currentDebtCents <= 0;

  return {
    id: "ford-explorer-payoff",
    title: "Ford Explorer",
    kicker: "Debt payoff",
    description: `${label} clears when the debt balance hits zero.`,
    kind: "debt_clear",
    currentCents: Math.max(0, currentDebtCents),
    targetCents: 0,
    remainingCents: Math.max(0, currentDebtCents),
    progress: isClear ? 1 : 0,
    status: isClear ? "unlocked" : "in_progress",
    accent: isClear ? "positive" : "negative",
    unlockCopy: "Explorer debt cleared",
  };
}

function toNumber(value: NumericValue): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function formatShortMoney(cents: number): string {
  const absolute = Math.abs(cents);

  if (absolute >= 100_000_000) {
    return `$${(cents / 100_000_000).toFixed(1)}M`;
  }

  if (absolute >= 1_000_00) {
    return `$${Math.round(cents / 100_000)}K`;
  }

  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}
