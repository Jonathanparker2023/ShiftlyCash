"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import { createProjectAction } from "@/app/(protected)/projects/actions";
import { ClaudeChat } from "@/components/projects/ClaudeChat";
import { ProjectBar } from "@/components/projects/ProjectBar";
import type { ProjectsData } from "@/lib/projects/types";

const PROJECT_COLORS = ["#1d4ed8", "#0e7490", "#16a34a", "#d97706"] as const;

export function ProjectsView({ initialData }: { initialData: ProjectsData }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState<(typeof PROJECT_COLORS)[number]>("#1d4ed8");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeCount = initialData.projects.filter(
    (project) => project.status === "active",
  ).length;
  const taskCount = initialData.projects.reduce(
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
      await createProjectAction({ name: nextName, color });
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create project.");
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#101827] px-3 py-4 text-[#f8fafc] sm:px-4 lg:px-6">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.75fr)] lg:items-start">
        <section className="overflow-hidden rounded-md border border-[#d7dee8] bg-[#f8fafc] text-[#0f172a] shadow-[0_24px_70px_rgba(0,0,0,0.22)]">
          <div className="h-2 bg-[#0b1220]" />
          <div className="p-3 sm:p-4">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#334155]">
                  Projects
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#0f172a] sm:text-3xl">
                  Active workboard
                </h1>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full border border-[#bae6fd] bg-[#e0f2fe] px-3 py-1 text-[#0e7490]">
                    {activeCount} active
                  </span>
                  <span className="rounded-full border border-[#d7dee8] bg-white px-3 py-1 text-[#334155]">
                    {taskCount} tasks
                  </span>
                </div>
              </div>

              <form
                className="flex w-full flex-col gap-2 rounded-md border border-[#d7dee8] bg-white p-2 shadow-sm md:max-w-md"
                onSubmit={addProject}
              >
                <div className="flex gap-2">
                  <input
                    className="h-10 min-w-0 flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm outline-none transition placeholder:text-[#94a3b8] focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
                    disabled={isAdding}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="New project"
                    type="text"
                    value={name}
                  />
                  <button
                    className="h-10 rounded-md bg-[#1d4ed8] px-3 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
                    disabled={isAdding || !name.trim()}
                    type="submit"
                  >
                    Add
                  </button>
                </div>
                <div className="flex gap-1">
                  {PROJECT_COLORS.map((projectColor) => (
                    <button
                      aria-label={`Use color ${projectColor}`}
                      className={
                        projectColor === color
                          ? "h-7 w-7 rounded-full ring-2 ring-[#0f172a] ring-offset-2"
                          : "h-7 w-7 rounded-full ring-1 ring-black/10"
                      }
                      key={projectColor}
                      onClick={() => setColor(projectColor)}
                      style={{ backgroundColor: projectColor }}
                      type="button"
                    />
                  ))}
                </div>
              </form>
            </div>

            {error ? (
              <p className="mb-4 rounded-md border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
                {error}
              </p>
            ) : null}

            {initialData.projects.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {initialData.projects.map((project) => (
                  <ProjectBar key={project.id} project={project} />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-[#cbd5e1] bg-white p-8 text-center text-sm text-[#64748b]">
                No projects yet.
              </div>
            )}
          </div>
        </section>

        <ClaudeChat />
      </div>
    </main>
  );
}
