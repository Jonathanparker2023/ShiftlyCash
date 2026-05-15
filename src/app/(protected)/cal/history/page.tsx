import Link from "next/link";

import { ShiftlyCalHistoryView } from "@/components/cal/ShiftlyCalHistoryView";
import { getShiftlyCalHistoryData } from "@/lib/cal/data";

export default async function ShiftlyCalHistoryPage() {
  const data = await getShiftlyCalHistoryData();

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
                History
              </h1>
              <p className="mt-1 text-sm text-white/70">
                Weekly nutrition history with read-only week views.
              </p>
            </div>
            <Link
              className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-sm font-semibold text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20"
              href="/cal"
            >
              Back to log
            </Link>
          </div>
        </div>

        <ShiftlyCalHistoryView data={data} />
      </div>
    </main>
  );
}
