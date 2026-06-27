"use client";

import { useMemo } from "react";

import type { ChimeCapture } from "@/lib/banking/types";

export function ChimeCapturesSection({ captures }: { captures: ChimeCapture[] }) {
  const groups = useMemo(() => {
    const grouped = new Map<string, ChimeCapture[]>();

    for (const capture of captures) {
      const date = capture.receivedAt.split("T")[0];
      if (!grouped.has(date)) {
        grouped.set(date, []);
      }
      grouped.get(date)!.push(capture);
    }

    // Sort dates descending
    return Array.from(grouped.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [captures]);

  return (
    <section className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 shadow-sm">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">Chime email captures</h2>
      {captures.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-tertiary)]">No Chime emails captured yet.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map(([date, dateCapturesDesc]) => (
            <div key={date} className="border-t border-[var(--border-subtle)] pt-3 first:border-0 first:pt-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                {date}
              </p>
              <div className="mt-2 space-y-2">
                {dateCapturesDesc.map((capture) => (
                  <div key={capture.id} className="rounded-md bg-[var(--surface-hover)] p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {capture.rawTitle && (
                          <p className="font-medium text-[var(--text-primary)]">{capture.rawTitle}</p>
                        )}
                        <p className="mt-1 break-words text-[var(--text-tertiary)] text-xs leading-relaxed">
                          {capture.rawText}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 items-center">
                          {capture.parsedTransactionId ? (
                            <span className="inline-flex items-center rounded-full bg-[var(--accent-primary-fill)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-primary-text)]">
                              ✓ Parsed to transaction
                            </span>
                          ) : capture.parseFailureReason ? (
                            <span
                              className="inline-flex items-center rounded-full bg-[var(--accent-warning-fill)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-warning-text)]"
                              title={capture.parseFailureReason}
                            >
                              ⚠ {capture.parseFailureReason}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-[var(--surface-hover)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-tertiary)]">
                              — No parse status
                            </span>
                          )}
                          <span className="text-xs text-[var(--text-muted)]">
                            {formatTime(capture.receivedAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
