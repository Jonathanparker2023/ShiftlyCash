import { NextResponse } from "next/server";

import { addDaysIso, getTodayIso } from "@/lib/dashboard/dates";
import { centsToDollars, dollarsToCents } from "@/lib/domain/money";
import { createAdminClient } from "@/lib/supabase/admin";

type NumericValue = number | string | null;

type DebtRow = {
  id: string;
  name: string;
  balance: NumericValue;
  minimum_payment: NumericValue;
  apr: NumericValue;
  status: "active" | "paid";
};

type AssetRow = {
  id: string;
  name: string;
  value: NumericValue;
  category: string;
};

type WeekTotalRow = {
  start_date: string;
  status: string;
  earnings_total: NumericValue;
  ability_paycheck_earnings: NumericValue;
  prestige_paycheck_earnings: NumericValue;
  cashflow_total: NumericValue;
};

const LEDGER_TOKEN_ENV = "SHIFTLYCASH_LEDGER_TOKEN";
const LEDGER_USER_ID_ENV = "SHIFTLYCASH_LEDGER_USER_ID";

export async function GET(request: Request) {
  const authResult = authorizeLedgerRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const supabase = createAdminClient();
    const userId = await resolveLedgerUserId(supabase);
    const [debtsRes, assetsRes, weeksRes] = await Promise.all([
      supabase
        .from("debts")
        .select("id,name,balance,minimum_payment,apr,status")
        .eq("user_id", userId)
        .eq("status", "active")
        .gt("balance", 0)
        .order("priority_order", { ascending: true }),
      supabase
        .from("assets")
        .select("id,name,value,category")
        .eq("user_id", userId)
        .order("name", { ascending: true }),
      supabase
        .from("v_week_totals")
        .select(
          "start_date,status,earnings_total,ability_paycheck_earnings,prestige_paycheck_earnings,cashflow_total",
        )
        .eq("user_id", userId)
        .order("start_date", { ascending: true }),
    ]);

    if (debtsRes.error) throw new Error(`Debts: ${debtsRes.error.message}`);
    if (assetsRes.error) throw new Error(`Assets: ${assetsRes.error.message}`);
    if (weeksRes.error) throw new Error(`Weeks: ${weeksRes.error.message}`);

    const weeks = (weeksRes.data ?? []) as WeekTotalRow[];
    const activeWeek =
      weeks.find((week) => week.status === "active") ?? weeks.at(-1) ?? null;
    const weekOf = mondayOnOrBeforeIso(getTodayIso());
    const activeCashflowCents = dollarsToCents(
      toNumber(activeWeek?.cashflow_total ?? 0),
    );
    const activePayPeriodCents = dollarsToCents(
      toNumber(activeWeek?.ability_paycheck_earnings ?? 0) +
        toNumber(activeWeek?.prestige_paycheck_earnings ?? 0),
    );
    const ytdDeployableCents = weeks.reduce(
      (sum, week) => sum + dollarsToCents(toNumber(week.cashflow_total)),
      0,
    );
    const closedCashflowCents = weeks
      .filter((week) => week.status === "closed")
      .map((week) => dollarsToCents(toNumber(week.cashflow_total)));
    const targetWeeklyDeployableCents =
      closedCashflowCents.length > 0
        ? Math.round(
            closedCashflowCents.reduce((sum, value) => sum + value, 0) /
              closedCashflowCents.length,
          )
        : activeCashflowCents;

    return NextResponse.json({
      as_of: new Date().toISOString(),
      week_of: weekOf,
      debts: ((debtsRes.data ?? []) as DebtRow[]).map(mapDebt),
      accounts: mapAccounts((assetsRes.data ?? []) as AssetRow[]),
      cashflow: {
        week_start: activeWeek?.start_date ?? weekOf,
        actual_deployable_this_week: money(activeCashflowCents),
        target_weekly_deployable: money(targetWeeklyDeployableCents),
        current_pay_period_total: money(activePayPeriodCents),
        ytd_deployable_actual: money(ytdDeployableCents),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ledger export failed." },
      { status: 500 },
    );
  }
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;

function authorizeLedgerRequest(
  request: Request,
):
  | { ok: true }
  | { ok: false; response: NextResponse<{ error: string }> } {
  const token = process.env[LEDGER_TOKEN_ENV];

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${LEDGER_TOKEN_ENV} is not configured.` },
        { status: 500 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (provided !== token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}

async function resolveLedgerUserId(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const configuredUserId = process.env[LEDGER_USER_ID_ENV];

  if (configuredUserId) {
    return configuredUserId;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data?.id) {
    throw new Error(`Unable to resolve ledger user: ${error?.message ?? "missing profile"}`);
  }

  return data.id as string;
}

function methodNotAllowed() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

function mapDebt(row: DebtRow) {
  const balanceCents = dollarsToCents(toNumber(row.balance));

  return {
    id: row.id,
    type: inferDebtType(row.name),
    balance: money(balanceCents),
    apr: round2(toNumber(row.apr) * 100),
    minimum_payment: money(dollarsToCents(toNumber(row.minimum_payment))),
    minimum_due_date: null,
    status: row.status,
    starting_balance: money(balanceCents),
  };
}

function mapAccounts(assets: AssetRow[]) {
  const emergencyCents = findAssetValue(assets, ["emergency", "cushion"]);
  const propertyCents = findAssetValue(assets, ["property", "fund"]);

  return [
    {
      id: "emergency_cushion",
      label: "Emergency cushion",
      balance: money(emergencyCents),
    },
    {
      id: "property_fund",
      label: "Property fund",
      balance: money(propertyCents),
    },
  ];
}

function findAssetValue(assets: AssetRow[], needles: string[]): number {
  const asset = assets.find((item) => {
    const name = item.name.toLowerCase();
    return needles.some((needle) => name.includes(needle));
  });

  return dollarsToCents(toNumber(asset?.value ?? 0));
}

function inferDebtType(name: string): "auto_loan" | "credit_card" | "debt" {
  const normalized = name.toLowerCase();

  if (normalized.includes("auto") || normalized.includes("loan")) {
    return "auto_loan";
  }

  if (
    normalized.includes("card") ||
    normalized.includes("capital") ||
    normalized.includes("best buy") ||
    normalized.includes("aspire") ||
    normalized.includes("fortiva") ||
    normalized.includes("mission lane")
  ) {
    return "credit_card";
  }

  return "debt";
}

function mondayOnOrBeforeIso(todayIso: string): string {
  const date = new Date(`${todayIso}T00:00:00.000Z`);
  const dayIndex = date.getUTCDay();
  const daysSinceMonday = (dayIndex + 6) % 7;
  return addDaysIso(todayIso, -daysSinceMonday);
}

function money(cents: number): number {
  return round2(centsToDollars(cents));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: NumericValue): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
