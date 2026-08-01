import { GoalsExperience } from "@/components/goals/GoalsExperience";
import type { GoalsData } from "@/lib/goals/data";

// Offline preview of the goal ladder with fixed numbers, so the layout can be
// worked on without a database or a session.
const previewData: GoalsData = {
  weekLabel: "Preview week",
  todayIso: "2026-08-01",
  bankedCents: 17_241_30,
  medianWeeklyCashflowCents: 606_00,
  activeDebtCents: 47_042_30,
  explorerCents: 13_923_00,
  teslaCents: 31_836_00,
};

export default function GoalsPreviewLocalPage() {
  return <GoalsExperience data={previewData} />;
}
