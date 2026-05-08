import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";

export const READ_ONLY_PROJECTS_TOOLS: Tool[] = [
  {
    name: "list_projects",
    description: "List the user's projects with status, deadline, and progress.",
    input_schema: objectSchema({}),
  },
  {
    name: "list_tasks",
    description: "List the user's tasks, optionally filtered by project, status, or due date.",
    input_schema: objectSchema({
      project_id: stringProperty("Project id to filter by."),
      status: {
        type: "string",
        enum: ["todo", "in_progress", "done"],
        description: "Task status to filter by.",
      },
      due_date_on_or_before: stringProperty("YYYY-MM-DD due date ceiling."),
    }),
  },
];

type ReadOnlyProjectsToolOptions = {
  includeInbox?: boolean;
};

export async function runReadOnlyProjectsTool(
  supabase: SupabaseClient,
  name: string,
  input: unknown,
  options: ReadOnlyProjectsToolOptions = {},
): Promise<{ ok: boolean; data: unknown }> {
  try {
    const toolInput = asRecord(input);

    if (name === "list_projects") {
      return toolOk(await listProjects(supabase, options));
    }

    if (name === "list_tasks") {
      return toolOk(await listTasks(supabase, toolInput, options));
    }

    return toolError(`Unknown tool: ${name}`);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : "Tool failed.");
  }
}

export async function listProjects(
  supabase: SupabaseClient,
  options: ReadOnlyProjectsToolOptions = {},
) {
  const userId = await getAuthedUserId(supabase);
  let query = supabase
    .from("projects")
    .select("id,name,description,color,status,sort_order,deadline,is_inbox")
    .eq("user_id", userId);

  if (!options.includeInbox) {
    query = query.eq("is_inbox", false);
  }

  const { data, error } = await query.order("sort_order");

  if (error) {
    throw new Error(`Unable to list projects: ${error.message}`);
  }

  return data ?? [];
}

export async function listTasks(
  supabase: SupabaseClient,
  input: Record<string, unknown>,
  options: ReadOnlyProjectsToolOptions = {},
) {
  const userId = await getAuthedUserId(supabase);
  let query = supabase
    .from("tasks")
    .select(
      "id,project_id,title,description,due_date,status,sort_order,completed_at,projects!inner(name,is_inbox)",
    )
    .eq("user_id", userId)
    .order("sort_order");

  if (!options.includeInbox) {
    query = query.eq("projects.is_inbox", false);
  }

  const projectId = optionalString(input.project_id);
  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const status = optionalTaskStatus(input.status);
  if (status) {
    query = query.eq("status", status);
  }

  const dueDate = optionalString(input.due_date_on_or_before);
  if (dueDate) {
    query = query.lte("due_date", dueDate);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Unable to list tasks: ${error.message}`);
  }

  return data ?? [];
}

async function getAuthedUserId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error(error?.message ?? "User is not authenticated.");
  }

  return user.id;
}

function toolOk(data: unknown) {
  return { ok: true, data: { ok: true, data } };
}

function toolError(error: string) {
  return { ok: false, data: { ok: false, error } };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalTaskStatus(value: unknown) {
  if (value === "todo" || value === "in_progress" || value === "done") {
    return value;
  }

  return undefined;
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Tool.InputSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function stringProperty(description: string) {
  return { type: "string", description };
}
