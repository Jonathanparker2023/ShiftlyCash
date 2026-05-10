import Link from "next/link";
import { notFound } from "next/navigation";

import { HistoryWeekView } from "@/components/history/HistoryWeekView";
import { ReopenWeekButton } from "@/components/history/ReopenWeekButton";
import { getHistoryDetailData } from "@/lib/history/data";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ week_id: string }>;
}) {
  const { week_id: weekId } = await params;
  const data = await getHistoryDetailData(weekId);

  if (!data) {
    notFound();
  }

  const dateRange = formatDateRange(data.week.startDate, data.week.endDate);
  const statusLabel = data.week.archivedAt ? "archived" : data.week.status;

  return (
    <div className="min-h-screen px-3 py-4 text-white sm:px-4 lg:px-6">
      <header className="mx-auto mb-5 flex max-w-7xl flex-col gap-4 rounded-md border border-white/20 bg-black/20 p-4 shadow-[0_10px_30px_rgba(8,15,28,0.22)] backdrop-blur-md md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/65">
            ShiftlyCash history
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              Week {data.week.displayWeekNumber}
            </h1>
            <span className="rounded-full border border-white/20 bg-black/20 backdrop-blur-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-white shadow-sm">
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-white/75">{dateRange}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            className="h-9 rounded-md border border-white/25 bg-black/20 backdrop-blur-md px-3 py-2 text-sm font-semibold text-white transition hover:border-white/50 hover:bg-black/20 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-white"
            href="/history"
          >
            Back to History
          </Link>
          {data.week.status === "closed" ? (
            <ReopenWeekButton
              dateRange={dateRange}
              displayWeekNumber={data.week.displayWeekNumber}
              weekId={data.week.id}
            />
          ) : null}
        </div>
      </header>

      <HistoryWeekView data={data} />
    </div>
  );
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${startDate}T00:00:00.000Z`));
  const end = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${endDate}T00:00:00.000Z`));

  return `${start}-${end}`;
}
