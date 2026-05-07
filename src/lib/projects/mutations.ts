import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProjectStatus, TaskStatus } from "@/lib/projects/types";

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
};

export type UpdateTaskFields = {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
  sortOrder?: number;
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

  return ok({ id: (data as { id: string }).id });
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
  if ("name" in input.fields) {
    const name = requireName(input.fields.name ?? "", "project name");
    if (!name.ok) return name;
    patch.name = name.data;
  }

  if ("description" in input.fields) {
    patch.description = normalizeOptionalText(input.fields.description);
  }

  if ("color" in input.fields && input.fields.color !== undefined) {
    const color = requireColor(input.fields.color);
    if (!color.ok) return color;
    patch.color = color.data;
  }

  if ("deadline" in input.fields) {
    const deadline = normalizeDate(input.fields.deadline, "deadline");
    if (!deadline.ok) return deadline;
    patch.deadline = deadline.data;
  }

  if ("sortOrder" in input.fields && input.fields.sortOrder !== undefined) {
    const sortOrder = requireInteger(input.fields.sortOrder, "sortOrder");
    if (!sortOrder.ok) return sortOrder;
    patch.sort_order = sortOrder.data;
  }

  if (Object.keys(patch).length === 0) {
    return ok({ id: owner.data.id });
  }

  const { error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", owner.data.id);

  if (error) return fail(`Unable to update project: ${error.message}`);

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

  return ok({ id: owner.data.id });
}

export async function createTask(
  supabase: SupabaseClient,
  input: CreateTaskInput,
): Promise<MutationResult<{ id: string }>> {
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
    })
    .select("id")
    .single();

  if (error) return fail(`Unable to create task: ${error.message}`);

  return ok({ id: (data as { id: string }).id });
}

export async function updateTask(
  supabase: SupabaseClient,
  input: UpdateTaskInput,
): Promise<MutationResult<{ id: string }>> {
  const id = requireUuid(input.id, "task id");
  if (!id.ok) return id;

  const owner = await getTaskForUser(supabase, id.data);
  if (!owner.ok) return owner;

  const patch: Record<string, unknown> = {};
  if ("title" in input.fields) {
    const title = requireName(input.fields.title ?? "", "task title");
    if (!title.ok) return title;
    patch.title = title.data;
  }

  if ("description" in input.fields) {
    patch.description = normalizeOptionalText(input.fields.description);
  }

  if ("dueDate" in input.fields) {
    const dueDate = normalizeDate(input.fields.dueDate, "due date");
    if (!dueDate.ok) return dueDate;
    patch.due_date = dueDate.data;
  }

  if ("status" in input.fields && input.fields.status !== undefined) {
    const status = requireTaskStatus(input.fields.status);
    if (!status.ok) return status;
    patch.status = status.data;
    patch.completed_at =
      status.data === "done" ? new Date().toISOString() : null;
  }

  if ("sortOrder" in input.fields && input.fields.sortOrder !== undefined) {
    const sortOrder = requireInteger(input.fields.sortOrder, "sortOrder");
    if (!sortOrder.ok) return sortOrder;
    patch.sort_order = sortOrder.data;
  }

  if (Object.keys(patch).length === 0) {
    return ok({ id: owner.data.id });
  }

  const { error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", owner.data.id);

  if (error) return fail(`Unable to update task: ${error.message}`);

  return ok({ id: owner.data.id });
}

export async function completeTask(
  supabase: SupabaseClient,
  input: { id: string },
): Promise<MutationResult<{ id: string }>> {
  const id = requireUuid(input.id, "task id");
  if (!id.ok) return id;

  const owner = await getTaskForUser(supabase, id.data);
  if (!owner.ok) return owner;

  const { error } = await supabase
    .from("tasks")
    .update({ status: "done" satisfies TaskStatus, completed_at: new Date().toISOString() })
    .eq("id", owner.data.id);

  if (error) return fail(`Unable to complete task: ${error.message}`);

  return ok({ id: owner.data.id });
}

export async function deleteTask(
  supabase: SupabaseClient,
  input: { id: string },
): Promise<MutationResult<{ id: string }>> {
  const id = requireUuid(input.id, "task id");
  if (!id.ok) return id;

  const owner = await getTaskForUser(supabase, id.data);
  if (!owner.ok) return owner;

  const { error } = await supabase.from("tasks").delete().eq("id", owner.data.id);

  if (error) return fail(`Unable to delete task: ${error.message}`);

  return ok({ id: owner.data.id });
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
    .select("id,user_id,project_id,title")
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
