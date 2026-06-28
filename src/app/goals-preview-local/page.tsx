import { GoalsExperience } from "@/components/goals/GoalsExperience";
import type { GoalsData } from "@/lib/goals/data";

const previewData: GoalsData = {
  runningBalanceCents: 1815000,
  activeDebtCents: 1280000,
  weekLabel: "Preview week",
  goals: [
    {
      id: "porsche-cayman-gts",
      title: "Porsche Cayman GTS",
      kicker: "Dream car",
      description: "Unlocked when running balance clears the Cayman threshold.",
      kind: "balance_threshold",
      currentCents: 1815000,
      targetCents: 10000000,
      remainingCents: 8185000,
      progress: 0.1815,
      status: "in_progress",
      accent: "brand",
      unlockCopy: "Cayman threshold unlocked",
    },
    {
      id: "four-family-brrr",
      title: "4-family BRRR",
      kicker: "Dream house",
      description: "Down payment, reserves, and rehab runway for the first BRRR move.",
      kind: "balance_threshold",
      currentCents: 1815000,
      targetCents: 15000000,
      remainingCents: 13185000,
      progress: 0.121,
      status: "in_progress",
      accent: "positive",
      unlockCopy: "BRRR war chest unlocked",
    },
    {
      id: "ford-explorer-payoff",
      title: "Ford Explorer",
      kicker: "Debt payoff",
      description: "Explorer clears when the debt balance hits zero.",
      kind: "debt_clear",
      currentCents: 1280000,
      targetCents: 0,
      remainingCents: 1280000,
      progress: 0,
      status: "in_progress",
      accent: "negative",
      unlockCopy: "Explorer debt cleared",
    },
  ],
  timeline: [
    {
      id: "ford-explorer-payoff",
      title: "Ford Explorer",
      caption: "$12,800 remaining",
      status: "in_progress",
    },
    {
      id: "porsche-cayman-gts",
      title: "Porsche Cayman GTS",
      caption: "$100K threshold",
      status: "in_progress",
    },
    {
      id: "four-family-brrr",
      title: "4-family BRRR",
      caption: "$150K threshold",
      status: "in_progress",
    },
  ],
};

export default function GoalsPreviewLocalPage() {
  return <GoalsExperience data={previewData} />;
}
