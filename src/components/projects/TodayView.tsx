import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { getTodayData } from "@/lib/projects/data";
import type { ProjectTask } from "@/lib/projects/types";

export async function TodayView({ todayIso }: { todayIso: string }) {
  const { supabase } = await requireUser();
  const data = await getTodayData(supabase, todayIso);

  return (
    <section className="mb-4 rounded-md border border-[#d7dee8] bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b]">
            Today
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[#0f172a]">
            Due now
          </h2>
        </div>
        <span className="rounded-full border border-[#d7dee8] bg-[#f8fafc] px-3 py-1 text-xs font-semibold text-[#334155]">
          {formatDate(todayIso)}
        </span>
      </div>

      <TaskGroup emptyText="Nothing due today." tasks={data.dueToday} />

      <div className="mt-4 border-t border-[#e2e8f0] pt-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b]">
          This Week
        </p>
        <TaskGroup emptyText="No more dated tasks this week." tasks={data.dueThisWeek} />
      </div>
    </section>
  );
}

function TaskGroup({
  emptyText,
  tasks,
}: {
  emptyText: string;
  tasks: ProjectTask[];
}) {
  if (tasks.length === 0) {
    return (
      <p className="mt-2 rounded-md border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-3 text-sm text-[#64748b]">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {tasks.map((task) => (
        <Link
          className="block rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 transition hover:border-[#1d4ed8] hover:bg-[#eff6ff]"
          href={`/projects/${task.projectId}`}
          key={task.id}
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#0f172a]">
                {task.title}
              </p>
              <p className="text-xs text-[#64748b]">{task.projectName ?? "Project"}</p>
            </div>
            {task.dueDate ? (
              <span className="shrink-0 text-xs font-semibold text-[#1d4ed8]">
                {formatDate(task.dueDate)}
              </span>
            ) : null}
          </div>
        </Link>
      ))}
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
