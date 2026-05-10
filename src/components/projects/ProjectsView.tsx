"use client";

import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";

import {
  createProjectAction,
  reorderProjectsAction,
} from "@/app/(protected)/projects/actions";
import { ClaudeChat } from "@/components/projects/ClaudeChat";
import { ProjectBar } from "@/components/projects/ProjectBar";
import type { ProjectItem, ProjectsData } from "@/lib/projects/types";

const PROJECT_ACCENT = "#1d4ed8";

export function ProjectsView({
  filterSlot,
  initialData,
  showProjectList = true,
}: {
  filterSlot?: ReactNode;
  initialData: ProjectsData;
  showProjectList?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = initialData.projects;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const activeCount = projects.filter(
    (project) => project.status === "active",
  ).length;
  const taskCount = projects.reduce(
    (total, project) => total + project.progress.total,
    0,
  );

  async function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextName = name.trim();
    if (!nextName || isAdding) {
      return;
    }

    setIsAdding(true);
    setError(null);

    try {
      await createProjectAction({ name: nextName, color: PROJECT_ACCENT });
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create project.");
    } finally {
      setIsAdding(false);
    }
  }

  async function reorderProjectBars(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id || isReordering) {
      return;
    }

    const oldIndex = projects.findIndex((project) => project.id === event.active.id);
    const newIndex = projects.findIndex((project) => project.id === event.over?.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const nextProjects = arrayMove(projects, oldIndex, newIndex);
    setIsReordering(true);
    setError(null);

    try {
      await reorderProjectsAction({ orderedIds: nextProjects.map((project) => project.id) });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reorder projects.");
    } finally {
      setIsReordering(false);
    }
  }

  return (
    <main className="min-h-screen px-3 py-4 text-white sm:px-4 lg:px-6">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.75fr)] lg:items-start">
        <section className="overflow-hidden rounded-md border border-white/15 bg-black/15 backdrop-blur-md text-white shadow-[0_24px_70px_rgba(0,0,0,0.22)]">
          <div className="h-2 bg-zinc-950" />
          <div className="p-3 sm:p-4">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/85">
                  Projects
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Active workboard
                </h1>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full border border-sky-300/50 bg-sky-500/15 px-3 py-1 text-emerald-300">
                    {activeCount} active
                  </span>
                  <span className="rounded-full border border-white/15 bg-black/20 backdrop-blur-md px-3 py-1 text-white/85">
                    {taskCount} tasks
                  </span>
                </div>
              </div>

              <form
                className="flex w-full flex-col gap-2 rounded-md border border-white/15 bg-black/20 backdrop-blur-md p-2 shadow-sm md:max-w-md"
                onSubmit={addProject}
              >
                <div className="flex gap-2">
                  <input
                    className="h-10 min-w-0 flex-1 rounded-md border border-white/20 bg-black/20 backdrop-blur-md px-3 text-sm outline-none transition placeholder:text-white/50 focus:border-white/60 focus:ring-2 focus:ring-white/40"
                    disabled={isAdding}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="New project"
                    type="text"
                    value={name}
                  />
                  <button
                    className="h-10 rounded-md bg-sky-500/70 px-3 text-sm font-semibold text-white transition hover:bg-sky-500/85 disabled:cursor-not-allowed disabled:bg-white/20"
                    disabled={isAdding || !name.trim()}
                    type="submit"
                  >
                    Add
                  </button>
                </div>
              </form>
            </div>

            {error ? (
              <p className="mb-4 rounded-md border border-red-300/60 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-300">
                {error}
              </p>
            ) : null}

            {filterSlot}

            {showProjectList && projects.length > 0 ? (
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={reorderProjectBars}
                sensors={sensors}
              >
                <SortableContext
                  items={projects.map((project) => project.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-3">
                    {projects.map((project) => (
                      <SortableProjectBar
                        isReordering={isReordering}
                        key={project.id}
                        project={project}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : showProjectList ? (
              <div className="rounded-md border border-dashed border-white/20 bg-black/20 backdrop-blur-md p-8 text-center text-sm text-white/70">
                No projects yet.
              </div>
            ) : null}
          </div>
        </section>

        <ClaudeChat />
      </div>
    </main>
  );
}

function SortableProjectBar({
  isReordering,
  project,
}: {
  isReordering: boolean;
  project: ProjectItem;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, disabled: isReordering });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      className={
        isDragging
          ? "w-full opacity-70"
          : "w-full"
      }
      ref={setNodeRef}
      style={style}
    >
      <ProjectBar
        dragHandle={
          <button
            aria-label={`Drag ${project.name}`}
            className="h-8 w-8 touch-none rounded-md border border-white/20 bg-black/20 backdrop-blur-md text-sm font-bold text-white/85 transition hover:border-white/50 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40"
            disabled={isReordering}
            title="Drag to reorder"
            type="button"
            {...attributes}
            {...listeners}
          >
            ::
          </button>
        }
        project={project}
      />
    </div>
  );
}
