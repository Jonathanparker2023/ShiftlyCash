import { describe, expect, it, vi } from "vitest";

import {
  addTagToTask,
  archiveTag,
  completeTask,
  createTag,
  removeTagFromTask,
  updateTag,
} from "@/lib/projects/mutations";

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
                      description: null,
                      due_date: null,
                      status: "todo",
                      sort_order: 10,
                      recur_unit: null,
                      recur_interval: null,
                      recur_anchor_date: null,
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

  it("creates, updates, archives, adds, and removes task tags", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const taskId = "7a11066f-1389-837d-986a-81d0468d0555";
    const projectId = "22222222-2222-4222-8222-222222222222";
    const tagId = "33333333-3333-4333-8333-333333333333";
    const tags = new Map([
      [
        tagId,
        {
          id: tagId,
          user_id: userId,
          name: "Errands",
          color: "#2563eb",
          sort_order: 10,
          archived_at: null,
        },
      ],
    ]);
    const taskTags = new Set<string>();
    const updates: unknown[] = [];
    const supabase = createProjectMutationSupabase({
      projectId,
      tagId,
      tags,
      taskId,
      taskTags,
      updates,
      userId,
    });

    await expect(
      createTag(supabase as never, { name: "Urgent", color: "#dc2626" }),
    ).resolves.toMatchObject({ ok: true, data: { id: tagId } });
    await expect(
      updateTag(supabase as never, { id: tagId, name: "Home" }),
    ).resolves.toMatchObject({ ok: true, data: { id: tagId } });
    await expect(
      addTagToTask(supabase as never, { taskId, tagId }),
    ).resolves.toMatchObject({ ok: true, data: { taskId, projectId, tagId } });
    await expect(
      removeTagFromTask(supabase as never, { taskId, tagId }),
    ).resolves.toMatchObject({ ok: true, data: { taskId, projectId, tagId } });
    await expect(
      archiveTag(supabase as never, { id: tagId }),
    ).resolves.toMatchObject({ ok: true, data: { id: tagId } });

    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Home" }),
        expect.objectContaining({ archived_at: expect.any(String) }),
      ]),
    );
    expect(taskTags.has(`${taskId}:${tagId}`)).toBe(false);
  });

  it("creates the next recurring task with the advanced due date", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const taskId = "7a11066f-1389-837d-986a-81d0468d0555";
    const projectId = "22222222-2222-4222-8222-222222222222";
    const tagId = "33333333-3333-4333-8333-333333333333";
    const insertedTasks: Record<string, unknown>[] = [];
    const insertedTaskTags: Record<string, unknown>[] = [];
    const supabase = createProjectMutationSupabase({
      projectId,
      recurringTask: {
        id: taskId,
        user_id: userId,
        project_id: projectId,
        title: "Weekly review",
        description: "Look back and reset.",
        due_date: "2026-05-08",
        status: "todo",
        sort_order: 10,
        recur_unit: "week",
        recur_interval: 1,
        recur_anchor_date: "2026-05-08",
      },
      taskId,
      taskTagIds: [tagId],
      insertedTasks,
      insertedTaskTags,
      userId,
    });

    const result = await completeTask(supabase as never, { id: taskId });

    expect(result).toMatchObject({ ok: true, data: { id: taskId, projectId } });
    expect(insertedTasks).toHaveLength(1);
    expect(insertedTasks[0]).toMatchObject({
      due_date: "2026-05-15",
      recur_anchor_date: "2026-05-15",
      status: "todo",
      title: "Weekly review",
    });
    expect(insertedTaskTags).toEqual([
      {
        task_id: "44444444-4444-4444-8444-444444444444",
        tag_id: tagId,
        user_id: userId,
      },
    ]);
  });
});

function createProjectMutationSupabase(input: {
  insertedTasks?: Record<string, unknown>[];
  insertedTaskTags?: Record<string, unknown>[];
  projectId: string;
  recurringTask?: Record<string, unknown>;
  tagId?: string;
  tags?: Map<string, Record<string, unknown>>;
  taskId: string;
  taskTagIds?: string[];
  taskTags?: Set<string>;
  updates?: unknown[];
  userId: string;
}) {
  const newTaskId = "44444444-4444-4444-8444-444444444444";
  const task = input.recurringTask ?? {
    id: input.taskId,
    user_id: input.userId,
    project_id: input.projectId,
    title: "Imported task",
    description: null,
    due_date: null,
    status: "todo",
    sort_order: 10,
    recur_unit: null,
    recur_interval: null,
    recur_anchor_date: null,
  };

  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: input.userId } },
        error: null,
      }),
    },
    from(table: string) {
      if (table === "project_events") {
        return {
          insert: async () => ({ error: null }),
        };
      }

      if (table === "tasks") {
        return {
          insert(payload: Record<string, unknown>) {
            input.insertedTasks?.push(payload);
            return {
              select() {
                return {
                  single: async () => ({ data: { id: newTaskId }, error: null }),
                };
              },
            };
          },
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(field: string, value: unknown) {
                filters[field] = value;
                return chain;
              },
              limit() {
                return chain;
              },
              maybeSingle: async () => {
                if (filters.id === input.taskId) {
                  return { data: task, error: null };
                }

                return { data: { sort_order: 20 }, error: null };
              },
              order() {
                return chain;
              },
            };
            return chain;
          },
          update(payload: unknown) {
            input.updates?.push(payload);
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }

      if (table === "tags") {
        return {
          insert(payload: Record<string, unknown>) {
            const id = input.tagId ?? "33333333-3333-4333-8333-333333333333";
            input.tags?.set(id, { id, ...payload });
            return {
              select() {
                return {
                  single: async () => ({ data: { id }, error: null }),
                };
              },
            };
          },
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(field: string, value: unknown) {
                filters[field] = value;
                return chain;
              },
              limit() {
                return chain;
              },
              maybeSingle: async () => {
                if (filters.id && input.tags?.has(String(filters.id))) {
                  return { data: input.tags.get(String(filters.id)), error: null };
                }

                return { data: { sort_order: 0 }, error: null };
              },
              order() {
                return chain;
              },
            };
            return chain;
          },
          update(payload: unknown) {
            input.updates?.push(payload);
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }

      if (table === "task_tags") {
        return {
          delete() {
            const filters: Record<string, unknown> = {};
            const chain = {
              error: null,
              eq(field: string, value: unknown) {
                filters[field] = value;
                if (filters.task_id && filters.tag_id) {
                  input.taskTags?.delete(`${filters.task_id}:${filters.tag_id}`);
                }
                return chain;
              },
            };
            return chain;
          },
          insert(payload: Record<string, unknown>[]) {
            input.insertedTaskTags?.push(...payload);
            return { error: null };
          },
          select() {
            return {
              eq() {
                return {
                  eq: async () => ({
                    data: (input.taskTagIds ?? []).map((tag_id) => ({ tag_id })),
                    error: null,
                  }),
                };
              },
            };
          },
          upsert(payload: Record<string, unknown>) {
            input.taskTags?.add(`${payload.task_id}:${payload.tag_id}`);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}
