import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountBase, PlaidApi } from "plaid";

import { getDeployableBalance } from "@/lib/plaid/deployableBalance";
import { encryptAccessToken } from "@/lib/plaid/crypto";

const encryptionKey = "test-encryption-key";

describe("getDeployableBalance", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sums available balances from checking and savings accounts only", async () => {
    const encryptedToken = encryptAccessToken("access-token-1", encryptionKey);
    const { supabase, upserts } = createSupabaseMock({
      plaidItems: [
        {
          id: "item-1",
          access_token_encrypted: encryptedToken,
          institution_name: "Test Bank",
          status: "active",
        },
      ],
      cachedBalance: null,
    });
    const plaidClient = createPlaidClientMock([
      account("Checking", "depository", "checking", 100.126, 101),
      account("Savings", "depository", "savings", 50, 50),
      account("No Available", "depository", "checking", null, 25),
      account("Credit Card", "credit", "credit card", 2000, 100),
      account("Brokerage", "investment", "brokerage", 300, 300),
    ]);

    const result = await getDeployableBalance({
      supabase,
      userId: "user-1",
      encryptionKey,
      plaidClient,
      now: new Date("2026-06-13T14:30:00.000Z"),
    });

    expect(plaidClient.accountsBalanceGet).toHaveBeenCalledWith({
      access_token: "access-token-1",
    });
    expect(result).toEqual({
      as_of: "2026-06-13T14:30:00.000Z",
      deployable_balance: 175.13,
      source: "plaid",
      stale: false,
      accounts: [
        {
          name: "Checking",
          type: "depository",
          subtype: "checking",
          available: 100.13,
          balance_basis: "available",
        },
        {
          name: "Savings",
          type: "depository",
          subtype: "savings",
          available: 50,
          balance_basis: "available",
        },
        {
          name: "No Available",
          type: "depository",
          subtype: "checking",
          available: 25,
          balance_basis: "current",
          note: "Plaid did not return available balance; current balance used.",
        },
      ],
    });
    expect(upserts).toEqual([
      {
        user_id: "user-1",
        as_of: "2026-06-13T14:30:00.000Z",
        deployable_balance: 175.13,
        accounts: result.accounts,
      },
    ]);
  });

  it("returns the last cached balance when the live Plaid call fails", async () => {
    const encryptedToken = encryptAccessToken("access-token-1", encryptionKey);
    const { supabase } = createSupabaseMock({
      plaidItems: [
        {
          id: "item-1",
          access_token_encrypted: encryptedToken,
          institution_name: "Test Bank",
          status: "active",
        },
      ],
      cachedBalance: {
        as_of: "2026-06-12T12:00:00.000Z",
        deployable_balance: "88.40",
        accounts: [
          {
            name: "Cached Checking",
            type: "depository",
            subtype: "checking",
            available: 88.4,
            balance_basis: "available",
          },
        ],
      },
    });
    const plaidClient = {
      accountsBalanceGet: vi.fn(async () => {
        throw new Error("rate limited");
      }),
    } as unknown as Pick<PlaidApi, "accountsBalanceGet">;

    const result = await getDeployableBalance({
      supabase,
      userId: "user-1",
      encryptionKey,
      plaidClient,
      now: new Date("2026-06-13T14:30:00.000Z"),
    });

    expect(result).toEqual({
      as_of: "2026-06-12T12:00:00.000Z",
      deployable_balance: 88.4,
      source: "cache",
      stale: true,
      accounts: [
        {
          name: "Cached Checking",
          type: "depository",
          subtype: "checking",
          available: 88.4,
          balance_basis: "available",
        },
      ],
    });
  });

  it("returns a zero stale cache payload when Plaid fails before any cache exists", async () => {
    const { supabase } = createSupabaseMock({
      plaidItems: [],
      cachedBalance: null,
    });

    const result = await getDeployableBalance({
      supabase,
      userId: "user-1",
      encryptionKey,
      plaidClient: createPlaidClientMock([]),
      now: new Date("2026-06-13T14:30:00.000Z"),
      forcePlaidFailure: true,
    });

    expect(result).toEqual({
      as_of: "2026-06-13T14:30:00.000Z",
      deployable_balance: 0,
      source: "cache",
      stale: true,
      accounts: [],
    });
  });
});

function createPlaidClientMock(accounts: AccountBase[]) {
  return {
    accountsBalanceGet: vi.fn(async () => ({
      data: {
        accounts,
      },
    })),
  } as unknown as Pick<PlaidApi, "accountsBalanceGet">;
}

function createSupabaseMock({
  plaidItems,
  cachedBalance,
}: {
  plaidItems: unknown[];
  cachedBalance: unknown | null;
}) {
  const upserts: unknown[] = [];

  return {
    upserts,
    supabase: {
      from(table: string) {
        if (table === "plaid_items") {
          return createQuery({ data: plaidItems, error: null });
        }

        if (table === "plaid_deployable_balance_cache") {
          return {
            ...createQuery({ data: cachedBalance ? [cachedBalance] : [], error: null }),
            upsert(row: unknown) {
              upserts.push(row);
              return { error: null };
            },
          };
        }

        return createQuery({ data: [], error: null });
      },
    } as never,
  };
}

function createQuery(result: {
  data: unknown[];
  error: { message: string } | null;
}) {
  return {
    data: result.data,
    error: result.error,
    select() {
      return this;
    },
    eq() {
      return this;
    },
    not() {
      return this;
    },
    neq() {
      return this;
    },
    order() {
      return this;
    },
    maybeSingle() {
      return {
        data: result.data[0] ?? null,
        error: result.error,
      };
    },
  };
}

function account(
  name: string,
  type: string,
  subtype: string,
  available: number | null,
  current: number | null,
): AccountBase {
  return {
    account_id: name,
    balances: {
      available,
      current,
      limit: null,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    },
    mask: "0000",
    name,
    official_name: null,
    type,
    subtype,
  } as AccountBase;
}
