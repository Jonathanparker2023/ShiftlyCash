import Link from "next/link";

import { DashboardEditor } from "@/components/dashboard/DashboardEditor";
import { getDashboardData } from "@/lib/dashboard/data";

export default async function HomePage() {
  const dashboardData = await getDashboardData();
  // Only remount when the active week changes (week close). For any other
  // edit, React reconciles props and preserves client state (focused day,
  // expanded drawers, etc.).
  return (
    <>
      <DashboardEditor initialData={dashboardData} key={dashboardData.week.id} />
      <Link
        aria-label="Log food in ShiftlyCal"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-white/30 bg-emerald-500/85 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(8,15,28,0.42)] backdrop-blur-md transition hover:bg-emerald-500 hover:shadow-[0_16px_40px_rgba(8,15,28,0.5)] active:scale-95 sm:bottom-8 sm:right-8"
        href="/cal"
      >
        <span aria-hidden="true" className="text-base">🍽️</span>
        <span>Log food</span>
      </Link>
    </>
  );
}
