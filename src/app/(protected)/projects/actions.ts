"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  addTagToTask,
  archiveProject,
  archiveTag,
  completeTask,
  createProject,
  createInboxTask,
  createTag,
  createTask,
  deleteProject,
  deleteTask,
  getProjectForUser,
  reorderProjects,
  reorderTasks,
  reorderTags,
  removeTagFromTask,
  moveTaskToProject,
  saveWeeklyReflection,
  updateTag,
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

  revalidateProjectPaths();
  return { ok: true, id: result.data.id };
}

export async function updateProjectAction(input: {
  id: string;
  fields: UpdateProjectFields;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await updateProject(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths(input.id);
  return { ok: true };
}

export async function archiveProjectAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await archiveProject(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths(input.id);
  return { ok: true };
}

export async function deleteProjectAction(input: {
  id: string;
  confirmationText: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const project = await getProjectForUser(supabase, input.id);
  if (!project.ok) throw new Error(project.error);
  if (input.confirmationText !== project.data.name) {
    throw new Error("Confirmation must match the current project name exactly.");
  }

  const result = await deleteProject(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths(input.id);
  return { ok: true };
}

export async function createTaskAction(
  input: CreateTaskInput,
): Promise<{ ok: true; id: string }> {
  const { supabase } = await requireUser();
  const result = await createTask(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths(result.data.projectId);
  return { ok: true, id: result.data.id };
}

export async function updateTaskAction(input: {
  id: string;
  fields: UpdateTaskFields;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await updateTask(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths(result.data.projectId);
  return { ok: true };
}

export async function completeTaskAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await completeTask(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths(result.data.projectId);
  return { ok: true };
}

export async function deleteTaskAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await deleteTask(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths(result.data.projectId);
  return { ok: true };
}

export async function reorderProjectsAction(input: {
  orderedIds: string[];
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await reorderProjects(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths();
  return { ok: true };
}

export async function reorderTasksAction(input: {
  projectId: string;
  orderedIds: string[];
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await reorderTasks(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths(input.projectId);
  return { ok: true };
}

export async function createTagAction(input: {
  name: string;
  color?: string | null;
}): Promise<{ ok: true; id: string }> {
  const { supabase } = await requireUser();
  const result = await createTag(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths();
  return { ok: true, id: result.data.id };
}

export async function updateTagAction(input: {
  id: string;
  name?: string;
  color?: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await updateTag(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths();
  return { ok: true };
}

export async function archiveTagAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await archiveTag(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths();
  return { ok: true };
}

export async function addTagToTaskAction(input: {
  taskId: string;
  tagId: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await addTagToTask(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths(result.data.projectId);
  return { ok: true };
}

export async function removeTagFromTaskAction(input: {
  taskId: string;
  tagId: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await removeTagFromTask(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths(result.data.projectId);
  return { ok: true };
}

export async function reorderTagsAction(input: {
  orderedIds: string[];
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await reorderTags(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths();
  return { ok: true };
}

export async function createInboxTaskAction(input: {
  title: string;
  description?: string | null;
}): Promise<{ ok: true; id: string }> {
  const { supabase } = await requireUser();
  const result = await createInboxTask(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths();
  return { ok: true, id: result.data.id };
}

export async function moveTaskToProjectAction(input: {
  taskId: string;
  projectId: string;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await moveTaskToProject(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths(result.data.projectId);
  return { ok: true };
}

export async function saveWeeklyReflectionAction(input: {
  weekStart: string;
  shipped?: string | null;
  stuck?: string | null;
  nextWeek?: string | null;
}): Promise<{ ok: true }> {
  const { supabase } = await requireUser();
  const result = await saveWeeklyReflection(supabase, input);
  if (!result.ok) throw new Error(result.error);

  revalidateProjectPaths();
  return { ok: true };
}

function revalidateProjectPaths(projectId?: string) {
  revalidatePath("/projects");

  if (projectId) {
    revalidatePath(`/projects/${projectId}`);
  }
}
