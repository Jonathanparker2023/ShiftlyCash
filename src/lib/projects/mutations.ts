import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logProjectEvent } from "@/lib/projects/events";
import type { ProjectStatus, RecurUnit, TaskStatus } from "@/lib/projects/types";

export type MutationResult<T> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: null; error: string };

export type CreateProjectInput = {
  name: string;
  description?: string | null;
  color?: string | null;
  deadline?: string | null;
};

export type UpdateProjectFields = {
  name?: string;
  description?: string | null;
  color?: string;
  deadline?: string | null;
  sortOrder?: number;
};

export type UpdateProjectInput = {
  id: string;
  fields: UpdateProjectFields;
};

export type CreateTaskInput = {
  projectId: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
  recurUnit?: RecurUnit | null;
  recurInterval?: number | null;
  recurAnchorDate?: string | null;
};

export type UpdateTaskFields = {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
  sortOrder?: number;
  recurUnit?: RecurUnit | null;
  recurInterval?: number | null;
  recurAnchorDate?: string | null;
};

export type UpdateTaskInput = {
  id: string;
  fields: UpdateTaskFields;
};

type ProjectOwnershipRow = {
  id: string;
  user_id: string;
  name: string;
};

type TaskOwnershipRow = {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: TaskStatus;
  sort_order: number | null;
  recur_unit: RecurUnit | null;
  recur_interval: number | null;
  recur_anchor_date: string | null;
};

type TagOwnershipRow = {
  id: string;
  user_id: string;
  name: string;
  color: string;
};

type SortRow = {
  sort_order: number | null;
};

export async function createProject(
  supabase: SupabaseClient,
  input: CreateProjectInput,
): Promise<MutationResult<{ id: string }>> {
  const userResult = await getAuthedUserId(supabase);
  if (!userResult.ok) return userResult;

  const name = requireName(input.name, "project name");
  if (!name.ok) return name;

  const description = normalizeOptionalText(input.description);
  const color = input.color ? requireColor(input.color) : ok("#1d4ed8");
  if (!color.ok) return color;

  const deadline = normalizeDate(input.deadline, "deadline");
  if (!deadline.ok) return deadline;

  const orderResult = await nextProjectSortOrder(supabase, userResult.data);
  if (!orderResult.ok) return orderResult;

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: userResult.data,
      name: name.data,
      description,
      color: color.data,
      deadline: deadline.data,
      sort_order: orderResult.data,
    })
    .select("id")
    .single();

  if (error) return fail(`Unable to create project: ${error.message}`);

  const projectId = (data as { id: string }).id;
  await logProjectEvent({
    supabase,
    projectId,
    kind: "project.created",
    payload: { name: name.data, color: color.data, deadline: deadline.data },
  });

  return ok({ id: projectId });
}

