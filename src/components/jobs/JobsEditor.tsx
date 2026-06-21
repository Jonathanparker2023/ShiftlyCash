"use client";

import { useState } from "react";

import {
  createCustomJobAction,
  deleteCustomJobAction,
  setBuiltinHiddenAction,
  updateBuiltinRatesAction,
  updateCustomJobAction,
} from "@/app/(protected)/settings/jobs/actions";
import type { JobsBuiltin, JobsCustomJob, JobsData } from "@/lib/jobs/data";
import { contrastText, darken } from "@/lib/domain/jobColor";
import {
  netRateFromGross,
  otGrossFromRegular,
  percentFromRate,
  rateFromPercent,
} from "@/lib/jobs/rates";

type SaveState = "idle" | "saving" | "saved" | "error";

const FIELD =
  "h-10 w-full rounded-lg border border-white/12 bg-white/[0.05] px-3 text-sm text-white outline-none transition focus:border-white/30";

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
function centsFrom(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.max(0, n) * 100) : 0;
}
function percentFrom(value: string): number {
  const n = Number(value);
  return rateFromPercent(Number.isFinite(n) ? n : 0);
}

type CustomJobSavePatch = Partial<
  Pick<
    JobsCustomJob,
    "name" | "color" | "regularGrossRateCents" | "withholdingRate" | "active"
  >
>;

// Recompute the derived fields for the local row when a rate input changes. OT
// gross is always 1.5x the regular gross — never entered by hand.
function computedRatePatch(
  job: JobsCustomJob,
  patch: { regularGrossRateCents?: number; withholdingRate?: number },
): Partial<JobsCustomJob> {
  const regularGrossRateCents =
    patch.regularGrossRateCents ?? job.regularGrossRateCents;
  const withholdingRate = patch.withholdingRate ?? job.withholdingRate;
  const otGrossRateCents = otGrossFromRegular(regularGrossRateCents);
  return {
    ...patch,
    otGrossRateCents,
    regularRateCents: netRateFromGross(regularGrossRateCents, withholdingRate),
    otRateCents: netRateFromGross(otGrossRateCents, withholdingRate),
  };
}

