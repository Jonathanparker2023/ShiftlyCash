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

    expect(result).toEqual({ cleaned: 2, projected: 4, degraded: false });
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

    expect(result).toEqual({ cleaned: 1, projected: 0, degraded: false });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  // The dashboard awaits this before rendering anything, so a throw here blanks
  // the entire finances view. These two are the regression guard for that.
  it("does not throw when cleanup fails, and reports degraded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
    };

    const result = await applyDashboardProjectionMaintenance(supabase, {
      weekId: "week-1",
      todayIso: "2026-05-13",
    });

    expect(result).toEqual({ cleaned: 0, projected: 0, degraded: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not throw when the projection RPC fails after a clean succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = {
      rpc: vi.fn(async (fn: string) =>
        fn === "cleanup_expired_projections"
          ? { data: 3, error: null }
          : { data: null, error: { message: "pooler said no" } },
      ),
    };

    const result = await applyDashboardProjectionMaintenance(supabase, {
      weekId: "week-1",
      todayIso: "2026-05-13",
    });

    // The clean still counts -- only the projection half degraded.
    expect(result).toEqual({ cleaned: 3, projected: 0, degraded: true });
    warn.mockRestore();
  });
});