export async function updateProject(
  supabase: SupabaseClient,
  input: UpdateProjectInput,
): Promise<MutationResult<{ id: string }>> {
  const id = requireUuid(input.id, "project id");
  if (!id.ok) return id;

  const owner = await getProjectForUser(supabase, id.data);
  if (!owner.ok) return owner;

  const patch: Record<string, unknown> = {};
  const changedFields: string[] = [];
  if ("name" in input.fields) {
    const name = requireName(input.fields.name ?? "", "project name");
    if (!name.ok) return name;
    patch.name = name.data;
    changedFields.push("name");
  }

  if ("description" in input.fields) {
    patch.description = normalizeOptionalText(input.fields.description);
    changedFields.push("description");
  }

  if ("color" in input.fields && input.fields.color !== undefined) {
    const color = requireColor(input.fields.color);
    if (!color.ok) return color;
    patch.color = color.data;
    changedFields.push("color");
  }

  if ("deadline" in input.fields) {
    const deadline = normalizeDate(input.fields.deadline, "deadline");
    if (!deadline.ok) return deadline;
    patch.deadline = deadline.data;
    changedFields.push("deadline");
  }

  if ("sortOrder" in input.fields && input.fields.sortOrder !== undefined) {
    const sortOrder = requireInteger(input.fields.sortOrder, "sortOrder");
    if (!sortOrder.ok) return sortOrder;
    patch.sort_order = sortOrder.data;
    changedFields.push("sortOrder");
  }

  if (Object.keys(patch).length === 0) {
    return ok({ id: owner.data.id });
  }

  const { error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", owner.data.id);

  if (error) return fail(`Unable to update project: ${error.message}`);

  await logProjectEvent({
    supabase,
    projectId: owner.data.id,
    kind: "project.updated",
    payload: { changedFields },
  });

  return ok({ id: owner.data.id });
}

export async function archiveProject(
  supabase: SupabaseClient,
  input: { id: string },
): Promise<MutationResult<{ id: string }>> {
  const id = requireUuid(input.id, "project id");
  if (!id.ok) return id;

  const owner = await getProjectForUser(supabase, id.data);
  if (!owner.ok) return owner;

  const { error } = await supabase
    .from("projects")
    .update({ status: "archived" satisfies ProjectStatus })
    .eq("id", owner.data.id);

  if (error) return fail(`Unable to archive project: ${error.message}`);

  await logProjectEvent({
    supabase,
    projectId: owner.data.id,
    kind: "project.archived",
  });

  return ok({ id: owner.data.id });
}

export async function deleteProject(
  supabase: SupabaseClient,
  input: { id: string },
): Promise<MutationResult<{ id: string }>> {
  const id = requireUuid(input.id, "project id");
  if (!id.ok) return id;

  const owner = await getProjectForUser(supabase, id.data);
  if (!owner.ok) return owner;

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", owner.data.id);

  if (error) return fail(`Unable to delete project: ${error.message}`);

  await logProjectEvent({
    supabase,
    projectId: owner.data.id,
    kind: "project.deleted",
    payload: { name: owner.data.name },
  });

  return ok({ id: owner.data.id });
}

export async function createTask(
  supabase: SupabaseClient,
  input: CreateTaskInput,
): Promise<MutationResult<{ id: string; projectId: string }>> {
  const projectId = requireUuid(input.projectId, "project id");
  if (!projectId.ok) return projectId;

  const project = await getProjectForUser(supabase, projectId.data);
  if (!project.ok) return project;

  const title = requireName(input.title, "task title");
  if (!title.ok) return title;

  const dueDate = normalizeDate(input.dueDate, "due date");
  if (!dueDate.ok) return dueDate;

  const status = input.status ? requireTaskStatus(input.status) : ok("todo" as const);
  if (!status.ok) return status;

  const recurrence = normalizeRecurrence({
    recurUnit: input.recurUnit,
    recurInterval: input.recurInterval,
    recurAnchorDate: input.recurAnchorDate,
  });
  if (!recurrence.ok) return recurrence;

  const orderResult = await nextTaskSortOrder(
    supabase,
    project.data.user_id,
    project.data.id,
  );
  if (!orderResult.ok) return orderResult;

  const completedAt = status.data === "done" ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: project.data.user_id,
      project_id: project.data.id,
      title: title.data,
      description: normalizeOptionalText(input.description),
      due_date: dueDate.data,
      status: status.data,
      sort_order: orderResult.data,
      completed_at: completedAt,
      recur_unit: recurrence.data.recurUnit,
      recur_interval: recurrence.data.recurInterval,
      recur_anchor_date: recurrence.data.recurAnchorDate,
    })
    .select("id")
    .single();

  if (error) return fail(`Unable to create task: ${error.message}`);

  const taskId = (data as { id: string }).id;
  await logProjectEvent({
    supabase,
    projectId: project.data.id,
    taskId,
    kind: "task.created",
    payload: { title: title.data, projectId: project.data.id },
  });

  return ok({ id: taskId, projectId: project.data.id });
}

