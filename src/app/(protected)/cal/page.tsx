import { ShiftlyCalView } from "@/components/cal/ShiftlyCalView";
import { getShiftlyCalData } from "@/lib/cal/data";

export const maxDuration = 120;

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
        <ShiftlyCalView initialData={data} weekStartIso={data.currentWeek.weekStartIso} />
      </div>
    </main>
  );
}
