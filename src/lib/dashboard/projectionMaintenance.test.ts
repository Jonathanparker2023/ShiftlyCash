import { describe, expect, it, vi } from "vitest";

import { applyDashboardProjectionMaintenance } from "@/lib/dashboard/projectionMaintenance";

describe("applyDashboardProjectionMaintenance", () => {
  it("cleans expired projections before applying future projections", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const supabase = {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });

        if (fn === "cleanup_expired_projections") {
          return { data: 2, error: null };
        }

        return { data: 4, error: null };
      }),
    };

    const result = await applyDashboardProjectionMaintenance(supabase, {
      weekId: "week-1",
      todayIso: "2026-05-13",
    });

    expect(result).toEqual({ cleaned: 2, projected: 4 });
    expect(calls).toEqual([
      {
        fn: "cleanup_expired_projections",
        args: { p_today: "2026-05-13" },
      },
      {
        fn: "apply_future_day_projection",
        args: { p_week_id: "week-1", p_today: "2026-05-13" },
      },
    ]);
  });

  it("still cleans expired projections when no active week exists", async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: 1, error: null })),
    };

    const result = await applyDashboardProjectionMaintenance(supabase, {
      weekId: null,
      todayIso: "2026-05-13",
    });

    expect(result).toEqual({ cleaned: 1, projected: 0 });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
});
