import type { AccountBase, PlaidApi } from "plaid";
import { AccountType, DepositoryAccountSubtype } from "plaid";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPlaidClient } from "@/lib/plaid/client";
import { decryptAccessToken } from "@/lib/plaid/crypto";

export type DeployableBalanceSource = "plaid" | "cache";

export type DeployableBalanceAccount = {
  name: string;
  type: string;
  subtype: string | null;
  available: number;
  balance_basis: "available" | "current";
  note?: string;
};

export type DeployableBalancePayload = {
  as_of: string;
  deployable_balance: number;
  accounts: DeployableBalanceAccount[];
  source: DeployableBalanceSource;
  stale: boolean;
};

type PlaidItemRow = {
  id: string;
  access_token_encrypted: string | null;
  institution_name: string | null;
  status: "active" | "login_required" | "error";
};

type CacheRow = {
  as_of: string;
  deployable_balance: number | string;
  accounts: unknown;
};

type GetDeployableBalanceOptions = {
  supabase: SupabaseClient;
  userId: string;
  encryptionKey: string;
  plaidClient?: Pick<PlaidApi, "accountsBalanceGet">;
  now?: Date;
  forcePlaidFailure?: boolean;
};

const DEPOSITORY_SUBTYPES = new Set<string>([
  DepositoryAccountSubtype.Checking,
  DepositoryAccountSubtype.Savings,
]);

export async function getDeployableBalance({
  supabase,
  userId,
  encryptionKey,
  plaidClient = getPlaidClient(),
  now = new Date(),
  forcePlaidFailure = false,
}: GetDeployableBalanceOptions): Promise<DeployableBalancePayload> {
  try {
    if (forcePlaidFailure) {
      throw new Error("Forced Plaid failure for cache verification.");
    }

    const accounts = await fetchPlaidDepositoryBalances({
      supabase,
      userId,
      encryptionKey,
      plaidClient,
    });
    const asOf = now.toISOString();
    const payload: DeployableBalancePayload = {
      as_of: asOf,
      deployable_balance: round2(
        accounts.reduce((sum, account) => sum + account.available, 0),
      ),
      accounts,
      source: "plaid",
      stale: false,
    };

    await upsertCachedBalance(supabase, userId, payload);

    return payload;
  } catch {
    const cached = await loadCachedBalance(supabase, userId);

    if (cached) {
      return {
        ...cached,
        source: "cache",
        stale: true,
      };
    }

    return {
      as_of: now.toISOString(),
      deployable_balance: 0,
      accounts: [],
      source: "cache",
      stale: true,
    };
  }
}

async function fetchPlaidDepositoryBalances({
  supabase,
  userId,
  encryptionKey,
  plaidClient,
}: {
  supabase: SupabaseClient;
  userId: string;
  encryptionKey: string;
  plaidClient: Pick<PlaidApi, "accountsBalanceGet">;
}): Promise<DeployableBalanceAccount[]> {
  const { data, error } = await supabase
    .from("plaid_items")
    .select("id,access_token_encrypted,institution_name,status")
    .eq("user_id", userId)
    .not("access_token_encrypted", "is", null)
    .neq("status", "login_required")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Unable to load Plaid items: ${error.message}`);
  }

  const rows = (data ?? []) as PlaidItemRow[];
  const accounts: DeployableBalanceAccount[] = [];

  for (const row of rows) {
    if (!row.access_token_encrypted) {
      continue;
    }

    const accessToken = decryptAccessToken(row.access_token_encrypted, encryptionKey);
    const response = await plaidClient.accountsBalanceGet({
      access_token: accessToken,
    });

    accounts.push(...mapDeployableAccounts(response.data.accounts));
  }

  return accounts;
}

function mapDeployableAccounts(accounts: AccountBase[]): DeployableBalanceAccount[] {
  return accounts.flatMap((account) => {
    const subtype = account.subtype ?? null;

    if (
      account.type !== AccountType.Depository ||
      !subtype ||
      !DEPOSITORY_SUBTYPES.has(subtype)
    ) {
      return [];
    }

    const available = toFiniteNumber(account.balances.available);
    const current = toFiniteNumber(account.balances.current);
    const balance =
      available !== null
        ? { amount: available, basis: "available" as const }
        : current !== null
          ? { amount: current, basis: "current" as const }
          : null;

    if (!balance) {
      return [];
    }

    return [
      {
        name: account.name,
        type: account.type,
        subtype,
        available: round2(balance.amount),
        balance_basis: balance.basis,
        ...(balance.basis === "current"
          ? { note: "Plaid did not return available balance; current balance used." }
          : {}),
      },
    ];
  });
}

async function upsertCachedBalance(
  supabase: SupabaseClient,
  userId: string,
  payload: DeployableBalancePayload,
) {
  const { error } = await supabase.from("plaid_deployable_balance_cache").upsert({
    user_id: userId,
    as_of: payload.as_of,
    deployable_balance: payload.deployable_balance,
    accounts: payload.accounts,
  });

  if (error) {
    throw new Error(`Unable to cache deployable balance: ${error.message}`);
  }
}

async function loadCachedBalance(
  supabase: SupabaseClient,
  userId: string,
): Promise<Omit<DeployableBalancePayload, "source" | "stale"> | null> {
  const { data, error } = await supabase
    .from("plaid_deployable_balance_cache")
    .select("as_of,deployable_balance,accounts")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load cached deployable balance: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const row = data as CacheRow;

  return {
    as_of: new Date(row.as_of).toISOString(),
    deployable_balance: round2(Number(row.deployable_balance)),
    accounts: normalizeCachedAccounts(row.accounts),
  };
}

function normalizeCachedAccounts(value: unknown): DeployableBalanceAccount[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((account) => {
    if (!account || typeof account !== "object") {
      return [];
    }

    const row = account as Partial<DeployableBalanceAccount>;
    const available = toFiniteNumber(row.available ?? null);

    if (
      typeof row.name !== "string" ||
      typeof row.type !== "string" ||
      available === null
    ) {
      return [];
    }

    return [
      {
        name: row.name,
        type: row.type,
        subtype: typeof row.subtype === "string" ? row.subtype : null,
        available: round2(available),
        balance_basis: row.balance_basis === "current" ? "current" : "available",
        ...(typeof row.note === "string" ? { note: row.note } : {}),
      },
    ];
  });
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
