"use server";

import { revalidatePath } from "next/cache";
import type { Transaction } from "plaid";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireUser } from "@/lib/auth";
import { addDaysIso } from "@/lib/dashboard/dates";
import { getOptionalSupabaseServiceRoleKey, getPlaidServerEnv } from "@/lib/env";
import { getPlaidClient, toPlaidCountryCodes, toPlaidProducts } from "@/lib/plaid/client";
import { decryptAccessToken, encryptAccessToken } from "@/lib/plaid/crypto";
import { isPlaidLoginRequiredError } from "@/lib/plaid/errors";
import { isLikelyUglyMerchantName, resolveMerchantName } from "@/lib/domain/merchant-ai";
import {
  isAutoLoanCashflowOnly,
  isLegacyExempt,
} from "@/lib/domain/legacyRules";
import { createAdminClient } from "@/lib/supabase/admin";

export type CreateLinkTokenResult = {
  ok: true;
  linkToken: string;
};

export type ExchangePublicTokenInput = {
  publicToken: string;
  institutionName: string | null;
};

export type ExchangePublicTokenResult = {
  ok: true;
  itemId: string;
};

export type SyncTransactionsResult = {
  ok: true;
  added: number;
  modified: number;
  removed: number;
  normalized: number;
};

export type ApplyPendingTransactionInput = {
  transactionId: string;
  dayId: string;
};

export type ExcludePendingTransactionInput = {
  transactionId: string;
};

export type ExcludeOldNoMatchResult = {
  ok: true;
  excludedCount: number;
};

export type CleanUglyMerchantNamesResult = {
  ok: true;
  scannedCount: number;
  cleanedCount: number;
};

type ServerPlaidItem = {
  id: string;
  plaid_item_id: string | null;
  access_token_encrypted: string | null;
  cursor: string | null;
  institution_name: string | null;
  status: "active" | "login_required" | "error";
};

type DayMatch = {
  id: string;
  spend_locked: boolean;
};

type ActiveWeekRange = {
  start_date: string;
  end_date: string;
};

type CurrentWeekTransaction = {
  id: string;
  merchant_name: string | null;
  raw_name: string | null;
};

export async function createLinkTokenAction(): Promise<CreateLinkTokenResult> {
  const { user } = await requireUser();
  const config = getPlaidServerEnv();
  const client = getPlaidClient();
  const response = await client.linkTokenCreate({
    client_name: "Bashflow",
    country_codes: toPlaidCountryCodes(config),
    language: "en",
    products: toPlaidProducts(config),
    transactions: {
      days_requested: 30,
    },
    user: {
      client_user_id: user.id,
    },
    webhook: process.env.PLAID_WEBHOOK_URL || undefined,
  });

  return {
    ok: true,
    linkToken: response.data.link_token,
  };
}

export async function exchangePublicTokenAction(
  input: ExchangePublicTokenInput,
): Promise<ExchangePublicTokenResult> {
  const { supabase } = await requireUser();
  const config = getPlaidServerEnv();
  const publicToken = input.publicToken.trim();

  if (!publicToken) {
    throw new Error("Missing Plaid public token.");
  }

  const client = getPlaidClient();
  const response = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });
  const encryptedAccessToken = encryptAccessToken(
    response.data.access_token,
    config.tokenEncryptionKey,
  );
  const { data, error } = await supabase.rpc("upsert_plaid_item_from_server", {
    p_plaid_item_id: response.data.item_id,
    p_access_token_encrypted: encryptedAccessToken,
    p_institution_name: input.institutionName,
    p_status: "active",
  });

  if (error) {
    throw new Error(`Unable to store Plaid item: ${error.message}`);
  }

  if (typeof data !== "string") {
    throw new Error("Plaid item RPC did not return an item id.");
  }

  revalidatePath("/banking");

  return {
    ok: true,
    itemId: data,
  };
}

