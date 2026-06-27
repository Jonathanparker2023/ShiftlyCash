import { signInWithPassword } from "@/app/(auth)/login/actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-8">
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            ShiftlyCash
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            No email links. Just your app password.
          </p>
        </div>

        <form action={signInWithPassword} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Password</span>
            <input
              className="h-12 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-base text-[var(--text-primary)] outline-none transition focus:border-[var(--border-strong)] focus:ring-4 focus:ring-[var(--accent-ring)]"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button
            className="h-12 w-full rounded-md bg-[var(--accent-brand)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent-brand-hover)]"
            type="submit"
          >
            Unlock ShiftlyCash
          </button>
        </form>

        {params.message ? (
          <p className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {params.message}
          </p>
        ) : null}

        {params.error ? (
          <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {params.error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
