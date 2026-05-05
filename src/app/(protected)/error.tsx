"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-950">
      <section className="w-full max-w-lg rounded-md border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
          ShiftlyCash
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Dashboard could not load.
        </h1>
        <p className="mt-3 text-sm text-zinc-600">
          {error.message || "Something went wrong while loading your active week."}
        </p>
        <button
          className="mt-5 h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium transition hover:border-zinc-950"
          onClick={reset}
          type="button"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
