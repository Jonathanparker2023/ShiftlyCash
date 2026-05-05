import { updatePasswordAction } from "@/app/(protected)/settings/account/actions";
import { requireUser } from "@/lib/auth";

type AccountSettingsPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function AccountSettingsPage({
  searchParams,
}: AccountSettingsPageProps) {
  const { user } = await requireUser();
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-5 text-zinc-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-xl rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
          ShiftlyCash
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Account password
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Signed in as {user.email}. Set a password here, then production login
          will stop using magic links.
        </p>

        <form action={updatePasswordAction} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">New password</span>
            <input
              autoComplete="new-password"
              className="h-12 w-full rounded-md border border-zinc-300 bg-white px-3 text-base outline-none transition focus:border-zinc-950 focus:ring-4 focus:ring-zinc-200"
              minLength={10}
              name="password"
              required
              type="password"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium">Confirm password</span>
            <input
              autoComplete="new-password"
              className="h-12 w-full rounded-md border border-zinc-300 bg-white px-3 text-base outline-none transition focus:border-zinc-950 focus:ring-4 focus:ring-zinc-200"
              minLength={10}
              name="confirmPassword"
              required
              type="password"
            />
          </label>

          <button
            className="h-12 w-full rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
            type="submit"
          >
            Save password
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
