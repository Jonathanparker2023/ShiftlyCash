"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

import { deleteProjectAction } from "@/app/(protected)/projects/actions";
import { TaskList } from "@/components/projects/TaskList";
import type { ProjectItem } from "@/lib/projects/types";

const PROJECT_EMOJIS = [
  "🚀",
  "💎",
  "⚡",
  "🎯",
  "🔥",
  "🌟",
  "🧠",
  "🛠️",
  "📈",
  "🏆",
  "💡",
  "🧭",
] as const;

export function ProjectBar({
  dragHandle,
  project,
}: {
  dragHandle?: ReactNode;
  project: ProjectItem;
}) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progressLabel = `${project.progress.done} / ${project.progress.total}`;
  const identity = getProjectIdentity(project);

  async function deleteProject() {
    if (isDeleting) {
      return;
    }

    const confirmationText = window.prompt(
      `Delete "${project.name}" and all of its tasks?\n\nType the exact project name to confirm.`,
    );
    if (confirmationText === null) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      await deleteProjectAction({ id: project.id, confirmationText });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete project.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <article className="flex overflow-hidden rounded-md border border-[#d7dee8] bg-[#f8fafc] shadow-[0_16px_38px_rgba(0,0,0,0.16)]">
      <div
        aria-hidden="true"
        className="w-1.5 shrink-0"
        style={{ backgroundColor: identity.accent }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2 p-3 sm:p-4">
          <div className="block min-w-0 flex-1 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    aria-label={isExpanded ? "Collapse project" : "Expand project"}
                    className="h-7 w-7 rounded-md border border-[#cbd5e1] bg-white text-sm font-bold text-[#334155] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#bfdbfe]"
                    onClick={() => setIsExpanded((current) => !current)}
                    type="button"
                  >
                    {isExpanded ? "-" : "+"}
                  </button>
                  <span aria-hidden="true" className="text-lg leading-none">
                    {identity.emoji}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${healthDotClass(project.health)}`}
                    title={project.healthReason}
                  />
                  <Link
                    className="truncate text-base font-semibold text-[#0f172a] transition hover:text-[#1d4ed8]"
                    href={`/projects/${project.id}`}
                  >
                    {project.name}
                  </Link>
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
                  backgroundColor: identity.accent,
                  width: `${project.progress.percent}%`,
                }}
              />
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            {dragHandle}
            <button
              aria-label={`Delete ${project.name}`}
              className="h-8 rounded-md border border-[#fecaca] bg-white px-2 text-xs font-semibold text-[#b91c1c] transition hover:border-[#ef4444] hover:bg-[#fff1f2] focus:outline-none focus:ring-2 focus:ring-[#fecaca] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isDeleting}
              onClick={deleteProject}
              title="Delete project"
              type="button"
            >
              Delete
            </button>
          </div>
        </div>

        {error ? (
          <p className="mx-3 mb-3 rounded-md border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-sm font-medium text-[#b91c1c] sm:mx-4">
            {error}
          </p>
        ) : null}

        {isExpanded ? <TaskList project={project} /> : null}
      </div>
    </article>
  );
}

function getProjectIdentity(project: ProjectItem): {
  accent: string;
  emoji: (typeof PROJECT_EMOJIS)[number];
} {
  const hash = hashText(`${project.id}:${project.name}`);
  const hue = hash % 360;
  const emoji = PROJECT_EMOJIS[hash % PROJECT_EMOJIS.length];

  return {
    accent: `hsl(${hue} 88% 48%)`,
    emoji,
  };
}

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function formatDeadline(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function healthDotClass(health: ProjectItem["health"]): string {
  if (health === "red") {
    return "bg-rose-500";
  }

  if (health === "yellow") {
    return "bg-amber-500";
  }

  return "bg-emerald-500";
}
