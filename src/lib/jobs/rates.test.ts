import { describe, expect, it } from "vitest";

import {
  netRateFromGross,
  percentFromRate,
  rateFromPercent,
} from "@/lib/jobs/rates";

describe("custom job rates", () => {
  it("converts gross hourly and withholding into net cents", () => {
    expect(netRateFromGross(1900, 0.18)).toBe(1558);
  });

  it("keeps zero withholding byte-compatible with old net-only rows", () => {
    expect(netRateFromGross(1800, 0)).toBe(1800);
  });

  it("normalizes percentage form input to a fractional withholding rate", () => {
    expect(rateFromPercent(18.25)).toBe(0.1825);
    expect(percentFromRate(0.1825)).toBe(18.3);
  });
});
