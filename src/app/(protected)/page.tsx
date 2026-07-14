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
    <DashboardEditor
      initialData={dashboardData}
      key={dashboardData.week.id}
      nextPaycheck={nextPaycheck}
    />
  );
}
