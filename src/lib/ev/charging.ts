export type EvChargingSettings = {
  efficiencyWhPerMile: number;
  freeHoursPerWeek: number;
  freeMilesPerHour: number;
  homeRateCentsPerKwh: number;
  publicRateCentsPerKwh: number;
  chargingLossPercent: number;
  typicalMilesPerWeek: number;
  explorerMpg: number;
  gasPricePerGallonCents: number;
  gasArchived: boolean;
};

export type EvChargingInput = EvChargingSettings & {
  milesDriven: number;
};

export type EvChargingResult = {
  milesDriven: number;
  freeRangeMiles: number;
  freeMilesUsed: number;
  paidMiles: number;
  freeMilesUnused: number;
  kwhPerMile: number;
  paidKwh: number;
  totalKwh: number;
  paidCostCents: number;
  weeklyCostCents: number;
  monthlyCostCents: number;
  blendedCentsPerMile: number;
  paidCentsPerMile: number;
  homeCentsPerMile: number;
  freeCentsPerMile: number;
  breakevenMilesPerWeek: number;
  explorerCentsPerMile: number;
};

export const DEFAULT_EV_CHARGING_SETTINGS: EvChargingSettings = {
  efficiencyWhPerMile: 250,
  freeHoursPerWeek: 69,
  freeMilesPerHour: 4,
  homeRateCentsPerKwh: 30,
  publicRateCentsPerKwh: 45,
  chargingLossPercent: 13,
  typicalMilesPerWeek: 125,
  explorerMpg: 19,
  gasPricePerGallonCents: 335,
  gasArchived: false,
};

export function calculateEvCharging(
  input: EvChargingInput,
): EvChargingResult {
  const freeRangeMiles = input.freeHoursPerWeek * input.freeMilesPerHour;
  const freeMilesUsed = Math.min(input.milesDriven, freeRangeMiles);
  const paidMiles = Math.max(0, input.milesDriven - freeRangeMiles);
  const freeMilesUnused = Math.max(0, freeRangeMiles - input.milesDriven);
  const lossFactor = 1 + input.chargingLossPercent / 100;
  const kwhPerMile = (input.efficiencyWhPerMile / 1000) * lossFactor;
  const paidKwh = paidMiles * kwhPerMile;
  const totalKwh = input.milesDriven * kwhPerMile;
  const paidCostCents = Math.round(
    paidKwh * input.publicRateCentsPerKwh,
  );
  const weeklyCostCents = paidCostCents;

  return {
    milesDriven: input.milesDriven,
    freeRangeMiles,
    freeMilesUsed,
    paidMiles,
    freeMilesUnused,
    kwhPerMile,
    paidKwh,
    totalKwh,
    paidCostCents,
    weeklyCostCents,
    monthlyCostCents: Math.round(weeklyCostCents * 4.33),
    blendedCentsPerMile:
      input.milesDriven > 0
        ? Math.round(weeklyCostCents / input.milesDriven)
        : 0,
    paidCentsPerMile: Math.round(
      input.publicRateCentsPerKwh * kwhPerMile,
    ),
    homeCentsPerMile: Math.round(
      input.homeRateCentsPerKwh * kwhPerMile,
    ),
    freeCentsPerMile: 0,
    breakevenMilesPerWeek: freeRangeMiles,
    explorerCentsPerMile: Math.round(
      input.gasPricePerGallonCents / input.explorerMpg,
    ),
  };
}