export async function updateTask(
  supabase: SupabaseClient,
  input: UpdateTaskInput,
): Promise<MutationResult<{ id: string; projectId: string }>> {
  const id = requireUuid(input.id, "task id");
  if (!id.ok) return id;

  const owner = await getTaskForUser(supabase, id.data);
  if (!owner.ok) return owner;

  const patch: Record<string, unknown> = {};
  const changedFields: string[] = [];
  if ("title" in input.fields) {
    const title = requireName(input.fields.title ?? "", "task title");
    if (!title.ok) return title;
    patch.title = title.data;
    changedFields.push("title");
  }

  if ("description" in input.fields) {
    patch.description = normalizeOptionalText(input.fields.description);
    changedFields.push("description");
  }

  if ("dueDate" in input.fields) {
    const dueDate = normalizeDate(input.fields.dueDate, "due date");
    if (!dueDate.ok) return dueDate;
    patch.due_date = dueDate.data;
    changedFields.push("dueDate");
  }

  if ("status" in input.fields && input.fields.status !== undefined) {
    const status = requireTaskStatus(input.fields.status);
    if (!status.ok) return status;
    patch.status = status.data;
    patch.completed_at =
      status.data === "done" ? new Date().toISOString() : null;
    changedFields.push("status");
  }

  if ("sortOrder" in input.fields && input.fields.sortOrder !== undefined) {
    const sortOrder = requireInteger(input.fields.sortOrder, "sortOrder");
    if (!sortOrder.ok) return sortOrder;
    patch.sort_order = sortOrder.data;
    changedFields.push("sortOrder");
  }

  const hasRecurrenceChange =
    "recurUnit" in input.fields ||
    "recurInterval" in input.fields ||
    "recurAnchorDate" in input.fields;
  if (hasRecurrenceChange) {
    const recurrence = normalizeRecurrence({
      recurUnit:
        "recurUnit" in input.fields
          ? input.fields.recurUnit
          : owner.data.recur_unit,
      recurInterval:
        "recurInterval" in input.fields
          ? input.fields.recurInterval
          : owner.data.recur_interval,
      recurAnchorDate:
        "recurAnchorDate" in input.fields
          ? input.fields.recurAnchorDate
          : owner.data.recur_anchor_date,
    });
    if (!recurrence.ok) return recurrence;

    patch.recur_unit = recurrence.data.recurUnit;
    patch.recur_interval = recurrence.data.recurInterval;
    patch.recur_anchor_date = recurrence.data.recurAnchorDate;
    changedFields.push("recurrence");
  }

  if (Object.keys(patch).length === 0) {
    return ok({ id: owner.data.id, projectId: owner.data.project_id });
  }

  const { error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", owner.data.id);

  if (error) return fail(`Unable to update task: ${error.message}`);

  await logProjectEvent({
    supabase,
    projectId: owner.data.project_id,
    taskId: owner.data.id,
    kind: "task.updated",
    payload: { changedFields },
  });

  return ok({ id: owner.data.id, projectId: owner.data.project_id });
}

export async function completeTask(
  supabase: SupabaseClient,
  input: { id: string },
): Promise<MutationResult<{ id: string; projectId: string }>> {
  const id = requireUuid(input.id, "task id");
  if (!id.ok) return id;

  const owner = await getTaskForUser(supabase, id.data);
  if (!owner.ok) return owner;

  const { error } = await supabase
    .from("tasks")
    .update({ status: "done" satisfies TaskStatus, completed_at: new Date().toISOString() })
    .eq("id", owner.data.id);

  if (error) return fail(`Unable to complete task: ${error.message}`);

  await logProjectEvent({
    supabase,
    projectId: owner.data.project_id,
    taskId: owner.data.id,
    kind: "task.completed",
    payload: { previousStatus: owner.data.status, title: owner.data.title },
  });

  const recurringTask = await createNextRecurringTask(supabase, owner.data);
  if (!recurringTask.ok) return recurringTask;

  return ok({ id: owner.data.id, projectId: owner.data.project_id });
}

export async function deleteTask(
  supabase: SupabaseClient,
  input: { id: string },
): Promise<MutationResult<{ id: string; projectId: string }>> {
  const id = requireUuid(input.id, "task id");
  if (!id.ok) return id;

  const owner = await getTaskForUser(supabase, id.data);
  if (!owner.ok) return owner;

  const { error } = await supabase.from("tasks").delete().eq("id", owner.data.id);

  if (error) return fail(`Unable to delete task: ${error.message}`);

  await logProjectEvent({
    supabase,
    projectId: owner.data.project_id,
    taskId: owner.data.id,
    kind: "task.deleted",
    payload: { title: owner.data.title, projectId: owner.data.project_id },
  });

  return ok({ id: owner.data.id, projectId: owner.data.project_id });
}

export async function reorderProjects(
  supabase: SupabaseClient,
  input: { orderedIds: string[] },
): Promise<MutationResult<{ ids: string[] }>> {
  const userResult = await getAuthedUserId(supabase);
  if (!userResult.ok) return userResult;

  const ids = normalizeOrderedIds(input.orderedIds, "project id");
  if (!ids.ok) return ids;

  if (ids.data.length === 0) {
    return ok({ ids: [] });
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id,user_id,name")
    .in("id", ids.data);

  if (error) return fail(`Unable to validate project order: ${error.message}`);

  const rows = (data ?? []) as ProjectOwnershipRow[];
  if (
    rows.length !== ids.data.length ||
    rows.some((row) => row.user_id !== userResult.data)
  ) {
    return fail("Project order contains an unavailable project.");
  }

  const updates = ids.data.map((id, index) =>
    supabase
      .from("projects")
      .update({ sort_order: (index + 1) * 10 })
      .eq("id", id),
  );
  const results = await Promise.all(updates);
  const failed = results.find((result) => result.error);
  if (failed?.error) return fail(`Unable to reorder projects: ${failed.error.message}`);

  // project_events.project_id is required, so there is no natural single row
  // for a cross-project reorder in v0. We skip this low-signal event until the
  // activity model has a project-list scoped target.
  return ok({ ids: ids.data });
}

export async function reorderTasks(
  supabase: SupabaseClient,
  input: { projectId: string; orderedIds: string[] },
): Promise<MutationResult<{ ids: string[] }>> {
  const projectId = requireUuid(input.projectId, "project id");
  if (!projectId.ok) return projectId;

  const project = await getProjectForUser(supabase, projectId.data);
  if (!project.ok) return project;

  const ids = normalizeOrderedIds(input.orderedIds, "task id");
  if (!ids.ok) return ids;

  if (ids.data.length === 0) {
    return ok({ ids: [] });
  }

  const { data, error } = await supabase
    .from("tasks")
    .select("id,user_id,project_id,title")
    .in("id", ids.data);

  if (error) return fail(`Unable to validate task order: ${error.message}`);

  const rows = (data ?? []) as TaskOwnershipRow[];
  if (
    rows.length !== ids.data.length ||
    rows.some(
      (row) =>
        row.user_id !== project.data.user_id || row.project_id !== project.data.id,
    )
  ) {
    return fail("Task order contains an unavailable task.");
  }

  const updates = ids.data.map((id, index) =>
    supabase
      .from("tasks")
      .update({ sort_order: (index + 1) * 10 })
      .eq("id", id),
  );
  const results = await Promise.all(updates);
  const failed = results.find((result) => result.error);
  if (failed?.error) return fail(`Unable to reorder tasks: ${failed.error.message}`);

  await logProjectEvent({
    supabase,
    projectId: project.data.id,
    kind: "tasks.reordered",
    payload: { projectId: project.data.id, orderedIds: ids.data },
  });

  return ok({ ids: ids.data });
}

export async function createTag(
  supabase: SupabaseClient,
  input: { name: string; color?: string | null },
): Promise<MutationResult<{ id: string }>> {
  const userResult = await getAuthedUserId(supabase);
  if (!userResult.ok) return userResult;

  const name = requireName(input.name, "tag name");
  if (!name.ok) return name;

  const color = input.color ? requireColor(input.color) : ok("#94a3b8");
  if (!color.ok) return color;

  const orderResult = await nextTagSortOrder(supabase, userResult.data);
  if (!orderResult.ok) return orderResult;

  const { data, error } = await supabase
    .from("tags")
    .insert({
      user_id: userResult.data,
      name: name.data,
      color: color.data,
      sort_order: orderResult.data,
    })
    .select("id")
    .single();

  if (error) return fail(`Unable to create tag: ${error.message}`);

  return ok({ id: (data as { id: string }).id });
}

export async function updateTag(
  supabase: SupabaseClient,
  input: { id: string; name?: string; color?: string },
): Promise<MutationResult<{ id: string }>> {
  const tag = await getTagForUser(supabase, input.id);
  if (!tag.ok) return tag;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) {
    const name = requireName(input.name, "tag name");
    if (!name.ok) return name;
    patch.name = name.data;
  }

  if (input.color !== undefined) {
    const color = requireColor(input.color);
    if (!color.ok) return color;
    patch.color = color.data;
  }

  const { error } = await supabase
    .from("tags")
    .update(patch)
    .eq("id", tag.data.id);

  if (error) return fail(`Unable to update tag: ${error.message}`);

  return ok({ id: tag.data.id });
}

export async function archiveTag(
  supabase: SupabaseClient,
  input: { id: string },
): Promise<MutationResult<{ id: string }>> {
  const tag = await getTagForUser(supabase, input.id);
  if (!tag.ok) return tag;

  const { error } = await supabase
    .from("tags")
    .update({
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", tag.data.id);

  if (error) return fail(`Unable to archive tag: ${error.message}`);

  return ok({ id: tag.data.id });
}

export async function addTagToTask(
  supabase: SupabaseClient,
  input: { taskId: string; tagId: string },
): Promise<MutationResult<{ taskId: string; projectId: string; tagId: string }>> {
  const task = await getTaskForUser(supabase, input.taskId);
  if (!task.ok) return task;

  const tag = await getTagForUser(supabase, input.tagId);
  if (!tag.ok) return tag;

  if (tag.data.user_id !== task.data.user_id) {
    return fail("Tag does not belong to the task owner.");
  }

  const { error } = await supabase.from("task_tags").upsert(
    {
      task_id: task.data.id,
      tag_id: tag.data.id,
      user_id: task.data.user_id,
    },
    { onConflict: "task_id,tag_id" },
  );

  if (error) return fail(`Unable to add tag to task: ${error.message}`);

  return ok({
    taskId: task.data.id,
    projectId: task.data.project_id,
    tagId: tag.data.id,
  });
}

export async function removeTagFromTask(
  supabase: SupabaseClient,
  input: { taskId: string; tagId: string },
): Promise<MutationResult<{ taskId: string; projectId: string; tagId: string }>> {
  const task = await getTaskForUser(supabase, input.taskId);
  if (!task.ok) return task;

  const tagId = requireUuid(input.tagId, "tag id");
  if (!tagId.ok) return tagId;

  const { error } = await supabase
    .from("task_tags")
    .delete()
    .eq("task_id", task.data.id)
    .eq("tag_id", tagId.data)
    .eq("user_id", task.data.user_id);

  if (error) return fail(`Unable to remove tag from task: ${error.message}`);

  return ok({
    taskId: task.data.id,
    projectId: task.data.project_id,
    tagId: tagId.data,
  });
}

export async function reorderTags(
  supabase: SupabaseClient,
  input: { orderedIds: string[] },
): Promise<MutationResult<{ ids: string[] }>> {
  const userResult = await getAuthedUserId(supabase);
  if (!userResult.ok) return userResult;

  const ids = normalizeOrderedIds(input.orderedIds, "tag id");
  if (!ids.ok) return ids;

  if (ids.data.length === 0) {
    return ok({ ids: [] });
  }

  const { data, error } = await supabase
    .from("tags")
    .select("id,user_id,name,color")
    .in("id", ids.data);

  if (error) return fail(`Unable to validate tag order: ${error.message}`);

  const rows = (data ?? []) as TagOwnershipRow[];
  if (
    rows.length !== ids.data.length ||
    rows.some((row) => row.user_id !== userResult.data)
  ) {
    return fail("Tag order contains an unavailable tag.");
  }

  const updates = ids.data.map((id, index) =>
    supabase
      .from("tags")
      .update({ sort_order: (index + 1) * 10, updated_at: new Date().toISOString() })
      .eq("id", id),
  );
  const results = await Promise.all(updates);
  const failed = results.find((result) => result.error);
  if (failed?.error) return fail(`Unable to reorder tags: ${failed.error.message}`);

  return ok({ ids: ids.data });
}

export async function getProjectForUser(
  supabase: SupabaseClient,
  projectId: string,
): Promise<MutationResult<ProjectOwnershipRow>> {
  const userResult = await getAuthedUserId(supabase);
  if (!userResult.ok) return userResult;

  const { data, error } = await supabase
    .from("projects")
    .select("id,user_id,name")
    .eq("id", projectId)
    .maybeSingle();

  if (error) return fail(`Unable to validate project: ${error.message}`);
  if (!data) return fail("Project not found.");

  const row = data as ProjectOwnershipRow;
  if (row.user_id !== userResult.data) {
    return fail("Project does not belong to the current user.");
  }

  return ok(row);
}

export async function getTaskForUser(
  supabase: SupabaseClient,
  taskId: string,
): Promise<MutationResult<TaskOwnershipRow>> {
  const userResult = await getAuthedUserId(supabase);
  if (!userResult.ok) return userResult;

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id,user_id,project_id,title,description,due_date,status,sort_order,recur_unit,recur_interval,recur_anchor_date",
    )
    .eq("id", taskId)
    .maybeSingle();

  if (error) return fail(`Unable to validate task: ${error.message}`);
  if (!data) return fail("Task not found.");

  const row = data as TaskOwnershipRow;
  if (row.user_id !== userResult.data) {
    return fail("Task does not belong to the current user.");
  }

  return ok(row);
}

export async function getTagForUser(
  supabase: SupabaseClient,
  tagId: string,
): Promise<MutationResult<TagOwnershipRow>> {
  const id = requireUuid(tagId, "tag id");
  if (!id.ok) return id;

  const userResult = await getAuthedUserId(supabase);
  if (!userResult.ok) return userResult;

  const { data, error } = await supabase
    .from("tags")
    .select("id,user_id,name,color")
    .eq("id", id.data)
    .maybeSingle();

  if (error) return fail(`Unable to validate tag: ${error.message}`);
  if (!data) return fail("Tag not found.");

  const row = data as TagOwnershipRow;
  if (row.user_id !== userResult.data) {
    return fail("Tag does not belong to the current user.");
  }

  return ok(row);
}

function ok<T>(data: T): MutationResult<T> {
  return { ok: true, data, error: null };
}

function fail<T = never>(error: string): MutationResult<T> {
  return { ok: false, data: null, error };
}

async function getAuthedUserId(
  supabase: SupabaseClient,
): Promise<MutationResult<string>> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return fail(error?.message ?? "User is not authenticated.");
  }

  return ok(user.id);
}

