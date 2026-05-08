import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateDailyBrief } from "@/lib/claude/dailyBrief";

const mocks = vi.hoisted(() => ({
  checkDailyCap: vi.fn(),
  createMessage: vi.fn(),
  logUsage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboard/dates", () => ({
  getTodayIso: () => "2026-05-08",
}));
vi.mock("@/lib/claude/usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/claude/usage")>(
    "@/lib/claude/usage",
  );
  return {
    ...actual,
    checkDailyCap: mocks.checkDailyCap,
    logUsage: mocks.logUsage,
  };
});
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return {
      messages: {
        create: mocks.createMessage,
      },
    };
  }),
}));

describe("generateDailyBrief", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    mocks.checkDailyCap.mockResolvedValue({
      allowed: true,
      usedCents: 0,
      capCents: 500,
      resetsAtIso: "2026-05-09T00:00:00.000Z",
    });
    mocks.logUsage.mockResolvedValue(undefined);
  });

  it("checks cap and logs usage for Anthropic brief calls", async () => {
    mocks.createMessage
      .mockResolvedValueOnce({
        id: "msg_tool",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "list_projects",
            input: {},
          },
        ],
        usage: usage(100, 20),
      })
      .mockResolvedValueOnce({
        id: "msg_text",
        content: [
          {
            type: "text",
            text: "Two tasks are due today. One is past due. Focus on the oldest blocked project first.",
          },
        ],
        usage: usage(80, 30),
      });
    const supabase = createBriefSupabase();

    const result = await generateDailyBrief(supabase as never, "user-1");

    expect(result.reply).toContain("Two tasks are due today");
    expect(mocks.checkDailyCap).toHaveBeenCalledTimes(2);
    expect(mocks.logUsage).toHaveBeenCalledTimes(2);
    expect(mocks.logUsage).toHaveBeenNthCalledWith(
      1,
      supabase,
      "user-1",
      "msg_tool",
      "claude-opus-4-7",
      usage(100, 20),
    );
  });
});

function usage(input: number, output: number) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

function createBriefSupabase() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    from(table: string) {
      if (table === "projects") {
        return {
          select() {
            const chain = {
              eq() {
                return chain;
              },
              order() {
                return Promise.resolve({
                  data: [
                    {
                      id: "project-1",
                      name: "Ops",
                      status: "active",
                      deadline: null,
                    },
                  ],
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
              lte() {
                return chain;
              },
              not() {
                return chain;
              },
              order() {
                return chain;
              },
              then(resolve: (value: unknown) => void) {
                resolve({
                  data: [
                    {
                      id: "task-1",
                      title: "Call",
                      due_date: "2026-05-08",
                    },
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
}
