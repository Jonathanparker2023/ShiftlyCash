"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import {
  completeTaskAction,
  createInboxTaskAction,
  moveTaskToProjectAction,
} from "@/app/(protected)/projects/actions";
import { VoiceInput } from "@/components/projects/VoiceInput";
import type { ProjectItem, ProjectTask } from "@/lib/projects/types";

export function QuickCaptureInboxClient({
  inboxTasks,
  projects,
}: {
  inboxTasks: ProjectTask[];
  projects: ProjectItem[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function captureTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || isAdding) return;

    setIsAdding(true);
    setError(null);

    try {
      await createInboxTaskAction({ title: nextTitle });
      setTitle("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to capture task.");
    } finally {
      setIsAdding(false);
    }
  }

  async function completeInboxTask(task: ProjectTask) {
    if (pendingId) return;

    setPendingId(task.id);
    setError(null);

    try {
      await completeTaskAction({ id: task.id });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete task.");
    } finally {
      setPendingId(null);
    }
  }

  async function moveInboxTask(taskId: string, projectId: string) {
    if (!projectId || pendingId) return;

    setPendingId(taskId);
    setError(null);

    try {
      await moveTaskToProjectAction({ taskId, projectId });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to move task.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="mb-4 rounded-md border border-[#d7dee8] bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b]">
            Inbox
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[#0f172a]">
            Quick capture
          </h2>
        </div>
        <span className="rounded-full border border-[#d7dee8] bg-[#f8fafc] px-3 py-1 text-xs font-semibold text-[#334155]">
          {inboxTasks.length} waiting
        </span>
      </div>

      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={captureTask}>
        <input
          className="h-10 min-w-0 flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm outline-none transition placeholder:text-[#94a3b8] focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
          disabled={isAdding}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Capture a loose task"
          value={title}
        />
        <div className="flex gap-2">
          <VoiceInput
            disabled={isAdding}
            onTranscript={(transcript) =>
              setTitle((current) => `${current} ${transcript}`.trim())
            }
          />
          <button
            className="h-10 rounded-md bg-[#1d4ed8] px-3 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
            disabled={isAdding || !title.trim()}
            type="submit"
          >
            Add
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-3 rounded-md border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
          {error}
        </p>
      ) : null}

      <div className="mt-3 space-y-2">
        {inboxTasks.length > 0 ? (
          inboxTasks.map((task) => (
            <div
              className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2"
              key={task.id}
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className="min-w-0 truncate text-sm font-semibold text-[#0f172a]">
                  {task.title}
                </p>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-xs font-semibold text-[#334155] outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
                    disabled={pendingId === task.id || projects.length === 0}
                    onChange={(event) => moveInboxTask(task.id, event.target.value)}
                    value=""
                  >
                    <option value="">Move to...</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-xs font-semibold text-[#334155] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={pendingId === task.id}
                    onClick={() => completeInboxTask(task)}
                    type="button"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-3 text-sm text-[#64748b]">
            No inbox tasks.
          </p>
        )}
      </div>
    </section>
  );
}
