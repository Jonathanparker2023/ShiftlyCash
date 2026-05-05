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
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
            ShiftlyCash
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            No email links. Just your app password.
          </p>
        </div>

        <form action={signInWithPassword} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Password</span>
            <input
              className="h-12 w-full rounded-md border border-zinc-300 bg-white px-3 text-base outline-none transition focus:border-zinc-950 focus:ring-4 focus:ring-zinc-200"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button
            className="h-12 w-full rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
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
