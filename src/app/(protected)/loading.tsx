export default function Loading() {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-5 text-zinc-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <div className="mb-5 border-b border-zinc-200 pb-4">
          <div className="h-4 w-32 rounded bg-zinc-200" />
          <div className="mt-3 h-8 w-48 rounded bg-zinc-200" />
          <div className="mt-2 h-4 w-56 rounded bg-zinc-200" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 7 }, (_, index) => (
            <div
              className="h-80 rounded-md border border-zinc-200 bg-white p-4 shadow-sm"
              key={index}
            >
              <div className="h-6 w-24 rounded bg-zinc-200" />
              <div className="mt-6 space-y-3">
                <div className="h-10 rounded bg-zinc-100" />
                <div className="h-10 rounded bg-zinc-100" />
                <div className="h-10 rounded bg-zinc-100" />
                <div className="h-10 rounded bg-zinc-100" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
