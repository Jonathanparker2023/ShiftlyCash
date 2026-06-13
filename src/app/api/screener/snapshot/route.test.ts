import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/screener/snapshot/route";

vi.mock("server-only", () => ({}));

const mockCreateAdminClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

const sampleSnapshot = {
  snapshot_id: "2026-06-13",
  as_of: "2026-06-13T22:00:00.000Z",
  generated_at: "2026-06-13T22:05:00.000Z",
  clock: { started: "2026-06-13", day: 1, of: 180 },
  hero: {
    portfolio_value: 1000,
    cost_basis: 950,
    pnl_pct: 5.26,
    unvalidated: true,
  },
  positions: [{ ticker: "ANF", entry: 100, current: 105, pnl_pct: 5 }],
  queue: [{ ticker: "LULU", score: 4, band: "score-4", queue_rank: 1, shadow_flagged: false }],
  fear: [{ ticker: "ULTA", variant: "v1", kind: "enter_fear", drawdown_pct: 32 }],
};

describe("/api/screener/snapshot", () => {
  const originalToken = process.env.SHIFTLYCASH_LEDGER_TOKEN;

  afterEach(() => {
    vi.clearAllMocks();
    restoreEnv("SHIFTLYCASH_LEDGER_TOKEN", originalToken);
  });

  it("inserts a newer snapshot with a valid token", async () => {
    process.env.SHIFTLYCASH_LEDGER_TOKEN = "test-token";
    const supabase = createSupabaseMock({
      latest: { generated_at: "2026-06-13T21:00:00.000Z" },
      inserted: { id: 7, generated_at: sampleSnapshot.generated_at },
    });
    mockCreateAdminClient.mockReturnValue(supabase);

    const response = await POST(snapshotRequest(sampleSnapshot));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      id: 7,
      generated_at: sampleSnapshot.generated_at,
    });
    expect(supabase.insert).toHaveBeenCalledWith({
      snapshot_id: "2026-06-13",
      as_of: "2026-06-13T22:00:00.000Z",
      generated_at: sampleSnapshot.generated_at,
      payload: sampleSnapshot,
    });
  });

  it("skips an older generated_at without inserting", async () => {
    process.env.SHIFTLYCASH_LEDGER_TOKEN = "test-token";
    const supabase = createSupabaseMock({
      latest: { generated_at: "2026-06-13T23:00:00.000Z" },
    });
    mockCreateAdminClient.mockReturnValue(supabase);

    const response = await POST(snapshotRequest(sampleSnapshot));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      skipped: "not newer",
      generated_at: sampleSnapshot.generated_at,
      latest_generated_at: "2026-06-13T23:00:00.000Z",
    });
    expect(supabase.insert).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is missing or wrong", async () => {
    process.env.SHIFTLYCASH_LEDGER_TOKEN = "test-token";

    const missing = await POST(
      new NextRequest("http://localhost/api/screener/snapshot", {
        method: "POST",
        body: JSON.stringify(sampleSnapshot),
      }),
    );
    const wrong = await POST(
      new NextRequest("http://localhost/api/screener/snapshot", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
        body: JSON.stringify(sampleSnapshot),
      }),
    );

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
  });

  it("rejects malformed snapshots", async () => {
    process.env.SHIFTLYCASH_LEDGER_TOKEN = "test-token";

    const response = await POST(snapshotRequest({ generated_at: "not-a-date" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "generated_at must be a valid ISO timestamp.",
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("returns 405 for GET", async () => {
    const response = await GET();

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "Method not allowed",
    });
  });
});

function snapshotRequest(body: unknown) {
  return new NextRequest("http://localhost/api/screener/snapshot", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createSupabaseMock(input: {
  latest?: { generated_at: string } | null;
  latestError?: { message: string };
  inserted?: { id: number; generated_at: string };
  insertError?: { message: string };
}) {
  const insert = vi.fn();
  const latestQuery = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: input.latest ?? null,
      error: input.latestError ?? null,
    }),
  };
  const insertQuery = {
    insert: vi.fn((row: unknown) => {
      insert(row);
      return insertQuery;
    }),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: input.inserted ?? null,
      error: input.insertError ?? null,
    }),
  };
  let fromCalls = 0;

  return {
    insert,
    from: vi.fn(() => {
      fromCalls += 1;
      return fromCalls === 1 ? latestQuery : insertQuery;
    }),
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
