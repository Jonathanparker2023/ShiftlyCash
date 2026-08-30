import { describe, expect, it, vi } from "vitest";

import { createLatestSaveQueue } from "./saveQueue";

describe("createLatestSaveQueue", () => {
  it("serializes overlapping full-template saves and persists the newest draft last", async () => {
    let releaseFirst: ((revision: string) => void) | undefined;
    const save = vi
      .fn<(value: string, revision: string) => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("revision-3");
    const queue = createLatestSaveQueue("revision-1", save);

    const first = queue.enqueue("old template");
    const second = queue.enqueue("new template");

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, "old template", "revision-1");

    releaseFirst?.("revision-2");
    await Promise.all([first, second]);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, "new template", "revision-2");
    expect(queue.revision()).toBe("revision-3");
  });

  it("coalesces multiple edits made while a save is running", async () => {
    let releaseFirst: ((revision: string) => void) | undefined;
    const savedValues: string[] = [];
    const save = vi.fn(async (value: string) => {
      savedValues.push(value);
      if (savedValues.length === 1) {
        return await new Promise<string>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return "revision-3";
    });
    const queue = createLatestSaveQueue("revision-1", save);

    const saving = queue.enqueue("first");
    void queue.enqueue("second");
    void queue.enqueue("third");
    releaseFirst?.("revision-2");
    await saving;

    expect(savedValues).toEqual(["first", "third"]);
  });

  it("does not automatically loop after a failed save", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    const queue = createLatestSaveQueue("revision-1", save);

    await expect(queue.enqueue("draft")).rejects.toThrow("offline");
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.revision()).toBe("revision-1");
  });
});