async function nextProjectSortOrder(
  supabase: SupabaseClient,
  userId: string,
): Promise<MutationResult<number>> {
  const { data, error } = await supabase
    .from("projects")
    .select("sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return fail(`Unable to prepare project order: ${error.message}`);

  return ok((((data as SortRow | null)?.sort_order ?? 0) + 10));
}

async function nextTaskSortOrder(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<MutationResult<number>> {
  const { data, error } = await supabase
    .from("tasks")
    .select("sort_order")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return fail(`Unable to prepare task order: ${error.message}`);

  return ok((((data as SortRow | null)?.sort_order ?? 0) + 10));
}

async function nextTagSortOrder(
  supabase: SupabaseClient,
  userId: string,
): Promise<MutationResult<number>> {
  const { data, error } = await supabase
    .from("tags")
    .select("sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return fail(`Unable to prepare tag order: ${error.message}`);

  return ok((((data as SortRow | null)?.sort_order ?? 0) + 10));
}

async function createNextRecurringTask(
  supabase: SupabaseClient,
  task: TaskOwnershipRow,
): Promise<MutationResult<null>> {
  if (!task.recur_unit || !task.recur_interval) {
    return ok(null);
  }

  const anchorDate = task.recur_anchor_date ?? task.due_date;
  if (!anchorDate) {
    return ok(null);
  }

  const nextDueDate = addDateInterval(
    anchorDate,
    task.recur_interval,
    task.recur_unit,
  );
  const orderResult = await nextTaskSortOrder(
    supabase,
    task.user_id,
    task.project_id,
  );
  if (!orderResult.ok) return orderResult;

  const { data: existingTags, error: existingTagsError } = await supabase
    .from("task_tags")
    .select("tag_id")
    .eq("user_id", task.user_id)
    .eq("task_id", task.id);

  if (existingTagsError) {
    return fail(`Unable to copy recurring task tags: ${existingTagsError.message}`);
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: task.user_id,
      project_id: task.project_id,
      title: task.title,
      description: task.description,
      due_date: nextDueDate,
      status: "todo" satisfies TaskStatus,
      sort_order: orderResult.data,
      completed_at: null,
      recur_unit: task.recur_unit,
      recur_interval: task.recur_interval,
      recur_anchor_date: nextDueDate,
    })
    .select("id")
    .single();

  if (error) return fail(`Unable to create next recurring task: ${error.message}`);

  const newTaskId = (data as { id: string }).id;
  const tagRows = ((existingTags ?? []) as { tag_id: string }[]).map((row) => ({
    task_id: newTaskId,
    tag_id: row.tag_id,
    user_id: task.user_id,
  }));

  if (tagRows.length > 0) {
    const { error: tagCopyError } = await supabase.from("task_tags").insert(tagRows);
    if (tagCopyError) {
      return fail(`Unable to copy recurring task tags: ${tagCopyError.message}`);
    }
  }

  await logProjectEvent({
    supabase,
    projectId: task.project_id,
    taskId: newTaskId,
    kind: "task.created",
    payload: { title: task.title, projectId: task.project_id, recurringFrom: task.id },
  });

  return ok(null);
}

function requireName(value: string, fieldName: string): MutationResult<string> {
  const trimmed = value.trim();
  if (!trimmed) {
    return fail(`Invalid ${fieldName}.`);
  }

  if (trimmed.length > 160) {
    return fail(`${fieldName} is too long.`);
  }

  return ok(trimmed);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2000) : null;
}

function normalizeDate(
  value: string | null | undefined,
  fieldName: string,
): MutationResult<string | null> {
  if (!value) {
    return ok(null);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fail(`Invalid ${fieldName}.`);
  }

  return ok(value);
}

function requireColor(value: string): MutationResult<string> {
  const trimmed = value.trim();
  if (!/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return fail("Invalid project color.");
  }

  return ok(trimmed);
}

function requireTaskStatus(value: string): MutationResult<TaskStatus> {
  if (value === "todo" || value === "in_progress" || value === "done") {
    return ok(value);
  }

  return fail("Invalid task status.");
}

function requireRecurUnit(value: string): MutationResult<RecurUnit> {
  if (
    value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "year"
  ) {
    return ok(value);
  }

  return fail("Invalid recurrence unit.");
}

function normalizeRecurrence(input: {
  recurUnit?: RecurUnit | null;
  recurInterval?: number | null;
  recurAnchorDate?: string | null;
}): MutationResult<{
  recurUnit: RecurUnit | null;
  recurInterval: number | null;
  recurAnchorDate: string | null;
}> {
  const hasAny =
    input.recurUnit !== undefined ||
    input.recurInterval !== undefined ||
    input.recurAnchorDate !== undefined;

  if (!hasAny) {
    return ok({ recurUnit: null, recurInterval: null, recurAnchorDate: null });
  }

  if (!input.recurUnit && !input.recurInterval && !input.recurAnchorDate) {
    return ok({ recurUnit: null, recurInterval: null, recurAnchorDate: null });
  }

  const recurUnit = input.recurUnit
    ? requireRecurUnit(input.recurUnit)
    : ok(null);
  if (!recurUnit.ok) return recurUnit;

  const recurInterval =
    input.recurInterval === null || input.recurInterval === undefined
      ? ok(null)
      : requirePositiveInteger(input.recurInterval, "recurInterval");
  if (!recurInterval.ok) return recurInterval;

  const recurAnchorDate = normalizeDate(
    input.recurAnchorDate,
    "recurrence anchor date",
  );
  if (!recurAnchorDate.ok) return recurAnchorDate;

  return ok({
    recurUnit: recurUnit.data,
    recurInterval: recurInterval.data,
    recurAnchorDate: recurAnchorDate.data,
  });
}

function requireUuid(value: string, fieldName: string): MutationResult<string> {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(value)) {
    return fail(`Invalid ${fieldName}.`);
  }

  return ok(value);
}

