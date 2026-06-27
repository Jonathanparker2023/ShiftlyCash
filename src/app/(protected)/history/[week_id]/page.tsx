import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DashboardEditor } from "@/components/dashboard/DashboardEditor";
import { getWeekDashboardData } from "@/lib/dashboard/data";
import type { DashboardData } from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ week_id: string }>;
}) {
  const { week_id: weekId } = await params;

  let data: DashboardData | null = null;
  try {
    data = await getWeekDashboardData(weekId);
  } catch {
    notFound();
  }
  if (!data) {
    notFound();
  }

  // The active week belongs on the dashboard, not the read-only history view.
  if (data.week.status !== "closed") {
    redirect("/");
  }

  return (
    <div>
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 pt-4 sm:px-4 lg:px-6">
        <Link
          className="inline-flex h-9 items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm font-semibold text-[var(--text-primary)] backdrop-blur-md transition hover:border-[var(--border-strong)]"
          href="/trends"
        >
          ← Back to Trends
        </Link>
        <Link
          className="inline-flex h-9 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 text-sm font-semibold text-[var(--text-tertiary)] backdrop-blur-md transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          href="/history"
        >
          History
        </Link>
      </div>
      <DashboardEditor initialData={data} key={data.week.id} mode="historical" />
    </div>
  );
}
