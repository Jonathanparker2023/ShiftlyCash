"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface-base)] px-4 text-[var(--text-primary)]">
      <section className="w-full max-w-lg rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-6 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
          ShiftlyCash
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Dashboard could not load.
        </h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {error.message || "Something went wrong while loading your active week."}
        </p>
        <button
          className="mt-5 h-10 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 text-sm font-medium transition hover:border-[var(--border-strong)]"
          onClick={reset}
          type="button"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
