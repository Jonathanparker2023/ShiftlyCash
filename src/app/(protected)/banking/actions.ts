"use server";

import { revalidatePath } from "next/cache";
import type { Transaction } from "plaid";

import { requireUser } from "@/lib/auth";
import { getOptionalSupabaseServiceRoleKey, getPlaidServerEnv } from "@/lib/env";
import { getPlaidClient, toPlaidCountryCodes, toPlaidProducts } from "@/lib/plaid/client";
import { decryptAccessToken, encryptAccessToken } from "@/lib/plaid/crypto";
import { isPlaidLoginRequiredError } from "@/lib/plaid/errors";
import { resolveMerchantName } from "@/lib/domain/merchant-ai";
import { isLegacyExempt } from "@/lib/domain/legacyRules";
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

export async function createLinkTokenAction(): Promise<CreateLinkTokenResult> {
  const { user } = await requireUser();
  const config = getPlaidServerEnv();
  const client = getPlaidClient();
  const response = await client.linkTokenCreate({
    client_name: "ShiftlyCash",
    country_codes: toPlaidCountryCodes(config),
    language: "en",
    products: toPlaidProducts(config),
    transactions: {
      days_requested: 30,
    },
    user: {
      client_user_id: user.id,
    },
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

export async function syncTransactionsAction(): Promise<SyncTransactionsResult> {
  const { supabase, user } = await requireUser();
  const merchantCacheClient = getOptionalSupabaseServiceRoleKey()
    ? createAdminClient()
    : supabase;
  const config = getPlaidServerEnv();
  const [
    { data, error },
    { data: activeWeekData, error: activeWeekError },
  ] = await Promise.all([
    supabase.rpc("plaid_items_for_server_sync"),
    supabase
      .from("weeks")
      .select("start_date")
      .eq("status", "active")
      .maybeSingle(),
  ]);

  if (error) {
    throw new Error(`Unable to load Plaid sync items: ${error.message}`);
  }
  if (activeWeekError) {
    throw new Error(`Unable to load active week: ${activeWeekError.message}`);
  }

  const items = (data ?? []) as ServerPlaidItem[];
  const activeWeek = activeWeekData as { start_date: string } | null;
  const activeWeekStartDate = activeWeek?.start_date ?? null;
  let added = 0;
  let modified = 0;
  let removed = 0;

  for (const item of items) {
    if (!item.access_token_encrypted || item.status === "login_required") {
      continue;
    }

    try {
      const result = await syncPlaidItem(item, config.tokenEncryptionKey);
      added += result.added;
      modified += result.modified;
      removed += result.removed;
    } catch (caughtError) {
      if (isPlaidLoginRequiredError(caughtError)) {
        await supabase.rpc("update_plaid_item_sync_state", {
          p_item_id: item.id,
          p_cursor: item.cursor,
          p_status: "login_required",
        });
        continue;
      }

      throw caughtError;
    }
  }

  await excludeOldNoMatchingTransactions(activeWeekStartDate);

  revalidatePath("/");
  revalidatePath("/banking");

  return { ok: true, added, modified, removed };

  async function syncPlaidItem(item: ServerPlaidItem, encryptionKey: string) {
    const client = getPlaidClient();
    const accessToken = decryptAccessToken(
      requireString(item.access_token_encrypted, "encrypted access token"),
      encryptionKey,
    );
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
        await upsertPlaidTransaction(item.id, transaction);
      }

      for (const transaction of response.data.modified) {
        await upsertPlaidTransaction(item.id, transaction);
      }

      for (const removedTransaction of response.data.removed) {
        await markPlaidTransactionRemoved(removedTransaction.transaction_id);
      }

      addedCount += response.data.added.length;
      modifiedCount += response.data.modified.length;
      removedCount += response.data.removed.length;
      cursor = response.data.next_cursor;
      hasMore = response.data.has_more;
    }

    await supabase.rpc("update_plaid_item_sync_state", {
      p_item_id: item.id,
      p_cursor: cursor ?? null,
      p_status: "active",
    });

    return {
      added: addedCount,
      modified: modifiedCount,
      removed: removedCount,
    };
  }

  async function upsertPlaidTransaction(plaidItemId: string, transaction: Transaction) {
    const day = await findDayForTransaction(transaction.date);
    const isBeforeActiveWeek =
      Boolean(activeWeekStartDate) && transaction.date < activeWeekStartDate!;
    const rawName = transaction.original_description ?? transaction.name;
    const existingTransaction = await findExistingPlaidTransaction(
      transaction.transaction_id,
    );

    if (existingTransaction?.status === "excluded") {
      return;
    }

    const merchantName = await resolveMerchantName(
      transaction.merchant_name ?? transaction.name,
      merchantCacheClient,
    );
    const category = formatCategory(transaction);
    const isIncome = transaction.amount <= 0;
    const matchesLegacyRule = isLegacyExempt({
      merchantName,
      rawName,
      category,
    });
    const autoExclude = isIncome || matchesLegacyRule;
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
        existingTransaction?.status === "applied"
          ? null
          : reviewReason,
      plaid_transaction_id: transaction.transaction_id,
      date: transaction.date,
      authorized_date: transaction.authorized_date ?? null,
      datetime: transaction.datetime ?? null,
      merchant_name: merchantName,
      raw_name: rawName,
      amount: transaction.amount,
      category,
      pending: transaction.pending,
      excluded_at: status === "excluded" ? new Date().toISOString() : null,
      notes:
        autoExcludeNote ??
        (status === "excluded"
          ? "Auto-excluded because the transaction date is before the active week."
          : null),
    };

    if (existingTransaction) {
      const nextStatus = row.status;
      const { error: updateError } = await supabase
        .from("transactions")
        .update({
          ...row,
          day_id:
            nextStatus === "applied"
              ? existingTransaction.day_id ?? day?.id ?? null
              : day?.id ?? null,
        })
        .eq("id", existingTransaction.id);

      if (updateError) {
        throw new Error(`Unable to update transaction: ${updateError.message}`);
      }

      return;
    }

    const { error: insertError } = await supabase.from("transactions").insert({
      ...row,
      user_id: user.id,
      day_id: day?.id ?? null,
    });

    if (insertError) {
      throw new Error(`Unable to insert transaction: ${insertError.message}`);
    }
  }

  async function findExistingPlaidTransaction(plaidTransactionId: string) {
    const { data: existingTransaction, error: existingError } = await supabase
      .from("transactions")
      .select("id,day_id,status")
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

  async function markPlaidTransactionRemoved(plaidTransactionId: string) {
    const { error: updateError } = await supabase
      .from("transactions")
      .update({
        status: "excluded",
        excluded_at: new Date().toISOString(),
        notes: "Removed by Plaid transaction sync.",
      })
      .eq("plaid_transaction_id", plaidTransactionId);

    if (updateError) {
      throw new Error(`Unable to mark removed transaction: ${updateError.message}`);
    }
  }

  async function findDayForTransaction(date: string): Promise<DayMatch | null> {
    const { data: day, error: dayError } = await supabase
      .from("days")
      .select("id,spend_locked")
      .eq("date", date)
      .maybeSingle();

    if (dayError) {
      throw new Error(`Unable to match transaction day: ${dayError.message}`);
    }

    return day as DayMatch | null;
  }

  async function excludeOldNoMatchingTransactions(activeWeekStartDate: string | null) {
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
      .eq("status", "pending_review")
      .eq("review_reason", "no_matching_day")
      .lt("date", activeWeekStartDate);

    if (updateError) {
      throw new Error(
        `Unable to auto-exclude old transactions: ${updateError.message}`,
      );
    }
  }
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
  revalidatePath("/banking");

  return {
    ok: true,
    excludedCount: (data ?? []).length,
  };
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
