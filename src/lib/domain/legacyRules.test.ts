import { describe, expect, it } from "vitest";

import {
  cashflowColorFromTone,
  cashflowDailyColor,
  cashflowDailyTone,
  cashflowWeeklyColor,
  cashflowWeeklyTone,
  normalizeTxName,
  spendWeeklyTone,
} from "./legacyRules";

describe("legacy cashflow color tiers", () => {
  describe("daily tier - >= $200 green, $75-$195 amber, < $75 red", () => {
    it("classifies $200 and above as green", () => {
      expect(cashflowDailyTone(20_000)).toBe("positive");
      expect(cashflowDailyColor(20_000)).toBe("text-green-600");
      // Spec boundary: displayed $200 must be green after nearest-$5 rounding.
      expect(cashflowDailyTone(20_100)).toBe("positive");
      expect(cashflowDailyColor(20_100)).toBe("text-green-600");
      expect(cashflowDailyColor(50_000)).toBe("text-green-600");
    });

    it("treats $195 as the top of the amber band", () => {
      expect(cashflowDailyTone(19_500)).toBe("amber");
      expect(cashflowDailyColor(19_500)).toBe("text-amber-500");
    });

    it("classifies the middle of the amber band as amber", () => {
      // The originating bug report: $193 was rendering as red/brown
      // because globals.css overrode text-amber-600 to #c2410c.
      // With text-amber-500 (which globals.css does NOT override), $193
      // renders as actual amber #f59e0b.
      expect(cashflowDailyTone(19_300)).toBe("amber");
      expect(cashflowDailyColor(19_300)).toBe("text-amber-500");
      expect(cashflowDailyTone(15_000)).toBe("amber");
      expect(cashflowDailyTone(10_000)).toBe("amber");
    });

    it("treats exactly $75 as the bottom of the amber band, not red", () => {
      expect(cashflowDailyTone(7_500)).toBe("amber");
      expect(cashflowDailyColor(7_500)).toBe("text-amber-500");
    });

    it("classifies red strictly below $75", () => {
      // Spec boundary: $74.99 must be red.
      expect(cashflowDailyTone(7_499)).toBe("negative");
      expect(cashflowDailyColor(7_499)).toBe("text-red-600");
      expect(cashflowDailyTone(0)).toBe("negative");
      expect(cashflowDailyTone(-100)).toBe("negative");
    });
  });

  describe("weekly history tier - < $500 red, $500-$899 amber, >= $900 green", () => {
    it("classifies cashflow below $500 as red", () => {
      expect(cashflowWeeklyTone(-1)).toBe("negative");
      expect(cashflowWeeklyColor(-1)).toBe("text-red-600");
      expect(cashflowWeeklyTone(0)).toBe("negative");
      expect(cashflowWeeklyColor(49_999)).toBe("text-red-600");
    });

    it("classifies $500 through $899 weekly cashflow as amber", () => {
      expect(cashflowWeeklyTone(50_000)).toBe("amber");
      expect(cashflowWeeklyColor(50_000)).toBe("text-amber-500");
      expect(cashflowWeeklyTone(89_999)).toBe("amber");
    });

    it("classifies $900+ weekly cashflow as green", () => {
      expect(cashflowWeeklyTone(90_000)).toBe("positive");
      expect(cashflowWeeklyColor(90_000)).toBe("text-green-600");
    });
  });

  describe("weekly spend tone - relative to median", () => {
    it("classifies spend below median minus 10 percent as green", () => {
      expect(spendWeeklyTone(89_999, 100_000)).toBe("positive");
      expect(spendWeeklyTone(50_000, 100_000)).toBe("positive");
    });

    it("uses a below-median amber buffer from median minus 10 percent up to median", () => {
      expect(spendWeeklyTone(90_000, 100_000)).toBe("amber");
      expect(spendWeeklyTone(95_000, 100_000)).toBe("amber");
      expect(spendWeeklyTone(100_000, 100_000)).toBe("amber");
    });

    it("classifies any spend above median as red", () => {
      expect(spendWeeklyTone(100_001, 100_000)).toBe("negative");
      expect(spendWeeklyTone(110_000, 100_000)).toBe("negative");
    });

    it("uses amber when no median is available", () => {
      expect(spendWeeklyTone(10_000, null)).toBe("amber");
    });
  });

  describe("cashflowColorFromTone — canonical tone→class mapping", () => {
    it("returns true Tailwind colors that survive globals.css overrides", () => {
      // text-amber-500 is intentional: text-amber-600 is overridden in
      // globals.css to var(--shift-orange) = #c2410c (dark brown-orange,
      // reads as red). text-amber-500 is not overridden and renders as
      // actual amber #f59e0b.
      expect(cashflowColorFromTone("positive")).toBe("text-green-600");
      expect(cashflowColorFromTone("amber")).toBe("text-amber-500");
      expect(cashflowColorFromTone("negative")).toBe("text-red-600");
    });
  });
});

describe("legacy merchant normalization", () => {
  it("normalizes Perplexity domain charges deterministically", () => {
    expect(normalizeTxName("www.perplexity.ai")).toBe("Perplexity");
    expect(normalizeTxName("Www.perplexity.ai")).toBe("Perplexity");
  });

  it("normalizes known storefront and game charges deterministically", () => {
    expect(normalizeTxName("SPO*PRIMEBURGER")).toBe("Primeburger");
    expect(normalizeTxName("spo*primeburger")).toBe("Primeburger");
    expect(normalizeTxName("BLIZZARD*US")).toBe("Blizzard");
    expect(normalizeTxName("BLIZZARD*CALL OF DUTY")).toBe("Call of Duty");
  });
});