function requireInteger(value: number, fieldName: string): MutationResult<number> {
  if (!Number.isInteger(value)) {
    return fail(`Invalid ${fieldName}.`);
  }

  return ok(value);
}

function requirePositiveInteger(
  value: number,
  fieldName: string,
): MutationResult<number> {
  const integer = requireInteger(value, fieldName);
  if (!integer.ok) return integer;

  if (integer.data <= 0) {
    return fail(`Invalid ${fieldName}.`);
  }

  return integer;
}

function addDateInterval(
  isoDate: string,
  interval: number,
  unit: RecurUnit,
): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);

  if (unit === "day") {
    date.setUTCDate(date.getUTCDate() + interval);
  } else if (unit === "week") {
    date.setUTCDate(date.getUTCDate() + interval * 7);
  } else if (unit === "month") {
    date.setUTCMonth(date.getUTCMonth() + interval);
  } else {
    date.setUTCFullYear(date.getUTCFullYear() + interval);
  }

  return date.toISOString().slice(0, 10);
}

function normalizeOrderedIds(
  values: string[],
  fieldName: string,
): MutationResult<string[]> {
  if (!Array.isArray(values)) {
    return fail("Invalid ordered ids.");
  }

  const ids: string[] = [];
  for (const value of values) {
    const id = requireUuid(value, fieldName);
    if (!id.ok) return id;
    ids.push(id.data);
  }

  if (new Set(ids).size !== ids.length) {
    return fail("Ordered ids contain duplicates.");
  }

  return ok(ids);
}
