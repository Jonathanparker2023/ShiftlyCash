"use client";

import { useMemo, useState } from "react";

import { ActionButton } from "@/components/shell";
import { bulkCreateFoodEntriesAction } from "@/app/(protected)/cal/actions";
import { parsePastedLog, type ParsedFoodLine } from "@/lib/cal/parsePastedLog";

type Status = "idle" | "parsing" | "saving" | "error";

// ── Paste & log button ──────────────────────────────────────────────
//
// Paste a block of pre-calculated food lines (typical GPT-5 "list"
// mode output from the Plan my day handoff) and click to log every
// line as its own entry with the exact macros from the paste — no AI
// estimator call, zero token spend.

export function PasteAndLogButton({
  date,
  disabled = false,
  onLogged,
}: {
  date: string;
  disabled?: boolean;
  onLogged?: (insertedCount: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parsed = useMemo<ParsedFoodLine[]>(
    () => (text.trim() ? parsePastedLog(text) : []),
    [text],
  );

  async function logAll() {
    if (parsed.length === 0) {
      setErrorMessage("No food lines detected in the paste.");
      setStatus("error");
      return;
    }
    setStatus("saving");
    setErrorMessage(null);

    try {
      const result = await bulkCreateFoodEntriesAction({
        date,
        entries: parsed,
      });
      setStatus("idle");
      setIsOpen(false);
      setText("");
      onLogged?.(result.insertedCount);
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Unable to log paste.",
      );
    }
  }

  if (!isOpen) {
    return (
      <ActionButton
        className="w-full"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        variant="secondary"
      >
        Paste & log
      </ActionButton>
    );
  }

  return (
    <section className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          Paste & log
        </p>
        <button
          className="text-xs font-semibold text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]"
          disabled={status === "saving"}
          onClick={() => {
            setIsOpen(false);
            setText("");
            setErrorMessage(null);
            setStatus("idle");
          }}
          type="button"
        >
          Close
        </button>
      </div>
      <textarea
        autoFocus
        className="h-40 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] px-3 py-2 font-mono text-xs leading-5 text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white/40"
        disabled={status === "saving"}
        onChange={(event) => {
          setText(event.target.value);
          if (status === "error") setStatus("idle");
        }}
        placeholder={`Paste an AI plan with per-item macros. Example:

1 Seeq protein shake — 200 cal, 30g P, 5g C, 3g F
1 Oikos + chia — 180 cal, 18g P, 12g C, 5g F
1 Chicken bowl — 450 cal, 38g P, 50g C, 12g F`}
        value={text}
      />
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
        <span>
          {parsed.length} {parsed.length === 1 ? "line" : "lines"} detected
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)]">
          Macros saved exactly as pasted · no AI call
        </span>
      </div>
      {parsed.length > 0 ? (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded border border-dashed border-[var(--border-default)] bg-[var(--surface-base)] p-2 text-xs">
          {parsed.map((line, index) => (
            <li
              className="flex items-center justify-between gap-3 text-[var(--text-secondary)]"
              key={`${line.mealName}-${index}`}
            >
              <span className="truncate font-semibold text-[var(--text-primary)]">
                {line.mealName}
              </span>
              <span className="shrink-0 text-[10px] font-semibold text-[var(--text-tertiary)]">
                {line.calories} cal
                {line.proteinG !== null ? ` · ${line.proteinG}g P` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {errorMessage ? (
        <p className="mt-2 rounded-md border border-red-300/50 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100">
          {errorMessage}
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <ActionButton
          className="flex-1"
          disabled={parsed.length === 0 || status === "saving"}
          onClick={logAll}
          variant="primary"
        >
          {status === "saving"
            ? "Logging..."
            : `Log ${parsed.length || ""} ${
                parsed.length === 1 ? "entry" : "entries"
              }`}
        </ActionButton>
      </div>
    </section>
  );
}
