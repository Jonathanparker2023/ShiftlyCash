import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { getOptionalPlaidServerEnv } from "@/lib/env";
import { formatDayLabel } from "@/lib/dashboard/dates";
import { sortChronologicalTransactions } from "@/lib/dashboard/transactions";
import { dollarsToCents } from "@/lib/domain/money";
import { getDeployableBalance } from "@/lib/plaid/deployableBalance";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  BankingData,
  BankingDayOption,
  BankingPlaidItem,
  ChimeCapture,
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

type ChimeCaptureRow = {
  id: string;
  raw_title: string | null;
  raw_text: string;
  received_at: string;
  parsed_at: string | null;
  parsed_transaction_id: string | null;
  parse_failure_reason: string | null;
};

export async function getBankingData(): Promise<BankingData> {
  const { supabase, user } = await requireUserWithBootstrapStatus();
  const configResult = getOptionalPlaidServerEnv();
  const [
    { data: itemData, error: itemError },
    { data: pendingData, error: pendingError },
    { data: dayData, error: dayError },
    { data: chimeData, error: chimeError },
    liveBalance,
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
    supabase
      .from("chime_raw_captures")
      .select("id,raw_title,raw_text,received_at,parsed_at,parsed_transaction_id,parse_failure_reason")
      .eq("user_id", user.id)
      .order("received_at", { ascending: false }),
    getDeployableBalance({
      supabase: createAdminClient(),
      userId: user.id,
    }),
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
  if (chimeError) {
    throw new Error(`Unable to load Chime captures: ${chimeError.message}`);
  }

  return {
    config: {
      isConfigured: Boolean(configResult.config),
      missing: configResult.missing,
    },
    liveBalance: {
      availableCashCents: dollarsToCents(liveBalance.deployable_balance),
      asOf: liveBalance.as_of,
      hasFetched: liveBalance.has_fetched,
    },
    items: ((itemData ?? []) as PlaidItemMetadataRow[]).map(mapPlaidItem),
    pendingTransactions: sortChronologicalTransactions(
      ((pendingData ?? []) as PendingTransactionRow[]).map(mapPendingTransaction),
    ),
    dayOptions: ((dayData ?? []) as DayRow[]).map(mapDayOption),
    chimeCaptures: ((chimeData ?? []) as ChimeCaptureRow[]).map(mapChimeCapture),
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

function mapChimeCapture(row: ChimeCaptureRow): ChimeCapture {
  return {
    id: row.id,
    rawTitle: row.raw_title,
    rawText: row.raw_text,
    receivedAt: row.received_at,
    parsedAt: row.parsed_at,
    parsedTransactionId: row.parsed_transaction_id,
    parseFailureReason: row.parse_failure_reason,
  };
}

function toNumber(value: NumericValue): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