export async function syncTransactionsAction(
  opts?: { forceRefresh?: boolean },
): Promise<SyncTransactionsResult> {
  const forceRefresh = opts?.forceRefresh === true;
  const { supabase, user } = await requireUser();
  const merchantCacheClient = getOptionalSupabaseServiceRoleKey()
    ? createAdminClient()
    : supabase;
  const config = getPlaidServerEnv();
  const [{ data, error }, activeWeek] = await Promise.all([
    supabase.rpc("plaid_items_for_server_sync"),
    loadActiveWeekForUser(supabase, user.id),
  ]);

  if (error) {
    throw new Error(`Unable to load Plaid sync items: ${error.message}`);
  }

  const items = (data ?? []) as ServerPlaidItem[];
  const activeWeekStartDate = activeWeek?.start_date ?? null;
  const syncContext: PlaidSyncContext = {
    supabase,
    merchantCacheClient,
    userId: user.id,
    activeWeekStartDate,
    encryptionKey: config.tokenEncryptionKey,
    forceRefresh,
    updateItemSyncState: (itemId, cursor, status) =>
      updatePlaidItemSyncStateViaRpc(supabase, itemId, cursor, status),
  };
  let added = 0;
  let modified = 0;
  let removed = 0;

  for (const item of items) {
    if (!item.access_token_encrypted || item.status === "login_required") {
      continue;
    }

    try {
      const result = await syncPlaidItem(item, syncContext);
      added += result.added;
      modified += result.modified;
      removed += result.removed;
    } catch (caughtError) {
      if (isPlaidLoginRequiredError(caughtError)) {
        await syncContext.updateItemSyncState(
          item.id,
          item.cursor,
          "login_required",
        );
        continue;
      }

      throw caughtError;
    }
  }

  await excludeOldNoMatchingTransactions(supabase, user.id, activeWeekStartDate);
  const normalized = await normalizeCurrentWeekMerchantNames(
    supabase,
    user.id,
    activeWeek,
    merchantCacheClient,
  );

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/banking");

  return { ok: true, added, modified, removed, normalized };
}

export async function syncTransactionsActionForItem(
  plaidItemId: string,
): Promise<SyncTransactionsResult> {
  const normalizedPlaidItemId = plaidItemId.trim();

  if (!normalizedPlaidItemId) {
    throw new Error("Missing Plaid item id.");
  }

  const supabase = createAdminClient();
  const merchantCacheClient = supabase;
  const config = getPlaidServerEnv();
  const { data: itemData, error: itemError } = await supabase
    .from("plaid_items")
    .select(
      "id,user_id,plaid_item_id,access_token_encrypted,cursor,institution_name,status",
    )
    .eq("plaid_item_id", normalizedPlaidItemId)
    .maybeSingle();

  if (itemError) {
    throw new Error(`Unable to load Plaid item: ${itemError.message}`);
  }
  if (!itemData) {
    throw new Error(`Item not found: ${normalizedPlaidItemId}`);
  }

  const item = itemData as ServerPlaidItem & { user_id: string | null };
  const userId = requireString(item.user_id, "Plaid item user");

  if (!item.access_token_encrypted || item.status === "login_required") {
    return { ok: true, added: 0, modified: 0, removed: 0, normalized: 0 };
  }

  const activeWeek = await loadActiveWeekForUser(supabase, userId);
  const syncContext: PlaidSyncContext = {
    supabase,
    merchantCacheClient,
    userId,
    activeWeekStartDate: activeWeek?.start_date ?? null,
    encryptionKey: config.tokenEncryptionKey,
    forceRefresh: false,
    updateItemSyncState: (itemId, cursor, status) =>
      updatePlaidItemSyncStateDirect(supabase, userId, itemId, cursor, status),
  };

  let added = 0;
  let modified = 0;
  let removed = 0;

  try {
    const result = await syncPlaidItem(item, syncContext);
    added = result.added;
    modified = result.modified;
    removed = result.removed;
  } catch (caughtError) {
    if (isPlaidLoginRequiredError(caughtError)) {
      await syncContext.updateItemSyncState(
        item.id,
        item.cursor,
        "login_required",
      );
      return { ok: true, added: 0, modified: 0, removed: 0, normalized: 0 };
    }

    throw caughtError;
  }

  await excludeOldNoMatchingTransactions(
    supabase,
    userId,
    activeWeek?.start_date ?? null,
  );
  const normalized = await normalizeCurrentWeekMerchantNames(
    supabase,
    userId,
    activeWeek,
    merchantCacheClient,
  );

  return { ok: true, added, modified, removed, normalized };
}

