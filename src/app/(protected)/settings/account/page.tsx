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
    <main className="min-h-screen bg-[var(--surface-base)] px-4 py-5 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <section className="mx-auto max-w-xl rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-5 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
          ShiftlyCash
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Account password
        </h1>
        <p className="mt-2 text-sm text-[var(--text-tertiary)]">
          Signed in as {user.email}. Set a password here, then production login
          will stop using magic links.
        </p>

        <form action={updatePasswordAction} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">New password</span>
            <input
              autoComplete="new-password"
              className="h-12 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-base outline-none transition focus:border-[var(--border-strong)] focus:ring-4 focus:ring-[var(--accent-ring)]"
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
              className="h-12 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-base outline-none transition focus:border-[var(--border-strong)] focus:ring-4 focus:ring-[var(--accent-ring)]"
              minLength={10}
              name="confirmPassword"
              required
              type="password"
            />
          </label>

          <button
            className="h-12 w-full rounded-md bg-[var(--accent-brand)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent-brand-hover)]"
            type="submit"
          >
            Save password
          </button>
        </form>

        {params.message ? (
          <p className="mt-5 rounded-md border border-[var(--accent-primary-border)] bg-[var(--accent-primary-fill)] px-3 py-2 text-sm text-[var(--accent-primary-text)]">
            {params.message}
          </p>
        ) : null}

        {params.error ? (
          <p className="mt-5 rounded-md border border-[var(--accent-negative-border)] bg-[var(--accent-negative-fill)] px-3 py-2 text-sm text-[var(--accent-negative-text)]">
            {params.error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
