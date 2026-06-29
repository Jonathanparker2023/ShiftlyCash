import Link from "next/link";

import {
  DashboardEditor,
  type NextPaycheck,
} from "@/components/dashboard/DashboardEditor";
import { getDashboardData } from "@/lib/dashboard/data";
import { getPaycheckAuditData } from "@/lib/paychecks/data";

// Upcoming paycheck (date + projected net) for the dashboard countdown card.
// Defensive: a paycheck-calc hiccup must never take down the dashboard.
async function loadNextPaycheck(): Promise<NextPaycheck | null> {
  try {
    const { periods } = await getPaycheckAuditData();
    const current = periods.find((period) => period.id === "current");
    if (!current?.paycheckDueDate) {
      return null;
    }
    const netCents = current.jobs.reduce(
      (sum, job) => sum + job.estimatedNetCents,
      0,
    );
    return { dueDateIso: current.paycheckDueDate, netCents };
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [dashboardData, nextPaycheck] = await Promise.all([
    getDashboardData(),
    loadNextPaycheck(),
  ]);
  // Only remount when the active week changes (week close). For any other
  // edit, React reconciles props and preserves client state (focused day,
  // expanded drawers, etc.).
  return (
    <>
      <DashboardEditor
        initialData={dashboardData}
        key={dashboardData.week.id}
        nextPaycheck={nextPaycheck}
      />
      <Link
        aria-label="Log food in ShiftlyCal"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-emerald-500/85 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(8,15,28,0.42)] backdrop-blur-md transition hover:bg-emerald-500 hover:shadow-[0_16px_40px_rgba(8,15,28,0.5)] active:scale-95 sm:bottom-8 sm:right-8"
        href="/cal"
      >
        <span aria-hidden="true" className="text-base">🍽️</span>
        <span>Log food</span>
      </Link>
    </>
  );
}
