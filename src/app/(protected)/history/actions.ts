"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type { ProjectionExclusionField } from "@/lib/history/types";

export type ToggleProjectionExclusionInput = {
  weekId: string;
  field: ProjectionExclusionField;
};

export type ToggleProjectionExclusionResult = {
  ok: true;
  weekId: string;
  field: ProjectionExclusionField;
  excluded: boolean;
};

export type ReopenWeekInput = {
  weekId: string;
};

export type ReopenWeekResult = {
  ok: true;
  weekId: string;
};

export async function toggleProjectionExclusionAction(
  input: ToggleProjectionExclusionInput,
): Promise<ToggleProjectionExclusionResult> {
  const { supabase, user } = await requireUser();
  const weekId = requireUuid(input.weekId, "weekId");
  const field = requireProjectionField(input.field);

  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select("id,status")
    .eq("id", weekId)
    .maybeSingle();

  if (weekError) {
    throw new Error(`Unable to validate week: ${weekError.message}`);
  }

  if (!week) {
    throw new Error("Week not found.");
  }

  if ((week as { status: string }).status === "active") {
    throw new Error("Active week projection flags cannot be changed from History.");
  }

  const { data: current, error: currentError } = await supabase
    .from("week_projection_exclusions")
    .select("exclude_earnings,exclude_spend,exclude_cashflow")
    .eq("week_id", weekId)
    .maybeSingle();

  if (currentError) {
    throw new Error(`Unable to load projection flag: ${currentError.message}`);
  }

  const currentRow = current as ProjectionExclusionRow | null;
  const next = {
    exclude_earnings: currentRow?.exclude_earnings ?? false,
    exclude_spend: currentRow?.exclude_spend ?? false,
    exclude_cashflow: currentRow?.exclude_cashflow ?? false,
  };
  const columnName = fieldToColumnName(field);
  next[columnName] = !next[columnName];

  const { error } = await supabase.from("week_projection_exclusions").upsert(
    {
      user_id: user.id,
      week_id: weekId,
      ...next,
    },
    { onConflict: "week_id" },
  );

  if (error) {
    throw new Error(`Unable to update projection flag: ${error.message}`);
  }

  revalidatePath("/history");

  return {
    ok: true,
    weekId,
    field,
    excluded: next[columnName],
  };
}

export async function reopenWeekAction(
  input: ReopenWeekInput,
): Promise<ReopenWeekResult> {
  const { supabase } = await requireUser();
  const weekId = requireUuid(input.weekId, "weekId");
  const { data, error } = await supabase.rpc("reopen_week", {
    p_week_id: weekId,
  });

  if (error) {
    throw new Error(`Unable to reopen week: ${error.message}`);
  }

  if (typeof data !== "string") {
    throw new Error("Week reopen did not return the reopened week id.");
  }

  revalidatePath("/");
  revalidatePath("/history");

  return {
    ok: true,
    weekId: data,
  };
}

type ProjectionExclusionRow = {
  exclude_earnings: boolean;
  exclude_spend: boolean;
  exclude_cashflow: boolean;
};

function requireProjectionField(value: string): ProjectionExclusionField {
  if (value === "earnings" || value === "spend" || value === "cashflow") {
    return value;
  }

  throw new Error("Invalid projection exclusion field.");
}

function fieldToColumnName(
  field: ProjectionExclusionField,
): keyof ProjectionExclusionRow {
  if (field === "earnings") {
    return "exclude_earnings";
  }

  if (field === "spend") {
    return "exclude_spend";
  }

  return "exclude_cashflow";
}

function requireUuid(value: string, fieldName: string): string {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(value)) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return value;
}
