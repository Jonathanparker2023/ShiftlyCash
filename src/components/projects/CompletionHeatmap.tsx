import { requireUser } from "@/lib/auth";
import { getCompletionHeatmapData } from "@/lib/projects/data";
import type { CompletionHeatmapDay } from "@/lib/projects/types";

export async function CompletionHeatmap({ projectId }: { projectId: string }) {
  const { supabase } = await requireUser();
  const days = await getCompletionHeatmapData(supabase, projectId, 84);
  const weeks = chunkWeeks(days);

  return (
    <section className="mt-4 rounded-md border border-[#d7dee8] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#334155]">
          Completion Heatmap
        </h2>
        <span className="text-xs font-semibold text-[#64748b]">12 weeks</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <div className="grid w-max grid-flow-col grid-rows-7 gap-1">
          {weeks.flatMap((week) =>
            week.map((day) => (
              <div
                className={`h-3 w-3 rounded-[3px] ${heatClass(day.count)}`}
                key={day.date}
                title={`${formatDate(day.date)}: ${day.count} completed`}
              />
            )),
          )}
        </div>
      </div>
    </section>
  );
}

function chunkWeeks(days: CompletionHeatmapDay[]): CompletionHeatmapDay[][] {
  const weeks: CompletionHeatmapDay[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }

  return weeks;
}

function heatClass(count: number): string {
  if (count >= 6) return "bg-emerald-600";
  if (count >= 3) return "bg-emerald-400";
  if (count >= 1) return "bg-emerald-200";
  return "bg-zinc-200/30";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
