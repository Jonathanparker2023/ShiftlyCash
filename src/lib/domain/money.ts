export type MoneyCents = number;

export function dollarsToCents(value: number): MoneyCents {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100);
}

export function centsToDollars(value: MoneyCents): number {
  return value / 100;
}

export function multiplyCents(value: MoneyCents, multiplier: number): MoneyCents {
  if (!Number.isFinite(value) || !Number.isFinite(multiplier)) {
    return 0;
  }

  return Math.round(value * multiplier);
}

export function roundCentsToNearestTenDollars(value: MoneyCents): MoneyCents {
  return Math.round(value / 1000) * 1000;
}
