import { notFound } from "next/navigation";

import { ShiftlyCalWeekView } from "@/components/cal/ShiftlyCalWeekView";
import { getShiftlyCalData } from "@/lib/cal/data";

export default async function ShiftlyCalHistoryWeekPage({
  params,
}: {
  params: Promise<{ week_start: string }>;
}) {
  const { week_start: weekStartIso } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartIso)) {
    notFound();
  }

  const data = await getShiftlyCalData({ weekStartIso });

  return (
    <main className="min-h-screen px-3 py-4 text-white sm:px-4 lg:px-6">
      <div className="mx-auto max-w-7xl">
        <ShiftlyCalWeekView initialData={data} />
      </div>
    </main>
  );
}
