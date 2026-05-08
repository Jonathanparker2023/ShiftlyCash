import { CrossProjectFilter } from "@/components/projects/CrossProjectFilter";
import { ProjectsView } from "@/components/projects/ProjectsView";
import { requireUser } from "@/lib/auth";
import { getProjectsData, getTasksFiltered } from "@/lib/projects/data";
import type { TaskStatus } from "@/lib/projects/types";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const data = await getProjectsData();
  const params = await searchParams;
  const selectedTagIds = parseSelectedTagIds(params.tags);
  const dueThisWeek = params.due === "week";
  const showCompleted = params.completed === "1";
  const isFilterActive =
    selectedTagIds.length > 0 || dueThisWeek || showCompleted;
  const filteredTasks = isFilterActive
    ? await getFilteredTasks({
        dueThisWeek,
        selectedTagIds,
        showCompleted,
      })
    : [];

  return (
    <ProjectsView
      filterSlot={
        <>
          {/* SLOT: filter (Batch A - already filled) */}
          <CrossProjectFilter
            dueThisWeek={dueThisWeek}
            filteredTasks={filteredTasks}
            isActive={isFilterActive}
            selectedTagIds={selectedTagIds}
            showCompleted={showCompleted}
            tags={data.tags}
          />
          {/* SLOT: today (Batch B) */}
          {/* SLOT: inbox (Batch B) */}
          {/* SLOT: project-list (existing) */}
          {/* SLOT: reflection (Batch B) */}
        </>
      }
      initialData={data}
      showProjectList={!isFilterActive}
    />
  );
}

async function getFilteredTasks(input: {
  dueThisWeek: boolean;
  selectedTagIds: string[];
  showCompleted: boolean;
}) {
  const { supabase } = await requireUser();
  const statuses: TaskStatus[] | undefined = input.showCompleted
    ? undefined
    : ["todo", "in_progress"];

  return getTasksFiltered(supabase, {
    dueBefore: input.dueThisWeek ? endOfCurrentWeekIso() : null,
    statuses,
    tagIds: input.selectedTagIds,
  });
}

function parseSelectedTagIds(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function endOfCurrentWeekIso(): string {
  const today = new Date();
  const end = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
  return end.toISOString().slice(0, 10);
}
