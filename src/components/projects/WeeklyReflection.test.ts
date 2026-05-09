import { describe, expect, it, vi } from "vitest";

import { shouldRenderWeeklyReflection } from "@/components/projects/WeeklyReflection";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({}));
vi.mock("@/lib/projects/data", () => ({}));
vi.mock("./WeeklyReflectionClient", () => ({}));

describe("WeeklyReflection", () => {
  it("hides before the final day of the current week", () => {
    expect(shouldRenderWeeklyReflection("2026-05-09", "2026-05-04")).toBe(false);
  });

  it("renders on the final day of the current week", () => {
    expect(shouldRenderWeeklyReflection("2026-05-10", "2026-05-04")).toBe(true);
  });

  it("hides on the week start", () => {
    expect(shouldRenderWeeklyReflection("2026-05-04", "2026-05-04")).toBe(false);
  });

  it("hides after the week has rolled over", () => {
    expect(shouldRenderWeeklyReflection("2026-05-11", "2026-05-04")).toBe(false);
  });
});
