"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { reopenWeekAction } from "@/app/(protected)/history/actions";

export function ReopenWeekButton({
  dateRange,
  displayWeekNumber,
  weekId,
}: {
  dateRange: string;
  displayWeekNumber: number;
  weekId: string;
}) {
  const router = useRouter();
  const [isReopening, setIsReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopenWeek() {
    const confirmed = window.confirm(
      `Reopen week ${displayWeekNumber} (${dateRange})? This will discard your current active week and any unsaved data on it. Continue?`,
    );

    if (!confirmed) {
      return;
    }

    setIsReopening(true);
    setError(null);

    try {
      await reopenWeekAction({ weekId });
      router.push("/");
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to reopen week.",
      );
      setIsReopening(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium transition hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isReopening}
        onClick={reopenWeek}
        type="button"
      >
        {isReopening ? "Reopening..." : "Reopen week"}
      </button>
      {error ? <p className="max-w-sm text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  );
}
