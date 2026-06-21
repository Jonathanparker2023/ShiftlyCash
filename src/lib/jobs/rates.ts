export const MAX_WITHHOLDING_RATE = 0.99;

// Custom-job overtime is always time-and-a-half of the regular gross rate, so the
// user never enters it. (Built-in jobs keep their own real OT rate — e.g. Ability
// is 1.39x, not 1.5x — and are not derived this way.)
export const OT_MULTIPLIER = 1.5;

export function otGrossFromRegular(regularGrossRateCents: number): number {
  return Math.round(Math.max(0, regularGrossRateCents) * OT_MULTIPLIER);
}

export function normalizeWithholdingRate(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Withholding rate must be between 0% and 99%.");
  }

  return Math.round(value * 10000) / 10000;
}

export function netRateFromGross(
  grossRateCents: number,
  withholdingRate: number,
): number {
  const gross = Math.round(Math.max(0, grossRateCents));
  const rate = normalizeWithholdingRate(withholdingRate);
  return Math.round(gross * (1 - rate));
}

export function rateFromPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }

  const normalized = Math.min(MAX_WITHHOLDING_RATE, Math.max(0, percent / 100));
  return Math.round(normalized * 10000) / 10000;
}

export function percentFromRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return 0;
  }

  return Math.round(Math.min(MAX_WITHHOLDING_RATE, Math.max(0, rate)) * 1000) / 10;
}
