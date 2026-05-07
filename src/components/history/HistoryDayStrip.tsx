"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Wraps the History detail day cards in a horizontal-scroll container and
 * scrolls to today's card on mount (or the last day of the week if the loaded
 * week is in the past). Avoids forcing the user to manually scroll right past
 * Sunday on lg+ screens.
 */
export function HistoryDayStrip({
  children,
  todayIso,
}: {
  children: ReactNode;
  todayIso: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) {
      return;
    }

    // Prefer today's card; fall back to the last (most-recent) card of the week
    // when the week ended before today.
    const todayEl = root.querySelector<HTMLElement>(
      `[data-day-date="${todayIso}"]`,
    );
    const target =
      todayEl ?? (root.lastElementChild as HTMLElement | null);

    if (!target) {
      return;
    }

    target.scrollIntoView({
      block: "nearest",
      inline: "start",
      behavior: "auto",
    });
  }, [todayIso]);

  return (
    <section
      className="flex flex-col gap-4 lg:flex-row lg:overflow-x-auto lg:pb-2"
      ref={containerRef}
    >
      {children}
    </section>
  );
}
