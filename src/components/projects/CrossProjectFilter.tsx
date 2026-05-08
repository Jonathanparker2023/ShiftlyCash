import Link from "next/link";

import { TagPill } from "@/components/projects/TagPill";
import type { ProjectTask, Tag } from "@/lib/projects/types";

export function CrossProjectFilter({
  dueThisWeek,
  filteredTasks,
  isActive,
  selectedTagIds,
  showCompleted,
  tags,
}: {
  dueThisWeek: boolean;
  filteredTasks: ProjectTask[];
  isActive: boolean;
  selectedTagIds: string[];
  showCompleted: boolean;
  tags: Tag[];
}) {
  const selected = new Set(selectedTagIds);

  return (
    <div className="mb-4 rounded-md border border-[#d7dee8] bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b]">
            Filters
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tags.length > 0 ? (
              tags.map((tag) => (
                <Link
                  className={
                    selected.has(tag.id)
                      ? "rounded-full ring-2 ring-[#0f172a] ring-offset-2"
                      : "rounded-full opacity-80 transition hover:opacity-100"
                  }
                  href={hrefForTagToggle(selectedTagIds, tag.id, {
                    dueThisWeek,
                    showCompleted,
                  })}
                  key={tag.id}
                >
                  <TagPill tag={tag} />
                </Link>
              ))
            ) : (
              <span className="text-xs text-[#64748b]">No tags yet</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <Link
            className={
              dueThisWeek
                ? "rounded-md border border-[#1d4ed8] bg-[#dbeafe] px-3 py-2 text-[#1d4ed8]"
                : "rounded-md border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-[#334155] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]"
            }
            href={hrefForToggle("due", dueThisWeek ? null : "week", {
              selectedTagIds,
              showCompleted,
            })}
          >
            Due this week
          </Link>
          <Link
            className={
              showCompleted
                ? "rounded-md border border-[#1d4ed8] bg-[#dbeafe] px-3 py-2 text-[#1d4ed8]"
                : "rounded-md border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-[#334155] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]"
            }
            href={hrefForToggle("completed", showCompleted ? null : "1", {
              dueThisWeek,
              selectedTagIds,
            })}
          >
            Show completed
          </Link>
          {isActive ? (
            <Link
              className="rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-[#64748b] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]"
              href="/projects"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </div>

      {isActive ? (
        <div className="mt-4 space-y-2 border-t border-[#e2e8f0] pt-3">
          {filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <div
                className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2"
                key={task.id}
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#0f172a]">
                      {task.title}
                    </p>
                    <p className="mt-0.5 text-xs text-[#64748b]">
                      {task.projectName ?? "Project"}
                      {task.dueDate ? ` - Due ${formatDate(task.dueDate)}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-[#64748b]">
                    {formatStatus(task.status)}
                  </span>
                </div>
                {task.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {task.tags.map((tag) => (
                      <TagPill key={tag.id} tag={tag} />
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p className="rounded-md border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-4 text-sm text-[#64748b]">
              No tasks match these filters.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function hrefForTagToggle(
  currentTagIds: string[],
  tagId: string,
  flags: { dueThisWeek: boolean; showCompleted: boolean },
): string {
  const next = new Set(currentTagIds);
  if (next.has(tagId)) {
    next.delete(tagId);
  } else {
    next.add(tagId);
  }

  return buildHref({
    dueThisWeek: flags.dueThisWeek,
    selectedTagIds: Array.from(next),
    showCompleted: flags.showCompleted,
  });
}

function hrefForToggle(
  key: "due" | "completed",
  value: string | null,
  current: {
    dueThisWeek?: boolean;
    selectedTagIds?: string[];
    showCompleted?: boolean;
  },
): string {
  return buildHref({
    dueThisWeek: key === "due" ? value === "week" : Boolean(current.dueThisWeek),
    selectedTagIds: current.selectedTagIds ?? [],
    showCompleted:
      key === "completed" ? value === "1" : Boolean(current.showCompleted),
  });
}

function buildHref(input: {
  dueThisWeek: boolean;
  selectedTagIds: string[];
  showCompleted: boolean;
}): string {
  const params = new URLSearchParams();
  if (input.selectedTagIds.length > 0) {
    params.set("tags", input.selectedTagIds.join(","));
  }
  if (input.dueThisWeek) {
    params.set("due", "week");
  }
  if (input.showCompleted) {
    params.set("completed", "1");
  }

  const query = params.toString();
  return query ? `/projects?${query}` : "/projects";
}

function formatStatus(status: ProjectTask["status"]): string {
  if (status === "in_progress") {
    return "In progress";
  }

  return status === "done" ? "Done" : "Todo";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
