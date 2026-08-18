type ProjectionMaintenanceSupabase = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type ProjectionMaintenanceResult = {
  cleaned: number;
  projected: number;
  /** True when maintenance was skipped because an RPC failed. */
  degraded: boolean;
};

// PROJECTION MAINTENANCE IS NOT ALLOWED TO BREAK THE DASHBOARD.
//
// This fills future days with a placeholder spend figure. It is a convenience,
// not a source of truth -- every real number on the page is derived elsewhere.
// It used to throw, and getDashboardData awaits it before rendering anything,
// so a fault in the projection RPC took out the entire finances view with
// "Dashboard could not load" rather than degrading to "no placeholders today".
//
// A helper that decorates future days must never be able to hide the past.

export async function applyDashboardProjectionMaintenance(
  supabase: ProjectionMaintenanceSupabase,
  input: { weekId: string | null; todayIso: string },
): Promise<ProjectionMaintenanceResult> {
  const { data: cleaned, error: cleanupError } = await supabase.rpc(
    "cleanup_expired_projections",
    { p_today: input.todayIso },
  );

  if (cleanupError) {
    // Non-fatal on purpose -- see the note on this function's return type.
    console.warn(
      `[dashboard] projection cleanup skipped: ${cleanupError.message}`,
    );
    return { cleaned: 0, projected: 0, degraded: true };
  }

  let projected = 0;

  if (input.weekId) {
    const { data: projectedData, error: projectionError } = await supabase.rpc(
      "apply_future_day_projection",
      {
        p_week_id: input.weekId,
        p_today: input.todayIso,
      },
    );

    if (projectionError) {
      console.warn(
        `[dashboard] projection apply skipped: ${projectionError.message}`,
      );
      return { cleaned: Number(cleaned ?? 0), projected: 0, degraded: true };
    }

    projected = Number(projectedData ?? 0);
  }

  return {
    cleaned: Number(cleaned ?? 0),
    projected,
    degraded: false,
  };
}
