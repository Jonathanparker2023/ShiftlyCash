import { GoalsExperience } from "@/components/goals/GoalsExperience";
import type { GoalsData } from "@/lib/goals/data";

// Offline preview of the goal ladder with fixed numbers, so the layout can be
// worked on without a database or a session. Editing controls will error here
// because the server actions need a real user.
const previewData: GoalsData = {
  weekLabel: "Preview week",
  todayIso: "2026-08-01",
  medianWeeklyCashflowCents: 614_00,
  availableCashCents: 7_147_00,
  cashBalanceSource: "plaid",
  cashBalanceStale: false,
  cashBalanceAsOf: "2026-08-28T10:00:00.000Z",
  debts: [
    {
      name: "Auto Loan - Holyoke CU - 2017 Ford Explorer",
      cents: 13_923_00,
      apr: 0.188,
      minimumPaymentCents: 455_33,
    },
    {
      name: "Auto Loan - TD Auto Finance - 2024 Tesla Model 3",
      cents: 31_836_00,
      apr: 0.1094,
      minimumPaymentCents: 605_94,
    },
  ],
  rungs: [
    {
      id: "preview-house-hack",
      orderIndex: 1,
      title: "Multifamily house hack",
      kicker: "Rung one",
      description: "FHA entry cash for a Hartford-area multifamily.",
      imageSrc: "/goals/multifamily-house-hack.png",
      targetKind: "house_hack",
      targetCents: 0,
      debtMatch: null,
      deadlineOn: null,
      deadlineLabel: null,
    },
    {
      id: "preview-explorer",
      orderIndex: 2,
      title: "Clear the Explorer",
      kicker: "Rung two",
      description: "The most expensive money on the board at 18.8%.",
      imageSrc: "/goals/explorer-payoff.png",
      targetKind: "debt",
      targetCents: 0,
      debtMatch: "explorer|holyoke",
      deadlineOn: "2029-12-16",
      deadlineLabel: "Explorer loan matures",
    },
    {
      id: "preview-tesla",
      orderIndex: 3,
      title: "Kill the Tesla note",
      kicker: "Rung three",
      description: "72 months at 10.94%.",
      imageSrc: "/goals/tesla-payoff.png",
      targetKind: "debt",
      targetCents: 0,
      debtMatch: "tesla|td auto",
      deadlineOn: "2032-07-01",
      deadlineLabel: "Tesla loan matures",
    },
    {
      id: "preview-brrr",
      orderIndex: 4,
      title: "BRRR business capital",
      kicker: "Rung four",
      description: "Buy, rehab, rent, refinance, repeat.",
      imageSrc: "/goals/brrr-capital.png",
      targetKind: "fixed",
      targetCents: 90_000_00,
      debtMatch: null,
      deadlineOn: null,
      deadlineLabel: null,
    },
  ],
};

export default function GoalsPreviewLocalPage() {
  return <GoalsExperience data={previewData} />;
}
