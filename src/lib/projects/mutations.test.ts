import { describe, expect, it, vi } from "vitest";

import { completeTask } from "@/lib/projects/mutations";

vi.mock("server-only", () => ({}));

describe("project mutations", () => {
  it("accepts Notion UUID-shaped task ids when completing tasks", async () => {
    const taskId = "7a11066f-1389-837d-986a-81d0468d0555";
    const userId = "11111111-1111-4111-8111-111111111111";
    const projectId = "22222222-2222-4222-8222-222222222222";
    const updates: unknown[] = [];
    const supabase = {
      auth: {
        getUser: async () => ({
          data: { user: { id: userId } },
          error: null,
        }),
      },
      from(table: string) {
        if (table === "project_events") {
          return {
            insert: async () => ({ error: null }),
          };
        }

        if (table !== "tasks") {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: {
                      id: taskId,
                      user_id: userId,
                      project_id: projectId,
                      title: "Imported task",
                      status: "todo",
                    },
                    error: null,
                  }),
                };
              },
            };
          },
          update(payload: unknown) {
            updates.push(payload);
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      },
    };

    const result = await completeTask(supabase as never, { id: taskId });

    expect(result).toEqual({
      ok: true,
      data: { id: taskId, projectId },
      error: null,
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "done" });
  });
});
