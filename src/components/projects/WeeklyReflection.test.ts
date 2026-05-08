import { describe, expect, it, vi } from "vitest";

import { shouldRenderWeeklyReflection } from "@/components/projects/WeeklyReflection";
import type { WeeklyReflection } from "@/lib/projects/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({}));
vi.mock("@/lib/projects/data", () => ({}));
vi.mock("./WeeklyReflectionClient", () => ({}));

describe("WeeklyReflection", () => {
  it("renders whenever the current week has not been saved yet", () => {
    expect(shouldRenderWeeklyReflection("2026-05-05", null)).toBe(true);
  });

  it("renders on Friday through Sunday even when already saved", () => {
    const reflection = savedReflection();

    expect(shouldRenderWeeklyReflection("2026-05-08", reflection)).toBe(true);
    expect(shouldRenderWeeklyReflection("2026-05-09", reflection)).toBe(true);
    expect(shouldRenderWeeklyReflection("2026-05-10", reflection)).toBe(true);
  });

  it("hides Monday through Thursday when already saved", () => {
    expect(shouldRenderWeeklyReflection("2026-05-06", savedReflection())).toBe(false);
  });
});

function savedReflection(): WeeklyReflection {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    weekStart: "2026-05-03",
    shipped: "Done",
    stuck: "None",
    nextWeek: "Next",
    updatedAt: "2026-05-08T12:00:00.000Z",
  };
}