type PlaidItemStatus = ServerPlaidItem["status"];

type PlaidSyncCounters = Pick<
  SyncTransactionsResult,
  "added" | "modified" | "removed"
>;

type PlaidSyncContext = {
  supabase: SupabaseClient;
  merchantCacheClient: SupabaseClient;
  userId: string;
  activeWeekStartDate: string | null;
  encryptionKey: string;
  forceRefresh: boolean;
  updateItemSyncState: (
    itemId: string,
    cursor: string | null,
    status: PlaidItemStatus,
  ) => Promise<void>;
};

async function syncPlaidItem(
  item: ServerPlaidItem,
  context: PlaidSyncContext,
): Promise<PlaidSyncCounters> {
  const client = getPlaidClient();
  const accessToken = decryptAccessToken(
    requireString(item.access_token_encrypted, "encrypted access token"),
    context.encryptionKey,
  );

  if (context.forceRefresh) {
    try {
      await client.transactionsRefresh({ access_token: accessToken });
    } catch (refreshError) {
      if (isPlaidLoginRequiredError(refreshError)) {
        throw refreshError;
      }
      console.warn(
        `[plaid/refresh] failed for item ${item.id}:`,
        refreshError instanceof Error ? refreshError.message : refreshError,
      );
    }
  }

  let cursor = item.cursor ?? undefined;
  let hasMore = true;
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;

  while (hasMore) {
    const response = await client.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 500,
      options: {
        include_original_description: true,
      },
    });

    for (const transaction of response.data.added) {
      await upsertPlaidTransaction(context, item.id, transaction);
    }

    for (const transaction of response.data.modified) {
      await upsertPlaidTransaction(context, item.id, transaction);
    }

    for (const removedTransaction of response.data.removed) {
      await markPlaidTransactionRemoved(
        context,
        removedTransaction.transaction_id,
      );
    }

    addedCount += response.data.added.length;
    modifiedCount += response.data.modified.length;
    removedCount += response.data.removed.length;
    cursor = response.data.next_cursor;
    hasMore = response.data.has_more;
  }

  await context.updateItemSyncState(item.id, cursor ?? null, "active");

  return {
    added: addedCount,
    modified: modifiedCount,
    removed: removedCount,
  };
}

const APP_TIME_ZONE = "America/New_York";

/**
 * The day a transaction actually happened, in Jon's timezone.
 *
 * Plaid's `date` is a calendar date the institution assigns, and for an evening
 * purchase it can already read as the NEXT day because the underlying instant
 * is stamped in UTC. An 8:40 PM Eastern Supercharger stop is 00:40 UTC, so it
 * arrives dated tomorrow. That silently moves spend onto the wrong day — and
 * across a Saturday boundary, into the wrong week.
 *
 * The correction is deliberately ONE-DIRECTIONAL. `datetime` is only trusted
 * when it resolves EARLIER than Plaid's date, because a re-sync can refresh
 * `datetime` to the later settlement instant, and honouring that would drag
 * transactions forward off the day they were actually spent. Plaid's date is
 * never earlier than the real purchase, so pulling backward is always safe and
 * pushing forward never is.
 */
