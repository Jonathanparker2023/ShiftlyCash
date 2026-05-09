import { describe, expect, it, vi } from "vitest";

import { buildChangedTaskFields } from "@/components/projects/TaskEditor";
import type { ProjectTask } from "@/lib/projects/types";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({}));
vi.mock("@/app/(protected)/projects/actions", () => ({
  deleteTaskAction: vi.fn(),
  updateTaskAction: vi.fn(),
}));

describe("buildChangedTaskFields", () => {
  it("returns only changed editable fields for a title save", () => {
    expect(
      buildChangedTaskFields(taskFixture(), {
        title: "Updated title",
        description: "Original description",
        dueDate: "2026-05-12",
        recurUnit: "none",
        recurInterval: "1",
      }),
    ).toEqual({ title: "Updated title" });
  });

  it("sends null when due date and description are cleared", () => {
    expect(
      buildChangedTaskFields(taskFixture(), {
        title: "Original title",
        description: "",
        dueDate: "",
        recurUnit: "none",
        recurInterval: "1",
      }),
    ).toEqual({
      description: null,
      dueDate: null,
    });
  });

  it("defaults recurrence interval and anchors recurrence to the due date", () => {
    expect(
      buildChangedTaskFields(taskFixture(), {
        title: "Original title",
        description: "Original description",
        dueDate: "2026-05-12",
        recurUnit: "week",
        recurInterval: "",
      }),
    ).toEqual({
      recurUnit: "week",
      recurInterval: 1,
      recurAnchorDate: "2026-05-12",
    });
  });

  it("clears recurrence fields when recurrence returns to none", () => {
    expect(
      buildChangedTaskFields({
        ...taskFixture(),
        recurUnit: "month",
        recurInterval: 2,
        recurAnchorDate: "2026-05-12",
      }, {
        title: "Original title",
        description: "Original description",
        dueDate: "2026-05-12",
        recurUnit: "none",
        recurInterval: "2",
      }),
    ).toEqual({
      recurUnit: null,
      recurInterval: null,
      recurAnchorDate: null,
    });
  });
});

function taskFixture(): ProjectTask {
  return {
    id: "task-1",
    projectId: "project-1",
    title: "Original title",
    description: "Original description",
    dueDate: "2026-05-12",
    status: "todo",
    sortOrder: 10,
    completedAt: null,
    recurUnit: null,
    recurInterval: null,
    recurAnchorDate: null,
    tags: [],
  };
}
