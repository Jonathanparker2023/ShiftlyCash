import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MealPlanCandidate, ResearcherInput } from "./types";

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return {
      messages: {
        create: mocks.createMessage,
      },
    };
  }),
}));

const BASE_INPUT: ResearcherInput = {
  remainingTargets: {
    calories: 1100,
    proteinG: 90,
    carbsG: 120,
    fiberG: 15,
    fatG: 40,
    sodiumMg: 1200,
    addedSugarG: 20,
    saturatedFatG: 12,
  },
  axioms: {
    eatOut: true,
    requireDoorDash: true,
    allowNonDoorDashMain: false,
    carbMode: "high",
    locationHint: "Naugatuck, CT",
  },
  savedFoods: [],
  nowIso: "2026-05-19T12:00:00.000Z",
  healthFlags: [],
};

describe("fetchCandidatePool", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mocks.createMessage.mockReset();
  });

  it("filters non-DoorDash mains when DoorDash is required", async () => {
    const { fetchCandidatePool } = await import("./researcher");
    mocks.createMessage.mockResolvedValueOnce(responseWithPool({
      mains: [
        candidate("main", "DoorDash Bowl", "https://www.doordash.com/store/abc/item/123"),
        candidate("main", "No Link Bowl", null),
      ],
      fillers: [candidate("filler", "Greek Yogurt", null)],
    }));

    const pool = await fetchCandidatePool(BASE_INPUT);

    expect(pool.unfetchedReason).toBeNull();
    expect(pool.mains).toHaveLength(1);
    expect(pool.mains[0].name).toBe("DoorDash Bowl");
    expect(pool.mains[0].doordashUrl).toContain("doordash.com");
    expect(pool.mains[0].id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("returns an unfetched reason when every DoorDash-required main is ineligible", async () => {
    const { fetchCandidatePool } = await import("./researcher");
    mocks.createMessage.mockResolvedValueOnce(responseWithPool({
      mains: [
        candidate("main", "No Link Bowl", null),
        candidate("main", "Also No Link Bowl", null),
      ],
      fillers: [candidate("filler", "Apple", null)],
    }));

    const pool = await fetchCandidatePool(BASE_INPUT);

    expect(pool.mains).toEqual([]);
    expect(pool.unfetchedReason).toBe("No DoorDash-verified mains matched your request.");
  });
});

function responseWithPool({
  mains,
  fillers,
}: {
  mains: MealPlanCandidate[];
  fillers: MealPlanCandidate[];
}) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          fetchedAt: null,
          axioms: BASE_INPUT.axioms,
          unfetchedReason: null,
          mains,
          fillers,
        }),
      },
    ],
  };
}

function candidate(
  kind: MealPlanCandidate["kind"],
  name: string,
  doordashUrl: string | null,
): MealPlanCandidate {
  return {
    id: `ai-${name}`,
    kind,
    name,
    sourceUrl: "https://example.com/nutrition",
    doordashUrl: kind === "main" ? doordashUrl : null,
    tier: "published",
    macros: {
      calories: 600,
      proteinG: 45,
      carbsG: 70,
      fiberG: 8,
      fatG: 20,
      sodiumMg: 900,
      addedSugarG: 4,
      saturatedFatG: 5,
    },
    macroRange: null,
    confidence: "high",
    notes: "Test candidate.",
  };
}
