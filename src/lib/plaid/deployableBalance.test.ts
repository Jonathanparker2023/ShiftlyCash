import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountBase, PlaidApi } from "plaid";

const mockGetPlaidClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/plaid/client", () => ({
  getPlaidClient: mockGetPlaidClient,
}));

import {
  getDeployableBalance,
  refreshDeployableBalance,
} from "@/lib/plaid/deployableBalance";
import { encryptAccessToken } from "@/lib/plaid/crypto";

const encryptionKey = "test-encryption-key";

describe("deployable balances", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a fresh cached balance with zero Plaid calls", async () => {
    const { supabase, upserts, tableReads } = createSupabaseMock({
      plaidItems: [],
      cachedBalance: cachedBalance("2026-06-13T12:00:00.000Z"),
    });

    const result = await getDeployableBalance({
      supabase,
      userId: "user-1",
      now: new Date("2026-06-13T14:30:00.000Z"),
    });

    expect(mockGetPlaidClient).not.toHaveBeenCalled();
    expect(tableReads).not.toContain("plaid_items");
    expect(upserts).toEqual([]);
    expect(result).toEqual({
      as_of: "2026-06-13T12:00:00.000Z",
      deployable_balance: 88.4,
      source: "cache",
      stale: false,
      has_fetched: true,
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

  it("returns a stale cached balance with zero Plaid calls", async () => {
    const { supabase, upserts, tableReads } = createSupabaseMock({
      plaidItems: [],
      cachedBalance: cachedBalance("2026-06-11T12:00:00.000Z"),
    });

    const result = await getDeployableBalance({
      supabase,
      userId: "user-1",
      now: new Date("2026-06-13T14:30:00.000Z"),
    });

    expect(mockGetPlaidClient).not.toHaveBeenCalled();
    expect(tableReads).not.toContain("plaid_items");
    expect(upserts).toEqual([]);
    expect(result.stale).toBe(true);
    expect(result.has_fetched).toBe(true);
    expect(result.as_of).toBe("2026-06-11T12:00:00.000Z");
  });

  it("returns a not-fetched state with zero Plaid calls when no cache exists", async () => {
    const { supabase, upserts, tableReads } = createSupabaseMock({
      plaidItems: [],
      cachedBalance: null,
    });

    const result = await getDeployableBalance({
      supabase,
      userId: "user-1",
      now: new Date("2026-06-13T14:30:00.000Z"),
    });

    expect(mockGetPlaidClient).not.toHaveBeenCalled();
    expect(tableReads).not.toContain("plaid_items");
    expect(upserts).toEqual([]);
    expect(result).toEqual({
      as_of: null,
      deployable_balance: 0,
      accounts: [],
      source: "cache",
      stale: true,
      has_fetched: false,
    });
  });

  it("explicit refresh calls Plaid once per connected item and updates the cache", async () => {
    const { supabase, upserts } = createSupabaseMock({
      plaidItems: [
        plaidItem("item-1", "access-token-1"),
        plaidItem("item-2", "access-token-2"),
      ],
      cachedBalance: cachedBalance("2026-06-13T12:00:00.000Z"),
    });
    const accountsBalanceGet = vi.fn(
      async ({ access_token }: { access_token: string }) => ({
        data: {
          accounts:
            access_token === "access-token-1"
              ? [
                  account("Checking", "depository", "checking", 100.126, 101),
                  account("Credit Card", "credit", "credit card", 2000, 100),
                ]
              : [
                  account("Savings", "depository", "savings", 50, 50),
                  account("No Available", "depository", "checking", null, 25),
                ],
        },
      }),
    );
    const plaidClient = {
      accountsBalanceGet,
    } as unknown as Pick<PlaidApi, "accountsBalanceGet">;

    const result = await refreshDeployableBalance({
      supabase,
      userId: "user-1",
      encryptionKey,
      plaidClient,
      now: new Date("2026-06-13T14:30:00.000Z"),
    });

    expect(accountsBalanceGet).toHaveBeenCalledTimes(2);
    expect(accountsBalanceGet).toHaveBeenNthCalledWith(1, {
      access_token: "access-token-1",
    });
    expect(accountsBalanceGet).toHaveBeenNthCalledWith(2, {
      access_token: "access-token-2",
    });
    expect(result).toEqual({
      as_of: "2026-06-13T14:30:00.000Z",
      deployable_balance: 175.13,
      source: "plaid",
      stale: false,
      has_fetched: true,
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
});

function cachedBalance(asOf: string) {
  return {
    as_of: asOf,
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
  };
}

function plaidItem(id: string, accessToken: string) {
  return {
    id,
    access_token_encrypted: encryptAccessToken(accessToken, encryptionKey),
    institution_name: "Test Bank",
    status: "active",
  };
}

function createSupabaseMock({
  plaidItems,
  cachedBalance,
}: {
  plaidItems: unknown[];
  cachedBalance: unknown | null;
}) {
  const upserts: unknown[] = [];
  const tableReads: string[] = [];

  return {
    upserts,
    tableReads,
    supabase: {
      from(table: string) {
        tableReads.push(table);

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
