import Link from "next/link";
import { redirect } from "next/navigation";

import { ShiftlyCalTrendsView } from "@/components/cal/ShiftlyCalTrendsView";
import { getShiftlyCalTrendsData } from "@/lib/cal/data";
import { CAPABILITIES } from "@/lib/edition";

export const maxDuration = 60;

export default async function ShiftlyCalTrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  if (!CAPABILITIES.showCal) {
    redirect("/");
  }

  const { week } = await searchParams;
  const data = await getShiftlyCalTrendsData({ weekStartIso: week });

  return (
    <main className="min-h-screen px-3 py-4 text-[var(--text-primary)] sm:px-4 lg:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.22)] backdrop-blur-md sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                ShiftlyCal
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
                Trends
              </h1>
            </div>
            <Link
              className="rounded-full border border-[var(--border-default)] bg-[var(--surface-hover)] px-3 py-1 text-sm font-semibold text-[var(--text-primary)] shadow-sm backdrop-blur-sm transition hover:bg-[var(--surface-hover)]"
              href={`/cal?week=${data.currentWeek.weekStartIso}`}
            >
              Back to log
            </Link>
          </div>
        </div>

        <ShiftlyCalTrendsView
          initialData={data}
          weekStartIso={data.currentWeek.weekStartIso}
        />
      </div>
    </main>
  );
}
