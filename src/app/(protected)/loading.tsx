/**
 * Generic skeleton for any route under (protected).
 * Renders instantly while the server prepares the real page, so navigation
 * feels responsive even when the underlying loader takes 500-1500ms.
 *
 * Matches the dark navy theme of the actual pages so transitions don't
 * flash a light background between nav and content.
 *
 * Per-route loading.tsx files can override this for richer placeholders
 * (e.g., a dashboard skeleton with a day strip + metric cards).
 */
export default function ProtectedLoading() {
  return (
    <div className="min-h-screen w-full bg-[#101827] px-3 py-5 text-[#f8fafc] sm:px-6 lg:px-8">
      <div
        aria-busy="true"
        aria-label="Loading"
        className="mx-auto max-w-7xl animate-pulse"
      >
        {/* Page header */}
        <header className="mb-5 border-b border-[#2f3d52] pb-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_296px] lg:items-start">
            <div className="space-y-2">
              <div className="h-3 w-32 rounded bg-[#2f3d52]" />
              <div className="h-9 w-72 rounded bg-[#2f3d52]" />
              <div className="h-4 w-56 rounded bg-[#2f3d52]" />
              <div className="h-3 w-48 rounded bg-[#2f3d52]" />
            </div>
            <div className="h-32 rounded-md border border-[#2f3d52] bg-[#1b2538]" />
          </div>
        </header>

        {/* Metric grid */}
        <section className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, idx) => (
            <div
              key={idx}
              className="h-28 rounded-md border border-[#2f3d52] bg-[#1b2538]"
            />
          ))}
        </section>

        {/* Primary panel */}
        <section className="mb-5 h-72 rounded-md border border-[#2f3d52] bg-[#1b2538]" />

        {/* Secondary content */}
        <section className="grid gap-5 lg:grid-cols-2">
          <div className="h-56 rounded-md border border-[#2f3d52] bg-[#1b2538]" />
          <div className="h-56 rounded-md border border-[#2f3d52] bg-[#1b2538]" />
        </section>
      </div>
    </div>
  );
}