export function JobsEditor({ initialData }: { initialData: JobsData }) {
  const [customJobs, setCustomJobs] = useState(initialData.customJobs);
  const [builtins, setBuiltins] = useState(initialData.builtins);
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
        regularGrossRateCents: 0,
        withholdingRate: 0,
      });
      setCustomJobs((prev) => [
        ...prev,
        {
          id: result.id,
          name: "New job",
          color,
          regularRateCents: 0,
          otRateCents: 0,
          regularGrossRateCents: 0,
          otGrossRateCents: 0,
          withholdingRate: 0,
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

  async function saveJob(id: string, patch: CustomJobSavePatch) {
    setState("saving");
    try {
      await updateCustomJobAction({ id, ...patch });
      ok();
    } catch (e) {
      fail(e);
    }
  }

  async function deleteJob(id: string) {
    setState("saving");
    try {
      await deleteCustomJobAction({ id });
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
      await updateBuiltinRatesAction({ jobKey: key, regularRateCents, otRateCents });
      ok();
    } catch (e) {
      fail(e);
    }
  }

  async function setBuiltinHidden(key: JobsBuiltin["key"], hidden: boolean) {
    setBuiltins((prev) =>
      prev.map((job) => (job.key === key ? { ...job, hidden } : job)),
    );
    setState("saving");
    try {
      await setBuiltinHiddenAction({ jobKey: key, hidden });
      ok();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-white/45">
          Gross hourly rate + withholding. Overtime is auto 1.5x. These jobs show
          up wherever you add a shift.
        </p>
        <div className="flex items-center gap-3">
          <Status state={state} error={error} />
          <button
            className="h-10 shrink-0 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-60"
            disabled={busy}
            onClick={addJob}
            type="button"
          >
            + Add job
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {builtins.map((job) => (
          <BuiltinRow
            job={job}
            key={job.key}
            onHide={(hidden) => setBuiltinHidden(job.key, hidden)}
            onRate={(reg, ot) => setBuiltinRate(job.key, reg, ot)}
          />
        ))}

        {customJobs.map((job) => (
          <CustomRow
            job={job}
            key={job.id}
            onColor={(color) => {
              patchLocal(job.id, { color });
              saveJob(job.id, { color });
            }}
            onDelete={() => {
              patchLocal(job.id, { active: false });
              deleteJob(job.id);
            }}
            onName={(name) => {
              patchLocal(job.id, { name });
              saveJob(job.id, { name });
            }}
            onRegular={(regularGrossRateCents) => {
              patchLocal(job.id, computedRatePatch(job, { regularGrossRateCents }));
              saveJob(job.id, { regularGrossRateCents });
            }}
            onRestore={() => {
              patchLocal(job.id, { active: true });
              saveJob(job.id, { active: true });
            }}
            onWithholding={(withholdingRate) => {
              patchLocal(job.id, computedRatePatch(job, { withholdingRate }));
              saveJob(job.id, { withholdingRate });
            }}
          />
        ))}
      </div>

      <p className="px-1 text-xs text-white/40">
        Editing a built-in rate re-prices every shift that uses it, past and
        future. Deleting a job only removes it from the pickers — past shifts keep
        their earnings.
      </p>
    </div>
  );
}

const ROW =
  "flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 lg:flex-row lg:items-center";

function Swatch({ color, text }: { color: string; text: string }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
      style={{
        backgroundColor: color,
        color: contrastText(color),
        border: `1px solid ${darken(color)}`,
      }}
    >
      {text.slice(0, 2).toUpperCase()}
    </span>
  );
}

function FieldBox({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid w-24 gap-1 text-[11px] text-white/55">
      {label}
      {children}
    </label>
  );
}

function CustomRow({
  job,
  onName,
  onColor,
  onRegular,
  onWithholding,
  onDelete,
  onRestore,
}: {
  job: JobsCustomJob;
  onName: (value: string) => void;
  onColor: (value: string) => void;
  onRegular: (cents: number) => void;
  onWithholding: (rate: number) => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  return (
    <div className={ROW} style={job.active ? undefined : { opacity: 0.5 }}>
      <div className="flex min-w-0 items-center gap-3 lg:flex-1">
        <Swatch color={job.color} text={job.name} />
        <input
          aria-label="Job name"
          className={`${FIELD} min-w-0 flex-1`}
          defaultValue={job.name}
          onBlur={(e) => onName(e.target.value)}
          placeholder="Job name"
        />
        <input
          aria-label="Color"
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-white/12 bg-transparent"
          onChange={(e) => onColor(e.target.value)}
          type="color"
          value={job.color}
        />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <FieldBox label="Gross reg">
          <input
            className={FIELD}
            defaultValue={dollars(job.regularGrossRateCents)}
            onBlur={(e) => onRegular(centsFrom(e.target.value))}
            step="0.01"
            type="number"
          />
        </FieldBox>
        <FieldBox label="Withhold %">
          <input
            className={FIELD}
            defaultValue={percentFromRate(job.withholdingRate)}
            max="99"
            min="0"
            onBlur={(e) => onWithholding(percentFrom(e.target.value))}
            step="0.1"
            type="number"
          />
        </FieldBox>
        <div className="grid w-28 gap-1 text-[11px] text-white/45">
          Net reg / OT
          <span className="flex h-10 items-center rounded-lg border border-white/10 bg-black/10 px-3 text-sm font-semibold text-white/75">
            {`$${dollars(job.regularRateCents)} / $${dollars(job.otRateCents)}`}
          </span>
        </div>
        <DeleteButton
          active={job.active}
          onDelete={onDelete}
          onRestore={onRestore}
        />
      </div>
    </div>
  );
}

function BuiltinRow({
  job,
  onRate,
  onHide,
}: {
  job: JobsBuiltin;
  onRate: (reg: number, ot: number) => void;
  onHide: (hidden: boolean) => void;
}) {
  return (
    <div className={ROW} style={job.hidden ? { opacity: 0.5 } : undefined}>
      <div className="flex min-w-0 items-center gap-3 lg:flex-1">
        <Swatch color={job.color} text={job.label} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
          {job.label}
          <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/45">
            built-in
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <FieldBox label="Net reg $">
          <input
            className={FIELD}
            defaultValue={dollars(job.regularRateCents)}
            onBlur={(e) => onRate(centsFrom(e.target.value), job.otRateCents)}
            step="0.01"
            type="number"
          />
        </FieldBox>
        <FieldBox label="Net OT $">
          <input
            className={FIELD}
            defaultValue={dollars(job.otRateCents)}
            onBlur={(e) => onRate(job.regularRateCents, centsFrom(e.target.value))}
            step="0.01"
            type="number"
          />
        </FieldBox>
        <DeleteButton
          active={!job.hidden}
          onDelete={() => onHide(true)}
          onRestore={() => onHide(false)}
        />
      </div>
    </div>
  );
}

function DeleteButton({
  active,
  onDelete,
  onRestore,
}: {
  active: boolean;
  onDelete: () => void;
  onRestore: () => void;
}) {
  return (
    <button
      className="h-10 shrink-0 self-end rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-white/70 transition hover:border-red-300/60 hover:bg-red-500/10 hover:text-red-200"
      onClick={active ? onDelete : onRestore}
      type="button"
    >
      {active ? "Delete" : "Restore"}
    </button>
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
