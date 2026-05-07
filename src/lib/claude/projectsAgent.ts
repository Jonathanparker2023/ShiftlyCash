import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ContentBlock,
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
  Usage,
} from "@anthropic-ai/sdk/resources/messages/messages";

import {
  archiveProject,
  completeTask,
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  getProjectForUser,
  getTaskForUser,
  updateProject,
  updateTask,
} from "@/lib/projects/mutations";
import type { TaskStatus } from "@/lib/projects/types";

const MODEL = "claude-opus-4-7";
const MAX_TOOL_ROUNDS = 5;
const MAX_TOKENS = 900;

type ProjectsAgentInput = {
  messages: MessageParam[];
  supabase: SupabaseClient;
};

export type ProjectsAgentUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type ProjectsAgentToolCall = {
  name: string;
  input: unknown;
  result: unknown;
};

export type ProjectsAgentResult = {
  reply: string;
  toolCalls: ProjectsAgentToolCall[];
  usage: ProjectsAgentUsage;
};

let anthropicClient: Anthropic | null = null;

export async function runProjectsAgent({
  messages,
  supabase,
}: ProjectsAgentInput): Promise<ProjectsAgentResult> {
  const client = getAnthropicClient();
  const conversation: MessageParam[] = [...messages];
  const toolCalls: ProjectsAgentToolCall[] = [];
  const usage = emptyUsage();
  let toolRounds = 0;

  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: conversation,
      tools: PROJECT_TOOLS,
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    });
    addUsage(usage, response.usage);

    const toolUses = response.content.filter(isToolUseBlock);
    if (toolUses.length === 0) {
      return {
        reply: extractText(response.content) || "Done.",
        toolCalls,
        usage,
      };
    }

    if (toolRounds >= MAX_TOOL_ROUNDS) {
      return {
        reply: "I can't fit more project changes in this turn. Send the next step and I will continue.",
        toolCalls,
        usage,
      };
    }

    const toolResults: ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const result = await runTool(supabase, toolUse.name, toolUse.input);
      toolCalls.push({ name: toolUse.name, input: toolUse.input, result: result.data });
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result.data),
        is_error: !result.ok,
      });
    }

    conversation.push({
      role: "assistant",
      content: response.content as MessageParam["content"],
    });
    conversation.push({ role: "user", content: toolResults });
    toolRounds += 1;
  }
}

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY.");
  }

  anthropicClient ??= new Anthropic({ apiKey });
  return anthropicClient;
}

const SYSTEM_PROMPT = `You manage one authenticated user's ShiftlyCash projects and tasks.

Use the supplied tools for project and task data. Keep replies short, concrete, and action-oriented.

Before archive_project, delete_project, or delete_task, ask the user to confirm by typing the exact current project name or task title. Only call the destructive tool after the user has supplied those exact words, and pass those words as confirmation_text. If a destructive tool rejects confirmation_text, apologize briefly and ask for the exact confirmation again.

Do not expose internal IDs unless they are needed to resolve ambiguity. If several records could match, ask one clarifying question.`;

const PROJECT_TOOLS: Tool[] = [
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
  {
    name: "create_project",
    description: "Create a project.",
    input_schema: objectSchema(
      {
        name: stringProperty("Project name."),
        description: stringProperty("Optional project description."),
        deadline: stringProperty("Optional YYYY-MM-DD project deadline."),
      },
      ["name"],
    ),
  },
  {
    name: "update_project",
    description: "Update editable project fields.",
    input_schema: objectSchema(
      {
        id: stringProperty("Project id."),
        name: stringProperty("New project name."),
        description: stringProperty("New project description, or empty to clear."),
        deadline: stringProperty("New YYYY-MM-DD deadline, or empty to clear."),
      },
      ["id"],
    ),
  },
  {
    name: "archive_project",
    description: "Archive a project after exact-name confirmation.",
    input_schema: objectSchema(
      {
        id: stringProperty("Project id."),
        confirmation_text: stringProperty("Exact current project name typed by the user."),
      },
      ["id", "confirmation_text"],
    ),
  },
  {
    name: "delete_project",
    description: "Delete a project and its tasks after exact-name confirmation.",
    input_schema: objectSchema(
      {
        id: stringProperty("Project id."),
        confirmation_text: stringProperty("Exact current project name typed by the user."),
      },
      ["id", "confirmation_text"],
    ),
  },
  {
    name: "create_task",
    description: "Create a task inside a project.",
    input_schema: objectSchema(
      {
        project_id: stringProperty("Project id."),
        title: stringProperty("Task title."),
        description: stringProperty("Optional task description."),
        due_date: stringProperty("Optional YYYY-MM-DD due date."),
        status: {
          type: "string",
          enum: ["todo", "in_progress", "done"],
          description: "Optional starting status.",
        },
      },
      ["project_id", "title"],
    ),
  },
  {
    name: "update_task",
    description: "Update editable task fields.",
    input_schema: objectSchema(
      {
        id: stringProperty("Task id."),
        title: stringProperty("New task title."),
        description: stringProperty("New task description, or empty to clear."),
        due_date: stringProperty("New YYYY-MM-DD due date, or empty to clear."),
        status: {
          type: "string",
          enum: ["todo", "in_progress", "done"],
          description: "New task status.",
        },
      },
      ["id"],
    ),
  },
  {
    name: "complete_task",
    description: "Mark a task done.",
    input_schema: objectSchema({ id: stringProperty("Task id.") }, ["id"]),
  },
  {
    name: "delete_task",
    description: "Delete a task after exact-title confirmation.",
    input_schema: objectSchema(
      {
        id: stringProperty("Task id."),
        confirmation_text: stringProperty("Exact current task title typed by the user."),
      },
      ["id", "confirmation_text"],
    ),
  },
];

