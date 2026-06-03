export type AppEdition = "personal" | "consumer";

export type EditionCapabilities = {
  showDashboard: boolean;
  showFixed: boolean;
  showHistory: boolean;
  showDebt: boolean;
  showBanking: boolean;
  showNetWorth: boolean;
  showIncomeSources: boolean;
  showPaycheckAudit: boolean;
  showCal: boolean;
  showWealthProjection: boolean;
  showTaxSetAside: boolean;
  showWeeklyTemplate: boolean;
};

export const EDITION_CAPABILITIES = {
  personal: {
    showDashboard: true,
    showFixed: true,
    showHistory: true,
    showDebt: true,
    showBanking: true,
    showNetWorth: true,
    showIncomeSources: true,
    showPaycheckAudit: true,
    showCal: true,
    showWealthProjection: true,
    showTaxSetAside: true,
    showWeeklyTemplate: true,
  },
  consumer: {
    showDashboard: true,
    showFixed: true,
    showHistory: true,
    showDebt: true,
    showBanking: true,
    showNetWorth: true,
    showIncomeSources: true,
    showPaycheckAudit: false,
    showCal: false,
    showWealthProjection: false,
    showTaxSetAside: false,
    showWeeklyTemplate: false,
  },
} as const satisfies Record<AppEdition, EditionCapabilities>;

export const EDITION = normalizeEdition(
  process.env.APP_EDITION ?? process.env.NEXT_PUBLIC_APP_EDITION,
);

export const NEXT_PUBLIC_APP_EDITION = normalizeEdition(
  process.env.NEXT_PUBLIC_APP_EDITION ?? process.env.APP_EDITION,
);

export const CAPABILITIES = EDITION_CAPABILITIES[EDITION];

export function normalizeEdition(value: string | undefined): AppEdition {
  return value === "consumer" || value === "personal" ? value : "personal";
}
