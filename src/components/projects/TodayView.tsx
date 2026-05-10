import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { getTodayData } from "@/lib/projects/data";
import type { ProjectTask } from "@/lib/projects/types";

export async function TodayView({ todayIso }: { todayIso: string }) {
  const { supabase } = await requireUser();
  const data = await getTodayData(supabase, todayIso);

  return (
    <section className="mb-4 rounded-md border border-white/15 bg-black/20 backdrop-blur-md p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
            Today
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            Due now
          </h2>
        </div>
        <span className="rounded-full border border-white/15 bg-black/15 backdrop-blur-md px-3 py-1 text-xs font-semibold text-white/85">
          {formatDate(todayIso)}
        </span>
      </div>

      <TaskGroup emptyText="Nothing due today." tasks={data.dueToday} />

      <div className="mt-4 border-t border-white/10 pt-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
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
      <p className="mt-2 rounded-md border border-dashed border-white/20 bg-black/15 backdrop-blur-md px-3 py-3 text-sm text-white/70">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {tasks.map((task) => (
        <Link
          className="block rounded-md border border-white/10 bg-black/15 backdrop-blur-md px-3 py-2 transition hover:border-white/50 hover:bg-white/15"
          href={`/projects/${task.projectId}`}
          key={task.id}
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {task.title}
              </p>
              <p className="text-xs text-white/70">{task.projectName ?? "Project"}</p>
            </div>
            {task.dueDate ? (
              <span className="shrink-0 text-xs font-semibold text-sky-200">
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