async function runTool(
  supabase: SupabaseClient,
  name: string,
  input: unknown,
): Promise<{ ok: boolean; data: unknown }> {
  try {
    const toolInput = asRecord(input);

    if (name === "list_projects") {
      return toolOk(await listProjects(supabase));
    }

    if (name === "list_tasks") {
      return toolOk(await listTasks(supabase, toolInput));
    }

    if (name === "create_project") {
      const result = await createProject(supabase, {
        name: requireString(toolInput.name, "name"),
        description: optionalString(toolInput.description),
        deadline: optionalString(toolInput.deadline),
      });
      return mutationToolResult(result);
    }

    if (name === "update_project") {
      const result = await updateProject(supabase, {
        id: requireString(toolInput.id, "id"),
        fields: {
          name: optionalString(toolInput.name) ?? undefined,
          description: optionalString(toolInput.description),
          deadline: optionalString(toolInput.deadline),
        },
      });
      return mutationToolResult(result);
    }

    if (name === "archive_project") {
      const id = requireString(toolInput.id, "id");
      const project = await getProjectForUser(supabase, id);
      if (!project.ok) return toolError(project.error);
      const confirmation = requireString(toolInput.confirmation_text, "confirmation_text");
      if (confirmation !== project.data.name) {
        return toolError("Confirmation must match the current project name exactly.");
      }

      return mutationToolResult(await archiveProject(supabase, { id }));
    }

    if (name === "delete_project") {
      const id = requireString(toolInput.id, "id");
      const project = await getProjectForUser(supabase, id);
      if (!project.ok) return toolError(project.error);
      const confirmation = requireString(toolInput.confirmation_text, "confirmation_text");
      if (confirmation !== project.data.name) {
        return toolError("Confirmation must match the current project name exactly.");
      }

      return mutationToolResult(await deleteProject(supabase, { id }));
    }

    if (name === "create_task") {
      const result = await createTask(supabase, {
        projectId: requireString(toolInput.project_id, "project_id"),
        title: requireString(toolInput.title, "title"),
        description: optionalString(toolInput.description),
        dueDate: optionalString(toolInput.due_date),
        status: optionalTaskStatus(toolInput.status),
      });
      return mutationToolResult(result);
    }

    if (name === "update_task") {
      const result = await updateTask(supabase, {
        id: requireString(toolInput.id, "id"),
        fields: {
          title: optionalString(toolInput.title) ?? undefined,
          description: optionalString(toolInput.description),
          dueDate: optionalString(toolInput.due_date),
          status: optionalTaskStatus(toolInput.status),
        },
      });
      return mutationToolResult(result);
    }

    if (name === "complete_task") {
      return mutationToolResult(
        await completeTask(supabase, { id: requireString(toolInput.id, "id") }),
      );
    }

    if (name === "delete_task") {
      const id = requireString(toolInput.id, "id");
      const task = await getTaskForUser(supabase, id);
      if (!task.ok) return toolError(task.error);
      const confirmation = requireString(toolInput.confirmation_text, "confirmation_text");
      if (confirmation !== task.data.title) {
        return toolError("Confirmation must match the current task title exactly.");
      }

      return mutationToolResult(await deleteTask(supabase, { id }));
    }

    return toolError(`Unknown tool: ${name}`);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : "Tool failed.");
  }
}

async function listProjects(supabase: SupabaseClient) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error(userError?.message ?? "User is not authenticated.");
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id,name,description,color,status,sort_order,deadline")
    .eq("user_id", user.id)
    .order("sort_order");

  if (error) {
    throw new Error(`Unable to list projects: ${error.message}`);
  }

  return data ?? [];
}

async function listTasks(supabase: SupabaseClient, input: Record<string, unknown>) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error(userError?.message ?? "User is not authenticated.");
  }

  let query = supabase
    .from("tasks")
    .select("id,project_id,title,description,due_date,status,sort_order,completed_at")
    .eq("user_id", user.id)
    .order("sort_order");

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

function mutationToolResult<T>(
  result:
    | { ok: true; data: T; error: null }
    | { ok: false; data: null; error: string },
) {
  return result.ok ? toolOk(result.data) : toolError(result.error);
}

function toolOk(data: unknown) {
  return { ok: true, data: { ok: true, data } };
}

function toolError(error: string) {
  return { ok: false, data: { ok: false, error } };
}

function extractText(content: ContentBlock[]): string {
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use";
}

function emptyUsage(): ProjectsAgentUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

function addUsage(total: ProjectsAgentUsage, usage: Usage) {
  total.input_tokens += usage.input_tokens;
  total.output_tokens += usage.output_tokens;
  total.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
  total.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${fieldName}.`);
  }

  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalTaskStatus(value: unknown): TaskStatus | undefined {
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
