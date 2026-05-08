import { requireUser } from "@/lib/auth";
import { getInboxTasks, getProjectsData } from "@/lib/projects/data";

import { QuickCaptureInboxClient } from "./QuickCaptureInboxClient";

export async function QuickCaptureInbox() {
  const { supabase } = await requireUser();
  const [tasks, projectsData] = await Promise.all([
    getInboxTasks(supabase),
    getProjectsData(),
  ]);

  return (
    <QuickCaptureInboxClient
      inboxTasks={tasks}
      projects={projectsData.projects}
    />
  );
}
