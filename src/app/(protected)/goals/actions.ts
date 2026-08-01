"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";

export type UpdateRungInput = {
  rungId: string;
  title?: string;
  kicker?: string;
  description?: string;
  targetCents?: number;
  targetKind?: "fixed" | "debt" | "house_hack";
  debtMatch?: string | null;
  deadlineOn?: string | null;
  deadlineLabel?: string | null;
};

export async function updateGoalRungAction(
  input: UpdateRungInput,
): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  const patch: Record<string, unknown> = {};
  if (typeof input.title === "string") {
    patch.title = input.title.trim() || "Untitled goal";
  }
  if (typeof input.kicker === "string") patch.kicker = input.kicker.trim();
  if (typeof input.description === "string") {
    patch.description = input.description;
  }
  if (typeof input.targetCents === "number") {
    patch.target_cents = Math.max(0, Math.round(input.targetCents));
  }
  if (input.targetKind) patch.target_kind = input.targetKind;
  if (input.debtMatch !== undefined) patch.debt_match = input.debtMatch;
  if (input.deadlineOn !== undefined) patch.deadline_on = input.deadlineOn;
  if (input.deadlineLabel !== undefined) {
    patch.deadline_label = input.deadlineLabel;
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("goal_rungs")
    .update(patch)
    .eq("id", input.rungId)
    .eq("user_id", user.id);

  if (error) throw new Error(`Unable to save goal: ${error.message}`);

  revalidatePath("/goals");
  return { ok: true };
}

/**
 * Reorder by writing the whole sequence. Swapping a pair would leave gaps and
 * ties after an add or a delete; rewriting every index keeps the ladder dense
 * and unambiguous.
 */
export async function reorderGoalRungsAction(input: {
  orderedIds: string[];
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  await Promise.all(
    input.orderedIds.map((id, index) =>
      supabase
        .from("goal_rungs")
        .update({ order_index: index + 1 })
        .eq("id", id)
        .eq("user_id", user.id),
    ),
  );

  revalidatePath("/goals");
  return { ok: true };
}

export async function addGoalRungAction(): Promise<{ ok: true; rungId: string }> {
  const { supabase, user } = await requireUser();

  const { data: existing, error: readError } = await supabase
    .from("goal_rungs")
    .select("order_index")
    .eq("user_id", user.id);

  if (readError) throw new Error(`Unable to read ladder: ${readError.message}`);

  const nextIndex =
    Math.max(
      0,
      ...((existing ?? []) as { order_index: number }[]).map(
        (row) => row.order_index ?? 0,
      ),
    ) + 1;

  const { data, error } = await supabase
    .from("goal_rungs")
    .insert({
      user_id: user.id,
      order_index: nextIndex,
      title: "New goal",
      kicker: `Rung ${nextIndex}`,
      description: "",
      target_kind: "fixed",
      target_cents: 0,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Unable to add goal: ${error.message}`);

  revalidatePath("/goals");
  return { ok: true, rungId: (data as { id: string }).id };
}

/**
 * Deactivates rather than deletes, so a rung that gets pulled from the ladder
 * keeps its wording and history if it is ever put back.
 */
export async function removeGoalRungAction(input: {
  rungId: string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("goal_rungs")
    .update({ is_active: false })
    .eq("id", input.rungId)
    .eq("user_id", user.id);

  if (error) throw new Error(`Unable to remove goal: ${error.message}`);

  revalidatePath("/goals");
  return { ok: true };
}
