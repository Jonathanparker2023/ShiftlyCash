"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import {
  completeTaskAction,
  createTaskAction,
  reorderTasksAction,
  updateTaskAction,
} from "@/app/(protected)/projects/actions";
import type { ProjectItem, ProjectTask } from "@/lib/projects/types";

export function TaskList({ project }: { project: ProjectItem }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextTitle = title.trim();
    if (!nextTitle || isAdding) {
      return;
    }

    setIsAdding(true);
    setError(null);

    try {
      await createTaskAction({ projectId: project.id, title: nextTitle });
      setTitle("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add task.");
    } finally {
      setIsAdding(false);
    }
  }

  async function toggleTask(task: ProjectTask) {
    if (pendingId) {
      return;
    }

    setPendingId(task.id);
    setError(null);

    try {
      if (task.status === "done") {
        await updateTaskAction({ id: task.id, fields: { status: "todo" } });
      } else {
        await completeTaskAction({ id: task.id });
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update task.");
    } finally {
      setPendingId(null);
    }
  }

  async function moveTask(index: number, direction: -1 | 1) {
    if (pendingId) {
      return;
    }

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= project.tasks.length) {
      return;
    }

    const nextTasks = [...project.tasks];
    const [movedTask] = nextTasks.splice(index, 1);
    nextTasks.splice(targetIndex, 0, movedTask);
    setPendingId(movedTask.id);
    setError(null);

    try {
      await reorderTasksAction({
        projectId: project.id,
        orderedIds: nextTasks.map((task) => task.id),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reorder tasks.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-3 border-t border-dashed border-[#cbd5e1] bg-[#f8fafc] p-3">
      <div className="space-y-2">
        {project.tasks.length > 0 ? (
          project.tasks.map((task, index) => (
            <div
              className="flex items-center gap-2 rounded-md border border-[#d7dee8] bg-white p-2 shadow-sm"
              key={task.id}
            >
              <input
                checked={task.status === "done"}
                className="h-4 w-4 accent-[#1d4ed8]"
                disabled={Boolean(pendingId)}
                onChange={() => toggleTask(task)}
                type="checkbox"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={
                    task.status === "done"
                      ? "truncate text-sm font-semibold text-[#64748b] line-through"
                      : "truncate text-sm font-semibold text-[#0f172a]"
                  }
                >
                  {task.title}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-[#64748b]">
                  <span>{formatStatus(task.status)}</span>
                  {task.dueDate ? <span>Due {formatDate(task.dueDate)}</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  aria-label={`Move ${task.title} up`}
                  className="h-8 w-8 rounded-md border border-[#cbd5e1] bg-[#f8fafc] text-sm font-bold text-[#334155] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={index === 0 || Boolean(pendingId)}
                  onClick={() => moveTask(index, -1)}
                  title="Move up"
                  type="button"
                >
                  ^
                </button>
                <button
                  aria-label={`Move ${task.title} down`}
                  className="h-8 w-8 rounded-md border border-[#cbd5e1] bg-[#f8fafc] text-sm font-bold text-[#334155] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={index === project.tasks.length - 1 || Boolean(pendingId)}
                  onClick={() => moveTask(index, 1)}
                  title="Move down"
                  type="button"
                >
                  v
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-[#cbd5e1] bg-white p-4 text-sm text-[#64748b]">
            No tasks yet.
          </div>
        )}
      </div>

      <form className="flex gap-2" onSubmit={addTask}>
        <input
          className="h-10 min-w-0 flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm outline-none transition placeholder:text-[#94a3b8] focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
          disabled={isAdding}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add task"
          type="text"
          value={title}
        />
        <button
          className="h-10 rounded-md bg-[#1d4ed8] px-3 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
          disabled={isAdding || !title.trim()}
          type="submit"
        >
          Add
        </button>
      </form>

      {error ? (
        <p className="rounded-md border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
          {error}
        </p>
      ) : null}
    </div>
  );
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
