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
    <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold">Chime email captures</h2>
      {captures.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">No Chime emails captured yet.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map(([date, dateCapturesDesc]) => (
            <div key={date} className="border-t border-zinc-100 pt-3 first:border-0 first:pt-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
                {date}
              </p>
              <div className="mt-2 space-y-2">
                {dateCapturesDesc.map((capture) => (
                  <div key={capture.id} className="rounded-md bg-zinc-50 p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {capture.rawTitle && (
                          <p className="font-medium text-zinc-950">{capture.rawTitle}</p>
                        )}
                        <p className="mt-1 break-words text-zinc-600 text-xs leading-relaxed">
                          {capture.rawText}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 items-center">
                          {capture.parsedTransactionId ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                              ✓ Parsed to transaction
                            </span>
                          ) : capture.parseFailureReason ? (
                            <span
                              className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700"
                              title={capture.parseFailureReason}
                            >
                              ⚠ {capture.parseFailureReason}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
                              — No parse status
                            </span>
                          )}
                          <span className="text-xs text-zinc-400">
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
