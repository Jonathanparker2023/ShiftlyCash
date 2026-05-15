import Link from "next/link";

import { ShiftlyCalLibraryView } from "@/components/cal/ShiftlyCalLibraryView";
import { getShiftlyCalData } from "@/lib/cal/data";

export default async function ShiftlyCalLibraryPage() {
  const data = await getShiftlyCalData();

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
                Saved foods & targets
              </h1>
              <p className="mt-1 text-sm text-white/70">
                Manage the reusable foods and target numbers that power the log.
              </p>
            </div>
            <Link
              className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-sm font-semibold text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20"
              href={`/cal?week=${data.currentWeek.weekStartIso}`}
            >
              Back to log
            </Link>
          </div>
        </div>

        <ShiftlyCalLibraryView
          savedFoods={data.savedFoods}
          targets={data.targets}
        />
      </div>
    </main>
  );
}
