"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  archiveProject,
  completeTask,
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  reorderProjects,
  reorderTasks,
  updateProject,
  updateTask,
  type CreateProjectInput,
  type CreateTaskInput,
  type UpdateProjectFields,
  type UpdateTaskFields,
} from "@/lib/projects/mutations";

export async function createProjectAction(
  input: CreateProjectInput,
): Promise<{ ok: true; id: string }> {
  const { supabase } = await requireUser();
  const result = await createProject(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidatePath("/projects");
  return { ok: true, id: result.data.id };
}

export async function updateProjectAction(input: {
  id: string;
  fields: UpdateProjectFields;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await updateProject(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidatePath("/projects");
  return { ok: true };
}

export async function archiveProjectAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await archiveProject(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidatePath("/projects");
  return { ok: true };
}

export async function deleteProjectAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await deleteProject(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidatePath("/projects");
  return { ok: true };
}

export async function createTaskAction(
  input: CreateTaskInput,
): Promise<{ ok: true; id: string }> {
  const { supabase } = await requireUser();
  const result = await createTask(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidatePath("/projects");
  return { ok: true, id: result.data.id };
}

export async function updateTaskAction(input: {
  id: string;
  fields: UpdateTaskFields;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await updateTask(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidatePath("/projects");
  return { ok: true };
}

export async function completeTaskAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await completeTask(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidatePath("/projects");
  return { ok: true };
}

export async function deleteTaskAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await deleteTask(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidatePath("/projects");
  return { ok: true };
}

export async function reorderProjectsAction(input: {
  orderedIds: string[];
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await reorderProjects(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidatePath("/projects");
  return { ok: true };
}

export async function reorderTasksAction(input: {
  projectId: string;
  orderedIds: string[];
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await reorderTasks(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidatePath("/projects");
  return { ok: true };
}
