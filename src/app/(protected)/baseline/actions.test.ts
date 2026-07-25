import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import {
  createExpenseAction,
  deleteExpenseAction,
  saveExpenseAction,
} from "./actions";

const userId = "00000000-0000-4000-8000-000000000601";
const expenseId = "00000000-0000-4000-8000-000000000602";

describe("baseline actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies baseline and revalidates both routes after creating an expense", async () => {
    const supabase = makeSupabase();
    mocks.requireUser.mockResolvedValue({ supabase, user: { id: userId } });

    await createExpenseAction();

    // Two RPCs: apply the baseline forward, then heal recently-passed days.
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenCalledWith("apply_baseline_to_future_days", {
      p_user_id: userId,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("restamp_recent_baseline", {
      p_user_id: userId,
      p_days_back: 14,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/baseline");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("applies baseline and revalidates both routes after saving an expense", async () => {
    const supabase = makeSupabase();
    mocks.requireUser.mockResolvedValue({ supabase, user: { id: userId } });

    await saveExpenseAction({
      id: expenseId,
      name: "Car Payment",
      amountCents: 45_500,
      withdrawalDay: 15,
      expirationDate: null,
      isActive: true,
      sortOrder: 10,
    });

    // Two RPCs: apply the baseline forward, then heal recently-passed days.
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenCalledWith("apply_baseline_to_future_days", {
      p_user_id: userId,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/baseline");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("applies baseline and revalidates both routes after deleting an expense", async () => {
    const supabase = makeSupabase();
    mocks.requireUser.mockResolvedValue({ supabase, user: { id: userId } });

    await deleteExpenseAction({ id: expenseId });

    // Two RPCs: apply the baseline forward, then heal recently-passed days.
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenCalledWith("apply_baseline_to_future_days", {
      p_user_id: userId,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/baseline");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("wraps RPC failures with an apply-baseline error", async () => {
    const supabase = makeSupabase({
      rpcError: { message: "database said no" },
    });
    mocks.requireUser.mockResolvedValue({ supabase, user: { id: userId } });

    await expect(deleteExpenseAction({ id: expenseId })).rejects.toThrow(
      "Unable to apply baseline: database said no",
    );
  });
});

function makeSupabase({
  rpcError = null,
}: {
  rpcError?: { message: string } | null;
} = {}) {
  const row = {
    id: expenseId,
    name: "Car Payment",
    amount: 455,
    withdrawal_day: 15,
    expiration_date: null,
    is_active: true,
    sort_order: 10,
  };
  const chain = {
    select: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({
      data: { sort_order: 20 },
      error: null,
    })),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    })),
    eq: vi.fn(() => chain),
    single: vi.fn(async () => ({
      data: row,
      error: null,
    })),
  };

  return {
    from: vi.fn(() => chain),
    rpc: vi.fn(async () => ({ error: rpcError })),
  };
}
