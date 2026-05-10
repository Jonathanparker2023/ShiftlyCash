import { DashboardEditor } from "@/components/dashboard/DashboardEditor";
import { getDashboardData } from "@/lib/dashboard/data";

export default async function HomePage() {
  const dashboardData = await getDashboardData();
  // Only remount when the active week changes (week close). For any other
  // edit, React reconciles props and preserves client state (focused day,
  // expanded drawers, etc.).
  return (
    <DashboardEditor initialData={dashboardData} key={dashboardData.week.id} />
  );
}
