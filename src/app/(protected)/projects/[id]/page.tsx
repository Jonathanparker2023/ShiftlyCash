import Link from "next/link";
import { redirect } from "next/navigation";

import { CompletionHeatmap } from "@/components/projects/CompletionHeatmap";
import { TaskList } from "@/components/projects/TaskList";
import { CAPABILITIES } from "@/lib/edition";
import { getProjectDetailData } from "@/lib/projects/data";
import type { ProjectEventItem } from "@/lib/projects/types";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!CAPABILITIES.showProjects) {
    redirect("/");
  }

  const { id } = await params;
  const { project, events } = await getProjectDetailData(id);

  return (
    <main className="min-h-screen px-3 py-4 text-white sm:px-4 lg:px-6">
      <section className="mx-auto max-w-7xl overflow-hidden rounded-xl border border-white/15 bg-black/15 backdrop-blur-md shadow-[0_24px_70px_rgba(0,0,0,0.22)]">
        <div className="h-2 bg-zinc-950" />
        <div className="p-4 sm:p-5">
          <Link
            className="mb-4 inline-flex text-sm font-semibold text-sky-200 transition hover:text-white"
            href="/projects"
          >
            Back to projects
          </Link>

          <header className="grid gap-4 rounded-md border border-white/15 bg-black/20 backdrop-blur-md p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  {project.name}
                </h1>
                {project.status === "archived" ? (
                  <span className="rounded-full border border-white/20 bg-black/15 backdrop-blur-md px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-white/70">
                    Archived
                  </span>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                <span className="rounded-full border border-white/15 bg-black/15 backdrop-blur-md px-3 py-1 text-white/85">
                  {project.progress.done} / {project.progress.total} tasks done
                </span>
                {project.deadline ? (
                  <span className="rounded-full border border-sky-300/50 bg-sky-500/15 px-3 py-1 text-emerald-300">
                    Due {formatDate(project.deadline)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="min-w-[180px]">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.12em] text-white/70">
                <span>Progress</span>
                <span>{project.progress.percent}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-sky-500/70"
                  style={{ width: `${project.progress.percent}%` }}
                />
              </div>
            </div>
          </header>

          {project.description ? (
            <section className="mt-4 rounded-md border border-white/15 bg-black/20 backdrop-blur-md p-4 text-sm leading-6 text-white/85 shadow-sm">
              {project.description}
            </section>
          ) : null}

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
            <section className="overflow-hidden rounded-md border border-white/15 bg-black/20 backdrop-blur-md shadow-sm">
              <div className="border-b border-white/10 px-4 py-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/85">
                  Tasks
                </h2>
              </div>
              <TaskList project={project} />
            </section>

            <section className="rounded-md border border-white/15 bg-black/20 backdrop-blur-md p-4 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/85">
                Activity
              </h2>
              <div className="mt-3 space-y-2">
                {events.length > 0 ? (
                  events.map((event) => (
                    <div
                      className="rounded-md border border-white/10 bg-black/15 backdrop-blur-md px-3 py-2 text-sm text-white/85"
                      key={event.id}
                    >
                      {formatEventLine(event)}
                    </div>
                  ))
                ) : (
                  <p className="rounded-md border border-dashed border-white/20 bg-black/15 backdrop-blur-md px-3 py-3 text-sm text-white/70">
                    No activity yet.
                  </p>
                )}
              </div>
              <CompletionHeatmap projectId={project.id} />
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}

function formatEventLine(event: ProjectEventItem): string {
  const ago = formatRelativeTime(event.createdAt);
  const title = getStringPayload(event, "title");
  const name = getStringPayload(event, "name");
  const fields = getStringArrayPayload(event, "changedFields");

  switch (event.kind) {
    case "project.created":
      return `Created project "${name ?? "Project"}" (${ago})`;
    case "project.updated":
      return `Updated ${fields.length > 0 ? fields.join(", ") : "project"} (${ago})`;
    case "project.archived":
      return `Archived project (${ago})`;
    case "project.deleted":
      return `Deleted project "${name ?? "Project"}" (${ago})`;
    case "task.created":
      return `Added task "${title ?? "Task"}" (${ago})`;
    case "task.updated":
      return `Updated task ${fields.length > 0 ? fields.join(", ") : "fields"} (${ago})`;
    case "task.completed":
      return `Completed task "${title ?? "Task"}" (${ago})`;
    case "task.deleted":
      return `Deleted task "${title ?? "Task"}" (${ago})`;
    case "tasks.reordered":
      return `Reordered tasks (${ago})`;
    case "projects.reordered":
      return `Reordered projects (${ago})`;
    default:
      return `Updated project activity (${ago})`;
  }
}

function getStringPayload(
  event: ProjectEventItem,
  key: string,
): string | null {
  const value = event.payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function getStringArrayPayload(event: ProjectEventItem, key: string): string[] {
  const value = event.payload[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function formatRelativeTime(value: string): string {
  const createdAt = new Date(value).getTime();
  const diffMs = Math.max(0, Date.now() - createdAt);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return "just now";
  }

  if (diffMs < hour) {
    const minutes = Math.floor(diffMs / minute);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }

  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }

  const days = Math.floor(diffMs / day);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