function localTransactionDate(transaction: Transaction): string {
  if (!transaction.datetime) return transaction.date;
  const instant = new Date(transaction.datetime);
  if (Number.isNaN(instant.getTime())) return transaction.date;
  // en-CA renders ISO-shaped YYYY-MM-DD.
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return localDate < transaction.date ? localDate : transaction.date;
}

async function upsertPlaidTransaction(
  context: PlaidSyncContext,
  plaidItemId: string,
  transaction: Transaction,
) {
  const effectiveDate = localTransactionDate(transaction);
  const day = await findDayForTransaction(context, effectiveDate);
  const isBeforeActiveWeek =
    Boolean(context.activeWeekStartDate) &&
    effectiveDate < context.activeWeekStartDate!;
  const rawName = transaction.original_description ?? transaction.name;
  const category = formatCategory(transaction);
  const cashflowOnly = isAutoLoanCashflowOnly({
    merchantName: transaction.merchant_name ?? transaction.name,
    rawName,
    category,
  });
  const existingTransaction = await findExistingPlaidTransaction(
    context,
    transaction.transaction_id,
  );

  if (existingTransaction?.status === "excluded" && !cashflowOnly) {
    return;
  }

  const merchantName = await resolveMerchantName(
    rawName ?? transaction.merchant_name ?? transaction.name,
    context.merchantCacheClient,
  );
  const isIncome = transaction.amount <= 0;
  const matchesLegacyRule = isLegacyExempt({
    merchantName,
    rawName,
    category,
  });
  const autoExclude = isIncome || (matchesLegacyRule && !cashflowOnly);
  const baseStatus =
    day && !day.spend_locked
      ? "applied"
      : isBeforeActiveWeek
        ? "excluded"
        : "pending_review";
  const status = autoExclude ? "excluded" : baseStatus;
  const reviewReason =
    status === "pending_review"
      ? day
        ? "day_locked"
        : "no_matching_day"
      : null;
  const autoExcludeNote = isIncome
    ? "Auto-excluded as income (negative amount)."
    : matchesLegacyRule
      ? "Auto-excluded by legacy rule (subscription/recurring/insurance/etc.)."
      : null;
  const row = {
    plaid_item_id: plaidItemId,
    source: "plaid",
    status: existingTransaction?.status === "applied" ? "applied" : status,
    review_reason:
      existingTransaction?.status === "applied" ? null : reviewReason,
    plaid_transaction_id: transaction.transaction_id,
    date: effectiveDate,
    authorized_date: transaction.authorized_date ?? null,
    datetime: transaction.datetime ?? null,
    merchant_name: merchantName,
    raw_name: rawName,
    amount: transaction.amount,
    category,
    cashflow_only: cashflowOnly,
    pending: transaction.pending,
    excluded_at: status === "excluded" ? new Date().toISOString() : null,
    notes:
      (cashflowOnly
        ? "Auto-loan payment: cashflow only; excluded from consumption spending."
        : autoExcludeNote) ??
      (status === "excluded"
        ? "Auto-excluded because the transaction date is before the active week."
        : null),
  };

  if (existingTransaction) {
    const nextStatus = row.status;
    const { error: updateError } = await context.supabase
      .from("transactions")
      .update({
        ...row,
        day_id:
          nextStatus === "applied"
            ? existingTransaction.day_id ?? day?.id ?? null
            : day?.id ?? null,
      })
      .eq("id", existingTransaction.id)
      .eq("user_id", context.userId);

    if (updateError) {
      throw new Error(`Unable to update transaction: ${updateError.message}`);
    }

    return;
  }

  // Cross-source dedup: if a Chime push capture already exists for the
  // same date and amount, stamp the Plaid id onto it instead of inserting
  // a duplicate row.
  const chimeMatch = await findChimeMatchForPlaid(
    context,
    effectiveDate,
    transaction.amount,
  );

  if (chimeMatch) {
    const { error: stampError } = await context.supabase
      .from("transactions")
      .update({
        plaid_item_id: plaidItemId,
        plaid_transaction_id: transaction.transaction_id,
        authorized_date: transaction.authorized_date ?? null,
        category: row.category,
        ...(cashflowOnly
          ? {
              status: row.status,
              day_id: day?.id ?? null,
              review_reason: row.review_reason,
              excluded_at: null,
              cashflow_only: true,
            }
          : {}),
        pending: row.pending,
        notes: chimeMatch.merchant_name
          ? `${chimeMatch.merchant_name} (cross-verified by Plaid)`
          : "Cross-verified by Plaid.",
      })
      .eq("id", chimeMatch.id)
      .eq("user_id", context.userId);

    if (stampError) {
      throw new Error(
        `Unable to merge Plaid into Chime row: ${stampError.message}`,
      );
    }
    return;
  }

  const { error: insertError } = await context.supabase
    .from("transactions")
    .insert({
      ...row,
      user_id: context.userId,
      day_id: day?.id ?? null,
    });

  if (insertError) {
    throw new Error(`Unable to insert transaction: ${insertError.message}`);
  }
}

