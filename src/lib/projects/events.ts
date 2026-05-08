import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ProjectEventKind =
  | "project.created"
  | "project.updated"
  | "project.archived"
  | "project.deleted"
  | "task.created"
  | "task.updated"
  | "task.completed"
  | "task.deleted"
  | "projects.reordered"
  | "tasks.reordered";

export async function logProjectEvent({
  supabase,
  projectId,
  taskId = null,
  kind,
  payload = {},
}: {
  supabase: SupabaseClient;
  projectId: string;
  taskId?: string | null;
  kind: ProjectEventKind;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.warn(
        `Unable to log project event ${kind}: ${
          authError?.message ?? "User is not authenticated."
        }`,
      );
      return;
    }

    const { error } = await supabase.from("project_events").insert({
      user_id: user.id,
      project_id: projectId,
      task_id: taskId,
      actor_id: user.id,
      kind,
      payload,
    });

    if (error) {
      console.warn(`Unable to log project event ${kind}: ${error.message}`);
    }
  } catch (error) {
    console.warn(
      `Unable to log project event ${kind}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}
