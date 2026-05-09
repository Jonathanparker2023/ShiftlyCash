"use client";

import { useEffect, useMemo, useState } from "react";

import {
  deleteTaskAction,
  updateTaskAction,
} from "@/app/(protected)/projects/actions";
import type { ProjectTask, RecurUnit } from "@/lib/projects/types";

type TaskEditorProps = {
  task: ProjectTask;
  onClose: () => void;
  onSaved?: () => void;
};

type RecurSelection = RecurUnit | "none";

type TaskEditorFields = {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  recurUnit?: RecurUnit | null;
  recurInterval?: number | null;
  recurAnchorDate?: string | null;
};

export function TaskEditor({ task, onClose, onSaved }: TaskEditorProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [recurUnit, setRecurUnit] = useState<RecurSelection>(
    task.recurUnit ?? "none",
  );
  const [recurInterval, setRecurInterval] = useState(
    String(task.recurInterval ?? 1),
  );
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const trimmedTitle = title.trim();
  const canSave = Boolean(trimmedTitle) && !isPending;
  const fields = useMemo(
    () =>
      buildChangedTaskFields(task, {
        title,
        description,
        dueDate,
        recurUnit,
        recurInterval,
      }),
    [description, dueDate, recurInterval, recurUnit, task, title],
  );

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isPending, onClose]);

  useEffect(() => {
    if (!confirmDelete) {
      return;
    }

    const timeout = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [confirmDelete]);

  async function saveTask() {
    if (!canSave) {
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      if (Object.keys(fields).length > 0) {
        await updateTaskAction({ id: task.id, fields });
        onSaved?.();
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save task.");
    } finally {
      setIsPending(false);
    }
  }

  async function deleteTask() {
    if (isPending) {
      return;
    }

    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      await deleteTaskAction({ id: task.id });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete task.");
      setConfirmDelete(false);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-[#cbd5e1] bg-white p-5 shadow-xl">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[#0f172a]">Edit task</h2>
          <p className="mt-1 text-sm text-[#64748b]">
            Update task details, recurrence, or delete it.
          </p>
        </div>

        <div className="space-y-4">
          <label className="block text-sm font-semibold text-[#334155]">
            Title
            <input
              className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
              disabled={isPending}
              onChange={(event) => setTitle(event.target.value)}
              type="text"
              value={title}
            />
          </label>

          <label className="block text-sm font-semibold text-[#334155]">
            Description
            <textarea
              className="mt-1 min-h-24 w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm text-[#0f172a] outline-none transition focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
              disabled={isPending}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              value={description}
            />
          </label>

          <label className="block text-sm font-semibold text-[#334155]">
            Due date
            <input
              className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
              disabled={isPending}
              onChange={(event) => setDueDate(event.target.value)}
              type="date"
              value={dueDate}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <label className="block text-sm font-semibold text-[#334155]">
              Recurrence
              <select
                className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
                disabled={isPending}
                onChange={(event) => {
                  const nextUnit = event.target.value as RecurSelection;
                  setRecurUnit(nextUnit);
                  if (nextUnit === "none") {
                    setRecurInterval("1");
                  } else if (!Number.parseInt(recurInterval, 10)) {
                    setRecurInterval("1");
                  }
                }}
                value={recurUnit}
              >
                <option value="none">None</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </label>

            {recurUnit !== "none" ? (
              <label className="block text-sm font-semibold text-[#334155]">
                Interval
                <input
                  className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
                  disabled={isPending}
                  min={1}
                  onChange={(event) => setRecurInterval(event.target.value)}
                  type="number"
                  value={recurInterval}
                />
              </label>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-md border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button
            className="rounded-md px-2 py-2 text-sm font-semibold text-[#b91c1c] transition hover:bg-[#fee2e2] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isPending}
            onClick={deleteTask}
            type="button"
          >
            {confirmDelete ? "Tap again to delete" : "Delete"}
          </button>

          <div className="flex gap-2">
            <button
              className="rounded-md border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-semibold text-[#334155] transition hover:border-[#94a3b8] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isPending}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
              disabled={!canSave}
              onClick={saveTask}
              type="button"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function buildChangedTaskFields(
  task: ProjectTask,
  input: {
    title: string;
    description: string;
    dueDate: string;
    recurUnit: RecurSelection;
    recurInterval: string;
  },
): TaskEditorFields {
  const fields: TaskEditorFields = {};
  const nextTitle = input.title.trim();
  if (nextTitle !== task.title) {
    fields.title = nextTitle;
  }

  const nextDescription = input.description.trim() || null;
  if (nextDescription !== task.description) {
    fields.description = nextDescription;
  }

  const nextDueDate = input.dueDate || null;
  if (nextDueDate !== task.dueDate) {
    fields.dueDate = nextDueDate;
  }

  const currentUnit: RecurSelection = task.recurUnit ?? "none";
  if (input.recurUnit === "none") {
    if (currentUnit !== "none" || task.recurInterval || task.recurAnchorDate) {
      fields.recurUnit = null;
      fields.recurInterval = null;
      fields.recurAnchorDate = null;
    }
    return fields;
  }

  const nextInterval = Math.max(1, Number.parseInt(input.recurInterval, 10) || 1);
  const nextAnchorDate = nextDueDate;
  if (
    input.recurUnit !== task.recurUnit ||
    nextInterval !== task.recurInterval ||
    nextAnchorDate !== task.recurAnchorDate
  ) {
    fields.recurUnit = input.recurUnit;
    fields.recurInterval = nextInterval;
    fields.recurAnchorDate = nextAnchorDate;
  }

  return fields;
}
