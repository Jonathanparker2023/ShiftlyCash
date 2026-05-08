import { describe, expect, it, vi } from "vitest";

import { getTasksFiltered } from "@/lib/projects/data";

vi.mock("server-only", () => ({}));

describe("project data", () => {
  it("returns tag-filtered tasks across projects", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const tagId = "33333333-3333-4333-8333-333333333333";
    const taskOneId = "7a11066f-1389-837d-986a-81d0468d0555";
    const taskTwoId = "7a11066f-1389-837d-986a-81d0468d0556";
    const supabase = {
      auth: {
        getUser: async () => ({
          data: { user: { id: userId } },
          error: null,
        }),
      },
      from(table: string) {
        if (table === "task_tags") {
          return {
            select(columns: string) {
              const filters: Record<string, unknown> = {};
              const chain = {
                eq(field: string, value: unknown) {
                  filters[field] = value;
                  return chain;
                },
                in(field: string, values: string[]) {
                  filters[field] = values;
                  return chain;
                },
                then(resolve: (value: unknown) => void) {
                  if (columns.includes("tags(")) {
                    resolve({
                      data: [taskOneId, taskTwoId].map((task_id) => ({
                        task_id,
                        tag_id: tagId,
                        tags: {
                          id: tagId,
                          name: "Focus",
                          color: "#2563eb",
                          sort_order: 10,
                          archived_at: null,
                        },
                      })),
                      error: null,
                    });
                    return;
                  }

                  resolve({
                    data: [{ task_id: taskOneId }, { task_id: taskTwoId }],
                    error: null,
                  });
                },
              };
              return chain;
            },
          };
        }

        if (table === "tasks") {
          return {
            select() {
              const chain = {
                eq() {
                  return chain;
                },
                in() {
                  return chain;
                },
                not() {
                  return chain;
                },
                lte() {
                  return chain;
                },
                order() {
                  return chain;
                },
                then(resolve: (value: unknown) => void) {
                  resolve({
                    data: [
                      taskRow(taskOneId, "Project A", "A task"),
                      taskRow(taskTwoId, "Project B", "B task"),
                    ],
                    error: null,
                  });
                },
              };
              return chain;
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };

    const tasks = await getTasksFiltered(supabase as never, {
      tagIds: [tagId],
      statuses: ["todo"],
    });

    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.projectName)).toEqual(["Project A", "Project B"]);
    expect(tasks.every((task) => task.tags[0]?.name === "Focus")).toBe(true);
  });
});

function taskRow(id: string, projectName: string, title: string) {
  return {
    id,
    project_id: `22222222-2222-4222-8222-${id.slice(-12)}`,
    title,
    description: null,
    due_date: null,
    status: "todo",
    sort_order: 10,
    completed_at: null,
    recur_unit: null,
    recur_interval: null,
    recur_anchor_date: null,
    projects: { name: projectName },
  };
}
