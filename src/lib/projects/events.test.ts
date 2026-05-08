import { describe, expect, it, vi } from "vitest";

import { logProjectEvent } from "@/lib/projects/events";

vi.mock("server-only", () => ({}));

describe("logProjectEvent", () => {
  it("inserts an event row with the expected kind and payload", async () => {
    const inserts: unknown[] = [];
    const userId = "11111111-1111-4111-8111-111111111111";
    const projectId = "22222222-2222-4222-8222-222222222222";
    const taskId = "33333333-3333-4333-8333-333333333333";
    const supabase = {
      auth: {
        getUser: async () => ({
          data: { user: { id: userId } },
          error: null,
        }),
      },
      from(table: string) {
        expect(table).toBe("project_events");
        return {
          insert: async (payload: unknown) => {
            inserts.push(payload);
            return { error: null };
          },
        };
      },
    };

    await logProjectEvent({
      supabase: supabase as never,
      projectId,
      taskId,
      kind: "task.created",
      payload: { title: "Call clinic" },
    });

    expect(inserts).toEqual([
      {
        user_id: userId,
        project_id: projectId,
        task_id: taskId,
        actor_id: userId,
        kind: "task.created",
        payload: { title: "Call clinic" },
      },
    ]);
  });

  it("does not throw when auth fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = {
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { message: "not signed in" },
        }),
      },
      from() {
        throw new Error("insert should not run");
      },
    };

    await expect(
      logProjectEvent({
        supabase: supabase as never,
        projectId: "22222222-2222-4222-8222-222222222222",
        kind: "project.created",
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
