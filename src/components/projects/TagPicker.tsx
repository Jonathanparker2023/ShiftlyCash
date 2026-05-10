"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import {
  addTagToTaskAction,
  createTagAction,
  removeTagFromTaskAction,
} from "@/app/(protected)/projects/actions";
import type { ProjectTask, Tag } from "@/lib/projects/types";

const TAG_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
];

export function TagPicker({
  availableTags,
  task,
}: {
  availableTags: Tag[];
  task: ProjectTask;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedTagIds = useMemo(
    () => new Set(task.tags.map((tag) => tag.id)),
    [task.tags],
  );

  async function toggleTag(tag: Tag) {
    if (pending) return;

    setPending(true);
    setError(null);

    try {
      if (selectedTagIds.has(tag.id)) {
        await removeTagFromTaskAction({ taskId: task.id, tagId: tag.id });
      } else {
        await addTagToTaskAction({ taskId: task.id, tagId: tag.id });
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update tags.");
    } finally {
      setPending(false);
    }
  }

  async function createAndAttachTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || pending) return;

    setPending(true);
    setError(null);

    try {
      const created = await createTagAction({ name: nextName, color });
      await addTagToTaskAction({ taskId: task.id, tagId: created.id });
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create tag.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-64 rounded-md border border-white/20 bg-black/20 backdrop-blur-md p-3 shadow-lg">
      <div className="space-y-1">
        {availableTags.length > 0 ? (
          availableTags.map((tag) => (
            <button
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-semibold text-white/85 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              key={tag.id}
              onClick={() => toggleTag(tag)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="truncate">{tag.name}</span>
              </span>
              <span>{selectedTagIds.has(tag.id) ? "On" : "Add"}</span>
            </button>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-white/20 px-2 py-2 text-xs text-white/70">
            No tags yet.
          </p>
        )}
      </div>

      <form className="mt-3 space-y-2 border-t border-white/10 pt-3" onSubmit={createAndAttachTag}>
        <input
          className="h-9 w-full rounded-md border border-white/20 px-2 text-xs outline-none focus:border-white/60 focus:ring-2 focus:ring-white/40"
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
          placeholder="New tag"
          value={name}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {TAG_COLORS.map((tagColor) => (
              <button
                aria-label={`Use ${tagColor}`}
                className={
                  tagColor === color
                    ? "h-5 w-5 rounded-full ring-2 ring-[#0f172a] ring-offset-1"
                    : "h-5 w-5 rounded-full ring-1 ring-[#cbd5e1]"
                }
                disabled={pending}
                key={tagColor}
                onClick={() => setColor(tagColor)}
                style={{ backgroundColor: tagColor }}
                type="button"
              />
            ))}
          </div>
          <button
            className="h-8 rounded-md bg-sky-500/70 px-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/20"
            disabled={pending || !name.trim()}
            type="submit"
          >
            Create
          </button>
        </div>
      </form>

      {error ? <p className="mt-2 text-xs font-semibold text-red-300">{error}</p> : null}
    </div>
  );
}
