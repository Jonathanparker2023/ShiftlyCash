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

import { parseChimeNotification } from "./chime-parser";

describe("chime-parser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("maps mocked AI purchase JSON into a parse result", async () => {
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            kind: "purchase",
            amountDollars: 5.05,
            merchantOrSource: "Anthropic",
            newBalanceDollars: 233.76,
            direction: "debit",
            confidence: "high",
            reasoning: "Confirmed Chime purchase format.",
          }),
        },
      ],
    });

    const result = await parseChimeNotification({
      title: "You spent $5.05",
      body: "Your new Chime account balance is $233.76 after your purchase at Anthropic.",
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "purchase",
      amountDollars: 5.05,
      merchantOrSource: "Anthropic",
      newBalanceDollars: 233.76,
      direction: "debit",
      confidence: "high",
    });
  });

  it("maps mocked AI deposit JSON into a credit result", async () => {
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            kind: "deposit",
            amountDollars: "1,500.00",
            merchantOrSource: "Acme",
            newBalanceDollars: null,
            direction: "credit",
            confidence: "medium",
            reasoning: "Paycheck deposit wording.",
          }),
        },
      ],
    });

    const result = await parseChimeNotification({
      title: "You got paid $1500",
      body: "Your paycheck from Acme was deposited.",
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "deposit",
      amountDollars: 1500,
      merchantOrSource: "Acme",
      direction: "credit",
      confidence: "medium",
    });
  });

  it("falls back safely for malformed AI responses", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json" }],
    });

    const result = await parseChimeNotification({
      title: "You spent $5.05",
      body: "Your new Chime account balance is $233.76 after your purchase at Anthropic.",
    });

    expect(result.ok).toBe(false);
  });

  it("returns a config error when the API key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await parseChimeNotification({
      title: "You spent $5.05",
      body: "Your new Chime account balance is $233.76 after your purchase at Anthropic.",
    });

    expect(result).toEqual({
      ok: false,
      reason: "ANTHROPIC_API_KEY not configured",
    });
    expect(createMock).not.toHaveBeenCalled();
  });
});
