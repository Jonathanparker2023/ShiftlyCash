import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { getOptionalPlaidServerEnv } from "@/lib/env";
import { formatDayLabel } from "@/lib/dashboard/dates";
import { sortChronologicalTransactions } from "@/lib/dashboard/transactions";
import { dollarsToCents } from "@/lib/domain/money";
import type {
  BankingData,
  BankingDayOption,
  BankingPlaidItem,
  PendingTransaction,
} from "@/lib/banking/types";

type NumericValue = number | string | null;

type PlaidItemMetadataRow = {
  id: string;
  plaid_item_id: string | null;
  institution_name: string | null;
  status: "active" | "login_required" | "error";
  last_synced_at: string | null;
};

type PendingTransactionRow = {
  id: string;
  day_id: string | null;
  date: string;
  datetime: string | null;
  legacy_time: string | null;
  created_at: string;
  merchant_name: string;
  amount: NumericValue;
  source: string;
  review_reason: string | null;
};

type DayRow = {
  id: string;
  date: string;
  day_index: number;
};

export async function getBankingData(): Promise<BankingData> {
  const { supabase, user } = await requireUserWithBootstrapStatus();
  const configResult = getOptionalPlaidServerEnv();
  const [
    { data: itemData, error: itemError },
    { data: pendingData, error: pendingError },
    { data: dayData, error: dayError },
  ] = await Promise.all([
    supabase
      .from("plaid_item_metadata")
      .select("id,plaid_item_id,institution_name,status,last_synced_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("transactions")
      .select(
        "id,day_id,date,datetime,legacy_time,created_at,merchant_name,amount,source,review_reason",
      )
      .eq("user_id", user.id)
      .eq("status", "pending_review")
      .order("date", { ascending: true })
      .order("datetime", { ascending: true, nullsFirst: false })
      .order("legacy_time", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("days")
      .select("id,date,day_index")
      .eq("user_id", user.id)
      .order("date", { ascending: false }),
  ]);

  if (itemError) {
    throw new Error(`Unable to load Plaid items: ${itemError.message}`);
  }
  if (pendingError) {
    throw new Error(`Unable to load pending transactions: ${pendingError.message}`);
  }
  if (dayError) {
    throw new Error(`Unable to load day options: ${dayError.message}`);
  }

  return {
    config: {
      isConfigured: Boolean(configResult.config),
      missing: configResult.missing,
    },
    items: ((itemData ?? []) as PlaidItemMetadataRow[]).map(mapPlaidItem),
    pendingTransactions: sortChronologicalTransactions(
      ((pendingData ?? []) as PendingTransactionRow[]).map(mapPendingTransaction),
    ),
    dayOptions: ((dayData ?? []) as DayRow[]).map(mapDayOption),
  };
}

function mapPlaidItem(row: PlaidItemMetadataRow): BankingPlaidItem {
  return {
    id: row.id,
    plaidItemId: row.plaid_item_id,
    institutionName: row.institution_name,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
  };
}

function mapPendingTransaction(row: PendingTransactionRow): PendingTransaction {
  return {
    id: row.id,
    date: row.date,
    time: row.datetime ?? row.legacy_time,
    createdAt: row.created_at,
    merchantName: row.merchant_name,
    amountCents: dollarsToCents(toNumber(row.amount)),
    source: row.source,
    status: "pending_review",
    reviewReason: row.review_reason,
    dayId: row.day_id,
  };
}

function mapDayOption(row: DayRow): BankingDayOption {
  return {
    id: row.id,
    date: row.date,
    label: formatDayLabel(row.date),
  };
}

function toNumber(value: NumericValue): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