async function findExistingPlaidTransaction(
  context: PlaidSyncContext,
  plaidTransactionId: string,
) {
  const { data: existingTransaction, error: existingError } = await context.supabase
    .from("transactions")
    .select("id,day_id,status")
    .eq("user_id", context.userId)
    .eq("plaid_transaction_id", plaidTransactionId)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to check existing transaction: ${existingError.message}`,
    );
  }

  return existingTransaction as {
    id: string;
    day_id: string | null;
    status: "applied" | "pending_review" | "excluded";
  } | null;
}

// Cross-source dedup: when Plaid sync sees a transaction, check whether a
// Chime push capture already landed for the same real-world purchase. If so,
// we stamp the existing Chime row with the Plaid id so future Plaid syncs
// match it and we skip the duplicate insert. The Chime push captures faster,
// so it usually wins the race.
//
// Matched on amount + a DATE WINDOW, not exact date equality: Chime's date is
// the instant local-time capture (card swipe), while Plaid's `date` is the
// bank's POSTED date, which routinely lands 1-3 days later (weekends/holidays
// push it further). An exact-date match silently misses these and both a
// Chime row and a Plaid row get created for the same purchase -- this was the
// main source of duplicate spending/transfer transactions. Plaid's post date
// is virtually never earlier than the swipe date, so the window is asymmetric
// (a few days back, one day forward for rare early-posting cases).
const CROSS_SOURCE_MATCH_DAYS_BACK = 3;
const CROSS_SOURCE_MATCH_DAYS_FORWARD = 1;

async function findChimeMatchForPlaid(
  context: PlaidSyncContext,
  date: string,
  amount: number,
) {
  const { data, error } = await context.supabase
    .from("transactions")
    .select("id,day_id,status,merchant_name,date")
    .eq("user_id", context.userId)
    .eq("source", "chime")
    .gte("date", addDaysIso(date, -CROSS_SOURCE_MATCH_DAYS_BACK))
    .lte("date", addDaysIso(date, CROSS_SOURCE_MATCH_DAYS_FORWARD))
    .eq("amount", amount)
    .is("plaid_transaction_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to check Chime match: ${error.message}`);
  }

  return data as {
    id: string;
    day_id: string | null;
    status: "applied" | "pending_review" | "excluded";
    merchant_name: string | null;
    date: string;
  } | null;
}

async function markPlaidTransactionRemoved(
  context: PlaidSyncContext,
  plaidTransactionId: string,
) {
  const { error: updateError } = await context.supabase
    .from("transactions")
    .update({
      status: "excluded",
      excluded_at: new Date().toISOString(),
      notes: "Removed by Plaid transaction sync.",
    })
    .eq("user_id", context.userId)
    .eq("plaid_transaction_id", plaidTransactionId);

  if (updateError) {
    throw new Error(`Unable to mark removed transaction: ${updateError.message}`);
  }
}

