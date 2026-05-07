import { describe, expect, it } from "vitest";

import { estimateRequestCostCents } from "@/lib/claude/usage";

describe("estimateRequestCostCents", () => {
  it("estimates Opus 4.7 input and output costs with current published rates", () => {
    expect(
      estimateRequestCostCents({
        input_tokens: 1000,
        output_tokens: 500,
      }),
    ).toBe(2);
  });

  it("applies the cache-read discount", () => {
    expect(
      estimateRequestCostCents({
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 1_000_000,
      }),
    ).toBe(50);
  });

  it("returns zero for zero tokens", () => {
    expect(
      estimateRequestCostCents({
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }),
    ).toBe(0);
  });

  it("clamps negative token counts to zero", () => {
    expect(
      estimateRequestCostCents({
        input_tokens: -1000,
        output_tokens: -1000,
        cache_creation_input_tokens: -1000,
        cache_read_input_tokens: -1000,
      }),
    ).toBe(0);
  });
});
