import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ContentBlock,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
  Usage,
} from "@anthropic-ai/sdk/resources/messages/messages";

import {
  checkDailyCap,
  DailyCapExceededError,
  logUsage,
} from "@/lib/claude/usage";
import {
  READ_ONLY_PROJECTS_TOOLS,
  runReadOnlyProjectsTool,
} from "@/lib/claude/readOnlyProjectsTools";
import { getTodayIso } from "@/lib/dashboard/dates";

const MODEL = "claude-opus-4-7";
const MAX_TOOL_ROUNDS = 3;
const MAX_TOKENS = 420;

export const DAILY_BRIEF_SYSTEM_PROMPT =
  "You are summarizing one user's projects and tasks for today. Use the supplied tools to fetch their projects and any tasks due today or overdue. Return ONE short paragraph (~3-5 sentences) covering: how many tasks are due today, any that are past due, and a suggested focus given the project deadlines and progress. No preamble, no sign-off — just the paragraph. Plain text, no markdown.";

export type DailyBriefUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type DailyBriefResult = {
  reply: string;
  usage: DailyBriefUsage;
};

let anthropicClient: Anthropic | null = null;

export async function generateDailyBrief(
  supabase: SupabaseClient,
  userId?: string,
): Promise<DailyBriefResult> {
  const resolvedUserId = userId ?? (await getAuthedUserId(supabase));
  const client = getAnthropicClient();
  const conversation: MessageParam[] = [
    {
      role: "user",
      content: `Generate today's project brief for ${getTodayIso()}.`,
    },
  ];
  const usage = emptyUsage();

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const cap = await checkDailyCap(supabase, resolvedUserId);
    if (!cap.allowed) {
      throw new DailyCapExceededError(cap);
    }

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "disabled" },
      system: DAILY_BRIEF_SYSTEM_PROMPT,
      messages: conversation,
      tools: READ_ONLY_PROJECTS_TOOLS,
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    });
    await logUsage(supabase, resolvedUserId, response.id, MODEL, response.usage);
    addUsage(usage, response.usage);

    const toolUses = response.content.filter(isToolUseBlock);
    if (toolUses.length === 0) {
      return {
        reply: extractText(response.content) || "No project brief available yet.",
        usage,
      };
    }

    if (round >= MAX_TOOL_ROUNDS) {
      return {
        reply: "I couldn't finish the project brief in this turn.",
        usage,
      };
    }

    const toolResults: ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const result = await runReadOnlyProjectsTool(supabase, toolUse.name, toolUse.input);
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
  }

  return { reply: "No project brief available yet.", usage };
}

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY.");
  }

  anthropicClient ??= new Anthropic({ apiKey });
  return anthropicClient;
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

function emptyUsage(): DailyBriefUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

function addUsage(total: DailyBriefUsage, usage: Usage) {
  total.input_tokens += usage.input_tokens;
  total.output_tokens += usage.output_tokens;
  total.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
  total.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
}
