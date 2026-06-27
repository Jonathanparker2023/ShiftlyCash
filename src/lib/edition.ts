export type AppEdition = "personal" | "consumer";

export type EditionCapabilities = {
  showDashboard: boolean;
  showFixed: boolean;
  showHistory: boolean;
  showGoals: boolean;
  showDebt: boolean;
  showBanking: boolean;
  showNetWorth: boolean;
  showIncomeSources: boolean;
  showTrends: boolean;
  showSetup: boolean;
  showPaycheckAudit: boolean;
  showCal: boolean;
  showScreener: boolean;
  showWealthProjection: boolean;
  showTaxSetAside: boolean;
  showWeeklyTemplate: boolean;
  showCustomJobs: boolean;
};

export const EDITION_CAPABILITIES = {
  personal: {
    showDashboard: true,
    showFixed: true,
    showHistory: true,
    showGoals: true,
    showDebt: true,
    showBanking: true,
    showNetWorth: true,
    showIncomeSources: true,
    showTrends: true,
    showSetup: false,
    showPaycheckAudit: true,
    showCal: true,
    showScreener: true,
    showWealthProjection: true,
    showTaxSetAside: true,
    showWeeklyTemplate: true,
    showCustomJobs: true,
  },
  consumer: {
    showDashboard: true,
    showFixed: true,
    showHistory: true,
    showGoals: false,
    showDebt: true,
    showBanking: true,
    showNetWorth: true,
    showIncomeSources: true,
    showTrends: true,
    showSetup: true,
    showPaycheckAudit: false,
    showCal: false,
    showScreener: false,
    showWealthProjection: false,
    showTaxSetAside: false,
    showWeeklyTemplate: false,
    showCustomJobs: false,
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
