"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { TaskList } from "@/components/projects/TaskList";
import type { ProjectItem } from "@/lib/projects/types";

const PROJECT_ACCENT = "#1d4ed8";

export function ProjectBar({
  dragHandle,
  project,
}: {
  dragHandle?: ReactNode;
  project: ProjectItem;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const progressLabel = `${project.progress.done} / ${project.progress.total}`;

  return (
    <article className="overflow-hidden rounded-md border border-[#d7dee8] bg-[#f8fafc] shadow-[0_16px_38px_rgba(0,0,0,0.16)]">
      <div className="h-1.5 bg-[#1d4ed8]" />
      <div className="flex items-start gap-2 p-3 sm:p-4">
        <button
          className="block min-w-0 flex-1 text-left"
          onClick={() => setIsExpanded((current) => !current)}
          type="button"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-[#0f172a]">
                  {project.name}
                </h2>
                {project.status === "archived" ? (
                  <span className="rounded-full border border-[#cbd5e1] bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748b]">
                    Archived
                  </span>
                ) : null}
              </div>
              {project.description ? (
                <p className="mt-1 line-clamp-2 text-sm text-[#64748b]">
                  {project.description}
                </p>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold text-[#0f172a]">{progressLabel}</p>
              {project.deadline ? (
                <p className="mt-1 text-xs text-[#64748b]">
                  {formatDeadline(project.deadline)}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e2e8f0]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                backgroundColor: PROJECT_ACCENT,
                width: `${project.progress.percent}%`,
              }}
            />
          </div>
        </button>
        {dragHandle ? <div className="shrink-0">{dragHandle}</div> : null}
      </div>

      {isExpanded ? <TaskList project={project} /> : null}
    </article>
  );
}

function formatDeadline(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
