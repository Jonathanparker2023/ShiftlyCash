"use client";

import { useState } from "react";

import {
  createCustomJobAction,
  updateBuiltinRatesAction,
  updateCustomJobAction,
} from "@/app/(protected)/settings/jobs/actions";
import type { JobsBuiltin, JobsCustomJob, JobsData } from "@/lib/jobs/data";
import { contrastText, darken } from "@/lib/domain/jobColor";

type SaveState = "idle" | "saving" | "saved" | "error";

const FIELD =
  "h-10 rounded-lg border border-white/12 bg-white/[0.05] px-3 text-sm text-white outline-none transition focus:border-white/30";

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
function centsFrom(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.max(0, n) * 100) : 0;
}

export function JobsEditor({ initialData }: { initialData: JobsData }) {
  const [customJobs, setCustomJobs] = useState(initialData.customJobs);
  const builtins = initialData.builtins;
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function ok() {
    setState("saved");
    setError(null);
    window.setTimeout(() => setState("idle"), 1200);
  }
  function fail(e: unknown) {
    setState("error");
    setError(e instanceof Error ? e.message : "Save failed.");
  }

  async function addJob() {
    setBusy(true);
    setState("saving");
    try {
      const color = "#3b82f6";
      const result = await createCustomJobAction({
        name: "New job",
        color,
        regularRateCents: 0,
        otRateCents: 0,
      });
      setCustomJobs((prev) => [
        ...prev,
        {
          id: result.id,
          name: "New job",
          color,
          regularRateCents: 0,
          otRateCents: 0,
          active: true,
        },
      ]);
      ok();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  function patchLocal(id: string, patch: Partial<JobsCustomJob>) {
    setCustomJobs((prev) =>
      prev.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    );
  }

  async function saveJob(id: string, patch: Partial<JobsCustomJob>) {
    setState("saving");
    try {
      await updateCustomJobAction({ id, ...patch });
      ok();
    } catch (e) {
      fail(e);
    }
  }

  async function setBuiltinRate(
    key: JobsBuiltin["key"],
    regularRateCents: number,
    otRateCents: number,
  ) {
    setState("saving");
    try {
      await updateBuiltinRatesAction({
        jobKey: key,
        regularRateCents,
        otRateCents,
      });
      ok();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/55">
              Custom jobs
            </h2>
            <p className="mt-1 text-xs text-white/45">
              Net take-home rates. Available everywhere a shift can be added.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Status state={state} error={error} />
            <button
              className="h-10 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-60"
              disabled={busy}
              onClick={addJob}
              type="button"
            >
              + Add job
            </button>
          </div>
        </div>

        {customJobs.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-10 text-center text-sm text-white/55">
            No custom jobs yet. Add one to use it on the dashboard + template.
          </div>
        ) : (
          <div className="space-y-2">
            {customJobs.map((job) => (
              <div
                className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:flex-row sm:items-center"
                key={job.id}
                style={job.active ? undefined : { opacity: 0.5 }}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                  style={{
                    backgroundColor: job.color,
                    color: contrastText(job.color),
                    border: `1px solid ${darken(job.color)}`,
                  }}
                >
                  {job.name.slice(0, 2).toUpperCase()}
                </span>
                <input
                  className={`${FIELD} min-w-0 flex-1`}
                  defaultValue={job.name}
                  onBlur={(e) => {
                    patchLocal(job.id, { name: e.target.value });
                    saveJob(job.id, { name: e.target.value });
                  }}
                  placeholder="Job name"
                />
                <input
                  aria-label="Color"
                  className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-white/12 bg-transparent"
                  onChange={(e) => {
                    patchLocal(job.id, { color: e.target.value });
                    saveJob(job.id, { color: e.target.value });
                  }}
                  type="color"
                  value={job.color}
                />
                <label className="flex shrink-0 items-center gap-1 text-xs text-white/55">
                  Reg $
                  <input
                    className={`${FIELD} w-20`}
                    defaultValue={dollars(job.regularRateCents)}
                    onBlur={(e) =>
                      saveJob(job.id, {
                        regularRateCents: centsFrom(e.target.value),
                      })
                    }
                    step="0.01"
                    type="number"
                  />
                </label>
                <label className="flex shrink-0 items-center gap-1 text-xs text-white/55">
                  OT $
                  <input
                    className={`${FIELD} w-20`}
                    defaultValue={dollars(job.otRateCents)}
                    onBlur={(e) =>
                      saveJob(job.id, { otRateCents: centsFrom(e.target.value) })
                    }
                    step="0.01"
                    type="number"
                  />
                </label>
                <button
                  className="h-9 shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-white/70 transition hover:border-red-300/60 hover:bg-red-500/10 hover:text-red-200"
                  onClick={() => {
                    patchLocal(job.id, { active: !job.active });
                    saveJob(job.id, { active: !job.active });
                  }}
                  type="button"
                >
                  {job.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 px-1 text-sm font-semibold uppercase tracking-[0.16em] text-white/55">
          Built-in jobs
        </h2>
        <div className="space-y-2">
          {builtins.map((job) => (
            <div
              className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:flex-row sm:items-center"
              key={job.key}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                style={{
                  backgroundColor: job.color,
                  color: contrastText(job.color),
                  border: `1px solid ${darken(job.color)}`,
                }}
              >
                {job.label.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-white">
                {job.label}
              </span>
              <label className="flex shrink-0 items-center gap-1 text-xs text-white/55">
                Reg $
                <input
                  className={`${FIELD} w-20`}
                  defaultValue={dollars(job.regularRateCents)}
                  onBlur={(e) =>
                    setBuiltinRate(
                      job.key,
                      centsFrom(e.target.value),
                      job.otRateCents,
                    )
                  }
                  step="0.01"
                  type="number"
                />
              </label>
              <label className="flex shrink-0 items-center gap-1 text-xs text-white/55">
                OT $
                <input
                  className={`${FIELD} w-20`}
                  defaultValue={dollars(job.otRateCents)}
                  onBlur={(e) =>
                    setBuiltinRate(
                      job.key,
                      job.regularRateCents,
                      centsFrom(e.target.value),
                    )
                  }
                  step="0.01"
                  type="number"
                />
              </label>
            </div>
          ))}
        </div>
        <p className="mt-2 px-1 text-xs text-white/40">
          Editing a rate re-prices every shift that uses that job, past and
          future.
        </p>
      </section>
    </div>
  );
}

function Status({ state, error }: { state: SaveState; error: string | null }) {
  if (state === "idle") return null;
  const label =
    state === "saving" ? "Saving..." : state === "saved" ? "Saved" : "Failed";
  return (
    <span
      className={
        state === "error"
          ? "text-xs font-semibold text-red-300"
          : "text-xs font-medium text-white/60"
      }
    >
      {error && state === "error" ? error : label}
    </span>
  );
}
