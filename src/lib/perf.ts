/**
 * Server-side timing helper for tracing loader hot paths.
 *
 * Logs to stdout (Vercel function logs) in the form:
 *   [timing] dashboard:auth=187ms
 *   [timing] dashboard:ensureWeek=92ms
 *   [timing] dashboard:totals_batch=412ms
 *
 * Use the `timed()` wrapper around any async section you want to measure.
 * Use `mark()` at start of a function and `since()` to take spot readings.
 *
 * Strip these calls (or set NEXT_PUBLIC_DISABLE_TIMING=1) once you've
 * identified the bottleneck and shipped a fix.
 */

const ENABLED = process.env.NEXT_PUBLIC_DISABLE_TIMING !== "1";

// PromiseLike (not Promise) because supabase query/RPC builders are thenable
// but not strict Promises — without this, `timed("...", () => supabase.rpc(...))`
// fails to typecheck.
export async function timed<T>(
  label: string,
  fn: () => PromiseLike<T>,
): Promise<T> {
  if (!ENABLED) return fn();
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    // eslint-disable-next-line no-console
    console.log(`[timing] ${label}=${Date.now() - t0}ms`);
  }
}

export function mark(): number {
  return Date.now();
}

export function since(label: string, t0: number): void {
  if (!ENABLED) return;
  // eslint-disable-next-line no-console
  console.log(`[timing] ${label}=${Date.now() - t0}ms`);
}
