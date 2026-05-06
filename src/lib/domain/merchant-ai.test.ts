import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: createMock,
    };
  },
}));

import {
  aiCleanupName,
  isLikelyUglyMerchantName,
  merchantRawKey,
  resolveMerchantName,
} from "./merchant-ai";

function createSupabaseStub(options: {
  cachedName?: string | null;
  upsertError?: string | null;
}) {
  const upsert = vi.fn(() =>
    Promise.resolve({
      error: options.upsertError ? { message: options.upsertError } : null,
    }),
  );
  const maybeSingle = vi.fn(() =>
    Promise.resolve({
      data: options.cachedName
        ? {
            display_name: options.cachedName,
          }
        : null,
      error: null,
    }),
  );
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table !== "merchant_name_cache") {
      throw new Error(`Unexpected table ${table}`);
    }

    return {
      select,
      upsert,
    };
  });

  return {
    client: { from },
    eq,
    from,
    maybeSingle,
    select,
    upsert,
  };
}

describe("merchant AI normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.ANTHROPIC_MODEL;
  });

  it("builds stable compact cache keys", () => {
    expect(merchantRawKey("www.perplexity.ai")).toBe("wwwperplexityai");
    expect(merchantRawKey("AMZN MKTP US*1A2B3")).toBe("amznmktpus1a2b3");
  });

  it("flags URL-shaped and long names as ugly", () => {
    expect(isLikelyUglyMerchantName("Www Perplexity Ai")).toBe(true);
    expect(isLikelyUglyMerchantName("Spo Primeburger")).toBe(true);
    expect(isLikelyUglyMerchantName("Blizzard Us")).toBe(true);
    expect(isLikelyUglyMerchantName("Store 12345")).toBe(true);
    expect(isLikelyUglyMerchantName("Long Merchant Name With Many Words")).toBe(
      true,
    );
    expect(isLikelyUglyMerchantName("Target")).toBe(false);
  });

  it("uses cached names without calling Anthropic", async () => {
    const supabase = createSupabaseStub({ cachedName: "Perplexity" });

    await expect(
      resolveMerchantName("www.perplexity.ai", supabase.client as never),
    ).resolves.toBe("Perplexity");
    expect(createMock).not.toHaveBeenCalled();
    expect(supabase.upsert).not.toHaveBeenCalled();
  });

  it("keeps Perplexity deterministic without calling Anthropic", async () => {
    const supabase = createSupabaseStub({});

    await expect(
      resolveMerchantName("www.perplexity.ai", supabase.client as never, {
        refreshUglyCache: true,
      }),
    ).resolves.toBe("Perplexity");
    expect(createMock).not.toHaveBeenCalled();
    expect(supabase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "Perplexity",
        source: "rule",
      }),
    );
  });

  it("refreshes ugly cached names when explicitly requested", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Clean Merchant" }],
    });
    const supabase = createSupabaseStub({ cachedName: "Www Strange Domain Ai" });

    await expect(
      resolveMerchantName("www.strangedomain.ai", supabase.client as never, {
        refreshUglyCache: true,
      }),
    ).resolves.toBe("Clean Merchant");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(supabase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "Clean Merchant",
        source: "ai",
      }),
    );
  });

  it("prompts Haiku with storefront and game cleanup examples", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Primeburger" }],
    });

    await expect(aiCleanupName("SPO*PRIMEBURGER")).resolves.toBe(
      "Primeburger",
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0,
        system: expect.stringContaining('Input: "SPO*PRIMEBURGER"'),
      }),
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Input: "BLIZZARD*CALL OF DUTY"'),
      }),
    );
  });

  it("uses Haiku for ugly uncached names and writes the cache", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Clean Merchant" }],
    });
    const supabase = createSupabaseStub({});

    await expect(
      resolveMerchantName("www.strangedomain.ai", supabase.client as never),
    ).resolves.toBe("Clean Merchant");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(supabase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        raw_key: "wwwstrangedomainai",
        display_name: "Clean Merchant",
        source: "ai",
        ai_model: "claude-haiku-4-5",
      }),
    );
  });

  it("falls back to rule output when Anthropic returns UNKNOWN", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "UNKNOWN" }],
    });
    const supabase = createSupabaseStub({});

    await expect(
      resolveMerchantName("TST* CORE BURGER NY", supabase.client as never),
    ).resolves.toBe("Core Burger");
    expect(supabase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "Core Burger",
        source: "rule",
        ai_model: null,
      }),
    );
  });

  it("does not call Anthropic when the API key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(aiCleanupName("www.perplexity.ai")).resolves.toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns null on Anthropic errors", async () => {
    createMock.mockRejectedValueOnce(new Error("rate limited"));

    await expect(aiCleanupName("www.strangedomain.ai")).resolves.toBeNull();
  });
});
