import Link from "next/link";

import { ShiftlyCalTrendsView } from "@/components/cal/ShiftlyCalTrendsView";
import { getShiftlyCalTrendsData } from "@/lib/cal/data";

export default async function ShiftlyCalTrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const data = await getShiftlyCalTrendsData({ weekStartIso: week });

  return (
    <main className="min-h-screen px-3 py-4 text-white sm:px-4 lg:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.22)] backdrop-blur-md sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                ShiftlyCal
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
                Trends
              </h1>
            </div>
            <Link
              className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-sm font-semibold text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20"
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
