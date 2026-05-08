"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import { saveWeeklyReflectionAction } from "@/app/(protected)/projects/actions";
import type { WeeklyReflection } from "@/lib/projects/types";

export function WeeklyReflectionClient({
  reflection,
  weekStartIso,
}: {
  reflection: WeeklyReflection | null;
  weekStartIso: string;
}) {
  const router = useRouter();
  const [shipped, setShipped] = useState(reflection?.shipped ?? "");
  const [stuck, setStuck] = useState(reflection?.stuck ?? "");
  const [nextWeek, setNextWeek] = useState(reflection?.nextWeek ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(reflection?.updatedAt ?? null);

  async function saveReflection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      await saveWeeklyReflectionAction({
        weekStart: weekStartIso,
        shipped,
        stuck,
        nextWeek,
      });
      setSavedAt(new Date().toISOString());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save reflection.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="mt-4 rounded-md border border-[#d7dee8] bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b]">
            Reflection
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[#0f172a]">
            Weekly reset
          </h2>
        </div>
        <span className="text-xs font-semibold text-[#64748b]">
          Week of {formatDate(weekStartIso)}
        </span>
      </div>

      <form className="mt-3 grid gap-3" onSubmit={saveReflection}>
        <ReflectionField
          label="Shipped"
          onChange={setShipped}
          placeholder="What moved forward?"
          value={shipped}
        />
        <ReflectionField
          label="Stuck"
          onChange={setStuck}
          placeholder="What blocked or dragged?"
          value={stuck}
        />
        <ReflectionField
          label="Next week"
          onChange={setNextWeek}
          placeholder="What gets attention next?"
          value={nextWeek}
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            className="h-10 rounded-md bg-[#1d4ed8] px-3 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
            disabled={isSaving}
            type="submit"
          >
            {isSaving ? "Saving..." : "Save reflection"}
          </button>
          {savedAt ? (
            <span className="text-xs font-semibold text-[#64748b]">
              Last saved {formatDateTime(savedAt)}
            </span>
          ) : null}
        </div>
      </form>

      {error ? (
        <p className="mt-3 rounded-md border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ReflectionField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#64748b]">
        {label}
      </span>
      <textarea
        className="mt-1 min-h-20 w-full resize-y rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm text-[#0f172a] outline-none transition placeholder:text-[#94a3b8] focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
