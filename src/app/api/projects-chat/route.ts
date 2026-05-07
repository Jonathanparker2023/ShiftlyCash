import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { NextResponse } from "next/server";

import { runProjectsAgent } from "@/lib/claude/projectsAgent";
import { DailyCapExceededError } from "@/lib/claude/usage";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { messages?: unknown };
    const messages = normalizeMessages(body.messages);

    if (messages.length === 0) {
      return NextResponse.json(
        { error: "At least one message is required." },
        { status: 400 },
      );
    }

    const result = await runProjectsAgent({ messages, supabase, userId: user.id });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DailyCapExceededError) {
      return NextResponse.json(
        {
          error: "daily_cap_exceeded",
          usedCents: error.usedCents,
          capCents: error.capCents,
          resetsAtIso: error.resetsAtIso,
        },
        { status: 429 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Project chat request failed.",
      },
      { status: 500 },
    );
  }
}

function normalizeMessages(value: unknown): MessageParam[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(-20)
    .map((message): MessageParam | null => {
      if (!message || typeof message !== "object") {
        return null;
      }

      const record = message as Record<string, unknown>;
      const role = record.role;
      const content = record.content;

      if (role !== "user" && role !== "assistant") {
        return null;
      }

      if (typeof content === "string") {
        return { role, content: content.slice(0, 4000) };
      }

      if (Array.isArray(content)) {
        const text = content
          .map((block) =>
            block &&
            typeof block === "object" &&
            (block as { type?: unknown }).type === "text" &&
            typeof (block as { text?: unknown }).text === "string"
              ? (block as { text: string }).text
              : "",
          )
          .filter(Boolean)
          .join("\n")
          .slice(0, 4000);

        return text ? { role, content: text } : null;
      }

      return null;
    })
    .filter((message): message is MessageParam => Boolean(message));
}
