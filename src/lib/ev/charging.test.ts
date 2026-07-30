import { describe, expect, it } from "vitest";

import {
  calculateEvCharging,
  DEFAULT_EV_CHARGING_SETTINGS,
} from "./charging";

describe("calculateEvCharging", () => {
  it("keeps a typical week entirely inside the free ceiling", () => {
    const result = calculateEvCharging({
      ...DEFAULT_EV_CHARGING_SETTINGS,
      milesDriven: 125,
    });

    expect(result.paidMiles).toBe(0);
    expect(result.weeklyCostCents).toBe(0);
    expect(result.blendedCentsPerMile).toBe(0);
    expect(result.freeMilesUnused).toBe(151);
  });

  it("prices only miles above the free ceiling at the public rate", () => {
    const result = calculateEvCharging({
      ...DEFAULT_EV_CHARGING_SETTINGS,
      milesDriven: 400,
    });

    expect(result.freeRangeMiles).toBe(276);
    expect(result.freeMilesUsed).toBe(276);
    expect(result.paidMiles).toBe(124);
    expect(result.paidKwh).toBeCloseTo(35.03, 2);
    expect(result.weeklyCostCents).toBe(1_576);
  });

  it("returns zero cost and mileage outputs for a zero-mile week", () => {
    const result = calculateEvCharging({
      ...DEFAULT_EV_CHARGING_SETTINGS,
      milesDriven: 0,
    });

    expect(result.totalKwh).toBe(0);
    expect(result.weeklyCostCents).toBe(0);
    expect(result.blendedCentsPerMile).toBe(0);
    expect(result.freeMilesUnused).toBe(276);
  });

  it("matches the reference home, public, and Explorer costs per mile", () => {
    const result = calculateEvCharging({
      ...DEFAULT_EV_CHARGING_SETTINGS,
      milesDriven: 125,
    });

    expect(result.homeCentsPerMile).toBe(8);
    expect(result.paidCentsPerMile).toBe(13);
    expect(result.explorerCentsPerMile).toBe(18);
  });
});
