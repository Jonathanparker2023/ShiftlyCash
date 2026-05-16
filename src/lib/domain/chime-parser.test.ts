import { describe, expect, it } from "vitest";

import { parseChimeNotification } from "./chime-parser";

describe("chime-parser", () => {
  it("parses Jon's confirmed purchase format", () => {
    const result = parseChimeNotification({
      title: "You spent $5.05",
      body: "Your new Chime account balance is $233.76 after your purchase at Anthropic.",
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "purchase") {
      expect(result.amountDollars).toBe(5.05);
      expect(result.merchant).toBe("Anthropic");
      expect(result.newBalanceDollars).toBe(233.76);
    }
  });

  it("handles multi-word merchant names", () => {
    const result = parseChimeNotification({
      title: "You spent $42.17",
      body: "Your new Chime account balance is $1,234.56 after your purchase at Trader Joe's #485.",
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "purchase") {
      expect(result.amountDollars).toBe(42.17);
      expect(result.merchant).toBe("Trader Joe's #485");
      expect(result.newBalanceDollars).toBe(1234.56);
    }
  });

  it("falls through unknown formats", () => {
    const result = parseChimeNotification({
      title: "You got paid $1,500.00",
      body: "Your paycheck from Acme Corp was deposited.",
    });

    expect(result.ok).toBe(false);
  });

  it("falls through when title is missing", () => {
    const result = parseChimeNotification({
      title: null,
      body: "Your new Chime account balance is $233.76 after your purchase at Anthropic.",
    });

    expect(result.ok).toBe(false);
  });
});
