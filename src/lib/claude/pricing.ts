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
