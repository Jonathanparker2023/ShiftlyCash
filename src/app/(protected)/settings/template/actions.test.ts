import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { saveDefaultTemplateAction } from "./actions";

describe("saveDefaultTemplateAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the expected template revision and returns the new revision", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { savedCount: 1, updatedAt: "2026-08-30T12:30:01.000Z" },
      error: null,
    });
    mocks.requireUser.mockResolvedValue({
      supabase: { rpc },
      user: { id: "00000000-0000-4000-8000-000000000001" },
    });

    const result = await saveDefaultTemplateAction({
      expectedUpdatedAt: "2026-08-30T12:30:00.000Z",
      slots: [
        {
          dayIndex: 0,
          slotIndex: 0,
          jobType: "prestige",
          payType: "regular",
          hoursOrUnits: 3,
          regularHours: 3,
          overtimeHours: 0,
          incentiveMode: "none",
          incentiveRate: 0,
          incentiveAmount: 0,
          label: "Tony",
        },
      ],
    });

    expect(rpc).toHaveBeenCalledWith("replace_default_template_slots", {
      p_slots: {
        expectedUpdatedAt: "2026-08-30T12:30:00.000Z",
        slots: [expect.objectContaining({ label: "Tony", jobType: "prestige" })],
      },
    });
    expect(result).toEqual({
      ok: true,
      savedCount: 1,
      updatedAt: "2026-08-30T12:30:01.000Z",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("rejects a response without a new revision", async () => {
    mocks.requireUser.mockResolvedValue({
      supabase: {
        rpc: vi.fn().mockResolvedValue({ data: 1, error: null }),
      },
      user: { id: "00000000-0000-4000-8000-000000000001" },
    });

    await expect(
      saveDefaultTemplateAction({
        expectedUpdatedAt: "2026-08-30T12:30:00.000Z",
        slots: [],
      }),
    ).rejects.toThrow("database returned no revision");
  });
});
