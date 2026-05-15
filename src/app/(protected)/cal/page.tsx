import { ShiftlyCalView } from "@/components/cal/ShiftlyCalView";
import { getShiftlyCalData } from "@/lib/cal/data";

export default async function ShiftlyCalPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const data = await getShiftlyCalData({ weekStartIso: week });

  return (
    <main className="min-h-screen px-3 py-4 text-white sm:px-4 lg:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 rounded-md border border-white/15 bg-black/15 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.22)] backdrop-blur-md sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
            ShiftlyCal
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
            Food log
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/70">
            Manual calories, optional macros, quick saved-food logging, and a weekly
            energy-balance view.
          </p>
        </div>

        <ShiftlyCalView initialData={data} weekStartIso={data.currentWeek.weekStartIso} />
      </div>
    </main>
  );
}
