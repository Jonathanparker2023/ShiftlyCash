type ProjectionMaintenanceSupabase = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type ProjectionMaintenanceResult = {
  cleaned: number;
  projected: number;
};

export async function applyDashboardProjectionMaintenance(
  supabase: ProjectionMaintenanceSupabase,
  input: { weekId: string | null; todayIso: string },
): Promise<ProjectionMaintenanceResult> {
  const { data: cleaned, error: cleanupError } = await supabase.rpc(
    "cleanup_expired_projections",
    { p_today: input.todayIso },
  );

  if (cleanupError) {
    throw new Error(`Unable to clean projections: ${cleanupError.message}`);
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
      throw new Error(
        `Unable to apply projections: ${projectionError.message}`,
      );
    }

    projected = Number(projectedData ?? 0);
  }

  return {
    cleaned: Number(cleaned ?? 0),
    projected,
  };
}