async function findDayForTransaction(
  context: PlaidSyncContext,
  date: string,
): Promise<DayMatch | null> {
  const { data: day, error: dayError } = await context.supabase
    .from("days")
    .select("id,spend_locked")
    .eq("user_id", context.userId)
    .eq("date", date)
    .maybeSingle();

  if (dayError) {
    throw new Error(`Unable to match transaction day: ${dayError.message}`);
  }

  return day as DayMatch | null;
}

async function loadActiveWeekForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActiveWeekRange | null> {
  const { data: activeWeek, error: activeWeekError } = await supabase
    .from("weeks")
    .select("start_date,end_date")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (activeWeekError) {
    throw new Error(`Unable to load active week: ${activeWeekError.message}`);
  }

  return activeWeek as ActiveWeekRange | null;
}

async function updatePlaidItemSyncStateViaRpc(
  supabase: SupabaseClient,
  itemId: string,
  cursor: string | null,
  status: PlaidItemStatus,
) {
  const { error } = await supabase.rpc("update_plaid_item_sync_state", {
    p_item_id: itemId,
    p_cursor: cursor,
    p_status: status,
  });

  if (error) {
    throw new Error(`Unable to update Plaid item sync state: ${error.message}`);
  }
}

async function updatePlaidItemSyncStateDirect(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  cursor: string | null,
  status: PlaidItemStatus,
) {
  const { error } = await supabase
    .from("plaid_items")
    .update({
      cursor,
      status,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Unable to update Plaid item sync state: ${error.message}`);
  }
}

async function excludeOldNoMatchingTransactions(
  supabase: SupabaseClient,
  userId: string,
  activeWeekStartDate: string | null,
) {
  if (!activeWeekStartDate) {
    return;
  }

  const { error: updateError } = await supabase
    .from("transactions")
    .update({
      status: "excluded",
      excluded_at: new Date().toISOString(),
      notes: "Auto-excluded because the transaction date is before the active week.",
    })
    .eq("user_id", userId)
    .eq("status", "pending_review")
    .eq("review_reason", "no_matching_day")
    .lt("date", activeWeekStartDate);

  if (updateError) {
    throw new Error(
      `Unable to auto-exclude old transactions: ${updateError.message}`,
    );
  }
}

async function normalizeCurrentWeekMerchantNames(
  supabase: SupabaseClient,
  userId: string,
  week: ActiveWeekRange | null,
  cacheClient: SupabaseClient,
): Promise<number> {
  if (!week) {
    return 0;
  }

  const { data: transactions, error: transactionsError } = await supabase
    .from("transactions")
    .select("id,merchant_name,raw_name")
    .eq("user_id", userId)
    .gte("date", week.start_date)
    .lte("date", week.end_date);

  if (transactionsError) {
    throw new Error(
      `Unable to load current-week transactions for normalization: ${transactionsError.message}`,
    );
  }

  let normalizedCount = 0;

  for (const transaction of (transactions ?? []) as CurrentWeekTransaction[]) {
    const rawName = transaction.raw_name ?? transaction.merchant_name;
    const merchantName = await resolveMerchantName(rawName, cacheClient, {
      refreshUglyCache: true,
    });

    if (!merchantName || merchantName === transaction.merchant_name) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("transactions")
      .update({ merchant_name: merchantName })
      .eq("id", transaction.id)
      .eq("user_id", userId);

    if (updateError) {
      throw new Error(
        `Unable to update normalized merchant name: ${updateError.message}`,
      );
    }

    normalizedCount++;
  }

  return normalizedCount;
}

export async function applyPendingTransactionAction(
  input: ApplyPendingTransactionInput,
): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");
  const dayId = requireUuid(input.dayId, "dayId");
  const { error } = await supabase
    .from("transactions")
    .update({
      day_id: dayId,
      status: "applied",
      review_reason: null,
      excluded_at: null,
    })
    .eq("id", transactionId);

  if (error) {
    throw new Error(`Unable to apply transaction: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/banking");

  return { ok: true };
}

export async function excludePendingTransactionAction(
  input: ExcludePendingTransactionInput,
): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const transactionId = requireUuid(input.transactionId, "transactionId");
  const { error } = await supabase
    .from("transactions")
    .update({
      status: "excluded",
      excluded_at: new Date().toISOString(),
    })
    .eq("id", transactionId);

  if (error) {
    throw new Error(`Unable to exclude transaction: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/banking");

  return { ok: true };
}

export async function excludeOldNoMatchingTransactionsAction(): Promise<ExcludeOldNoMatchResult> {
  const { supabase } = await requireUser();
  const { data: activeWeek, error: weekError } = await supabase
    .from("weeks")
    .select("start_date")
    .eq("status", "active")
    .maybeSingle();

  if (weekError) {
    throw new Error(`Unable to load active week: ${weekError.message}`);
  }

  if (!activeWeek) {
    throw new Error("No active week found.");
  }

  const week = activeWeek as { start_date: string };
  const { data, error } = await supabase
    .from("transactions")
    .update({
      status: "excluded",
      excluded_at: new Date().toISOString(),
      notes: "Bulk excluded because the transaction date is before the active week.",
    })
    .eq("status", "pending_review")
    .eq("review_reason", "no_matching_day")
    .lt("date", week.start_date)
    .select("id");

  if (error) {
    throw new Error(`Unable to exclude old transactions: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/banking");

  return {
    ok: true,
    excludedCount: (data ?? []).length,
  };
}

/**
 * One-shot backfill: scan every transaction for this user whose merchant_name
 * still trips `isLikelyUglyMerchantName` and re-run the cleaner with
 * `refreshUglyCache: true` so each one gets a fresh AI pass. Updates the
 * stored merchant_name on the row.
 *
 * Safe to run repeatedly — only rows that are still ugly cost an AI call.
 */
export async function cleanUglyMerchantNamesAction(): Promise<CleanUglyMerchantNamesResult> {
  const { supabase, user } = await requireUser();
  const merchantCacheClient = getOptionalSupabaseServiceRoleKey()
    ? createAdminClient()
    : supabase;

  const { data: transactions, error: transactionsError } = await supabase
    .from("transactions")
    .select("id,merchant_name,raw_name")
    .eq("user_id", user.id);

  if (transactionsError) {
    throw new Error(
      `Unable to load transactions for cleanup: ${transactionsError.message}`,
    );
  }

  const rows = (transactions ?? []) as CurrentWeekTransaction[];
  let scannedCount = 0;
  let cleanedCount = 0;

  for (const transaction of rows) {
    const current = transaction.merchant_name ?? "";
    if (!current || !isLikelyUglyMerchantName(current)) {
      continue;
    }

    scannedCount++;

    const rawName = transaction.raw_name ?? transaction.merchant_name;
    const merchantName = await resolveMerchantName(rawName, merchantCacheClient, {
      refreshUglyCache: true,
    });

    if (!merchantName || merchantName === transaction.merchant_name) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("transactions")
      .update({ merchant_name: merchantName })
      .eq("id", transaction.id)
      .eq("user_id", user.id);

    if (updateError) {
      throw new Error(
        `Unable to update merchant name during cleanup: ${updateError.message}`,
      );
    }

    cleanedCount++;
  }

  revalidatePath("/");
  revalidatePath("/trends");
  revalidatePath("/banking");

  return { ok: true, scannedCount, cleanedCount };
}

function formatCategory(transaction: Transaction): string | null {
  if (transaction.personal_finance_category?.primary) {
    return transaction.personal_finance_category.primary;
  }

  return transaction.category?.join(" / ") ?? null;
}

function requireUuid(value: string, fieldName: string): string {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

  if (!uuidPattern.test(value)) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return value;
}

function requireString(value: string | null, fieldName: string): string {
  if (!value) {
    throw new Error(`Missing ${fieldName}.`);
  }

  return value;
}
