import { describe, expect, it, vi } from "vitest";

import {
  deriveProjectHealth,
  getCompletionHeatmapData,
  getTasksFiltered,
  getTodayData,
} from "@/lib/projects/data";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboard/dates", () => ({
  getTodayIso: () => "2026-05-08",
}));

describe("project data", () => {
  it("derives red health from open past-due tasks", () => {
    expect(
      deriveProjectHealth({
        lastEventAt: "2026-05-08T10:00:00.000Z",
        now: new Date("2026-05-08T12:00:00.000Z"),
        openPastDueCount: 1,
      }),
    ).toEqual({ health: "red", reason: "1 task past due" });
  });

  it("derives plural red health reason from multiple open past-due tasks", () => {
    expect(
      deriveProjectHealth({
        lastEventAt: "2026-05-08T10:00:00.000Z",
        now: new Date("2026-05-08T12:00:00.000Z"),
        openPastDueCount: 3,
      }),
    ).toEqual({ health: "red", reason: "3 tasks past due" });
  });

  it("derives yellow health from missing project activity", () => {
    expect(
      deriveProjectHealth({
        lastEventAt: null,
        now: new Date("2026-05-08T12:00:00.000Z"),
        openPastDueCount: 0,
      }),
    ).toEqual({ health: "yellow", reason: "No activity yet" });
  });

  it("derives yellow health from stale project activity", () => {
    expect(
      deriveProjectHealth({
        lastEventAt: "2026-04-20T10:00:00.000Z",
        now: new Date("2026-05-08T12:00:00.000Z"),
        openPastDueCount: 0,
      }),
    ).toEqual({ health: "yellow", reason: "No activity in 18 days" });
  });

  it("derives green health from fresh activity without past-due tasks", () => {
    expect(
      deriveProjectHealth({
        lastEventAt: "2026-05-01T10:00:00.000Z",
        now: new Date("2026-05-08T12:00:00.000Z"),
        openPastDueCount: 0,
      }),
    ).toEqual({ health: "green", reason: "Active" });
  });

  it("returns dense completion heatmap days sorted ascending", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const projectId = "22222222-2222-4222-8222-222222222222";
    const supabase = {
      auth: {
        getUser: async () => ({
          data: { user: { id: userId } },
          error: null,
        }),
      },
      from(table: string) {
        if (table !== "project_events") {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          select() {
            const chain = {
              eq() {
                return chain;
              },
              gte() {
                return chain;
              },
              then(resolve: (value: unknown) => void) {
                resolve({
                  data: [
                    { created_at: "2026-05-07T12:00:00.000Z" },
                    { created_at: "2026-05-07T13:00:00.000Z" },
                  ],
                  error: null,
                });
              },
            };
            return chain;
          },
        };
      },
    };

    const days = await getCompletionHeatmapData(supabase as never, projectId, 3);

    expect(days).toEqual([
      { date: "2026-05-06", count: 0 },
      { date: "2026-05-07", count: 2 },
      { date: "2026-05-08", count: 0 },
    ]);
  });

  it("partitions today tasks from later this-week tasks", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const todayTaskId = "7a11066f-1389-837d-986a-81d0468d0555";
    const weekTaskId = "7a11066f-1389-837d-986a-81d0468d0556";
    const supabase = createProjectDataSupabase({
      taskRows: [
        taskRow(todayTaskId, "Project A", "Today task", "2026-05-08"),
        taskRow(weekTaskId, "Project B", "Week task", "2026-05-10"),
      ],
      userId,
    });

    const data = await getTodayData(supabase as never, "2026-05-08");

    expect(data.dueToday.map((task) => task.title)).toEqual(["Today task"]);
    expect(data.dueThisWeek.map((task) => task.title)).toEqual(["Week task"]);
  });

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

function createProjectDataSupabase(input: {
  taskRows: ReturnType<typeof taskRow>[];
  userId: string;
}) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: input.userId } },
        error: null,
      }),
    },
    from(table: string) {
      if (table === "task_tags") {
        return {
          select() {
            const chain = {
              eq() {
                return chain;
              },
              in() {
                return chain;
              },
              then(resolve: (value: unknown) => void) {
                resolve({ data: [], error: null });
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
              gte() {
                return chain;
              },
              in() {
                return chain;
              },
              lte() {
                return chain;
              },
              order() {
                return chain;
              },
              then(resolve: (value: unknown) => void) {
                resolve({ data: input.taskRows, error: null });
              },
            };
            return chain;
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function taskRow(
  id: string,
  projectName: string,
  title: string,
  dueDate: string | null = null,
) {
  return {
    id,
    project_id: `22222222-2222-4222-8222-${id.slice(-12)}`,
    title,
    description: null,
    due_date: dueDate,
    status: "todo",
    sort_order: 10,
    completed_at: null,
    recur_unit: null,
    recur_interval: null,
    recur_anchor_date: null,
    projects: { name: projectName },
  };
}
