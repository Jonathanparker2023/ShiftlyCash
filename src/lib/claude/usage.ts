import type { SupabaseClient } from "@supabase/supabase-js";

export const OPUS_4_7_INPUT_CENTS_PER_MTOK = 500;
export const OPUS_4_7_OUTPUT_CENTS_PER_MTOK = 2500;
export const OPUS_4_7_CACHE_WRITE_CENTS_PER_MTOK = 625;
export const OPUS_4_7_CACHE_READ_CENTS_PER_MTOK = 50;
export const DAILY_CAP_CENTS = 500;

export type ClaudeUsageInput = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export type DailyUsage = {
  usedCents: number;
  capCents: number;
  resetsAtIso: string;
};

export class DailyCapExceededError extends Error {
  readonly usedCents: number;
  readonly capCents: number;
  readonly resetsAtIso: string;

  constructor(usage: DailyUsage) {
    super("Daily Opus budget reached.");
    this.name = "DailyCapExceededError";
    this.usedCents = usage.usedCents;
    this.capCents = usage.capCents;
    this.resetsAtIso = usage.resetsAtIso;
  }
}

export function estimateRequestCostCents(usage: ClaudeUsageInput): number {
  return Math.round(
    tokenCost(usage.input_tokens, OPUS_4_7_INPUT_CENTS_PER_MTOK) +
      tokenCost(usage.output_tokens, OPUS_4_7_OUTPUT_CENTS_PER_MTOK) +
      tokenCost(
        usage.cache_creation_input_tokens,
        OPUS_4_7_CACHE_WRITE_CENTS_PER_MTOK,
      ) +
      tokenCost(usage.cache_read_input_tokens, OPUS_4_7_CACHE_READ_CENTS_PER_MTOK),
  );
}

export async function getDailyUsageCents(
  supabase: SupabaseClient,
  userId: string,
): Promise<DailyUsage> {
  const { startIso, resetIso } = getUtcDayWindow();
  const { data, error } = await supabase
    .from("chat_usage_log")
    .select("estimated_cost_cents")
    .eq("user_id", userId)
    .gte("created_at", startIso);

  if (error) {
    throw new Error(`Unable to load chat usage: ${error.message}`);
  }

  const usedCents = (data ?? []).reduce((sum, row) => {
    const cost = (row as { estimated_cost_cents?: unknown }).estimated_cost_cents;
    return sum + (typeof cost === "number" && Number.isFinite(cost) ? cost : 0);
  }, 0);

  return {
    usedCents,
    capCents: DAILY_CAP_CENTS,
    resetsAtIso: resetIso,
  };
}

export async function checkDailyCap(
  supabase: SupabaseClient,
  userId: string,
): Promise<DailyUsage & { allowed: boolean }> {
  const usage = await getDailyUsageCents(supabase, userId);

  return {
    ...usage,
    allowed: usage.usedCents < usage.capCents,
  };
}

export async function logUsage(
  supabase: SupabaseClient,
  userId: string,
  requestId: string,
  model: string,
  usage: ClaudeUsageInput,
): Promise<void> {
  const estimatedCostCents = estimateRequestCostCents(usage);
  const { error } = await supabase.from("chat_usage_log").insert({
    user_id: userId,
    request_id: requestId,
    model,
    input_tokens: cleanTokenCount(usage.input_tokens),
    output_tokens: cleanTokenCount(usage.output_tokens),
    cache_creation_input_tokens: cleanTokenCount(
      usage.cache_creation_input_tokens,
    ),
    cache_read_input_tokens: cleanTokenCount(usage.cache_read_input_tokens),
    estimated_cost_cents: estimatedCostCents,
  });

  if (error) {
    throw new Error(`Unable to log chat usage: ${error.message}`);
  }
}

function tokenCost(
  tokens: number | null | undefined,
  centsPerMillionTokens: number,
): number {
  return (cleanTokenCount(tokens) * centsPerMillionTokens) / 1_000_000;
}

function cleanTokenCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function getUtcDayWindow() {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const reset = new Date(start);
  reset.setUTCDate(reset.getUTCDate() + 1);

  return {
    startIso: start.toISOString(),
    resetIso: reset.toISOString(),
  };
}
