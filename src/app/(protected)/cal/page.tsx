import { redirect } from "next/navigation";

import {
  peekFocusedDayCoachReviewAction,
  peekWeeklyCoachReviewAction,
} from "@/app/(protected)/cal/coachReviewActions";
import { ShiftlyCalView } from "@/components/cal/ShiftlyCalView";
import { getShiftlyCalData } from "@/lib/cal/data";
import { CAPABILITIES } from "@/lib/edition";

export const maxDuration = 120;

export default async function ShiftlyCalPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  if (!CAPABILITIES.showCal) {
    redirect("/");
  }

  const { week } = await searchParams;
  const data = await getShiftlyCalData({ weekStartIso: week });
  const [initialDayReview, initialWeekReview] = await Promise.all([
    peekFocusedDayCoachReviewAction(data.todayIso).catch(() => ({
      ok: false as const,
      reason: "peek failed",
    })),
    peekWeeklyCoachReviewAction().catch(() => ({
      ok: false as const,
      reason: "peek failed",
    })),
  ]);

  return (
    <main className="min-h-screen px-3 py-4 text-[var(--text-primary)] sm:px-4 lg:px-6">
      <div className="mx-auto max-w-7xl">
        <ShiftlyCalView
          initialData={data}
          initialDayReview={initialDayReview.ok ? initialDayReview : null}
          initialWeekReview={initialWeekReview.ok ? initialWeekReview : null}
          weekStartIso={data.currentWeek.weekStartIso}
        />
      </div>
    </main>
  );
}
