import "server-only";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { mark, since, timed } from "@/lib/perf";
import type {
  ProjectDetailData,
  ProjectEventItem,
  ProjectItem,
  ProjectsData,
  ProjectStatus,
  ProjectTask,
  TaskStatus,
} from "@/lib/projects/types";

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  status: ProjectStatus;
  sort_order: number | null;
  deadline: string | null;
};

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: TaskStatus;
  sort_order: number | null;
  completed_at: string | null;
};

type ProjectEventRow = {
  id: string;
  project_id: string | null;
  task_id: string | null;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export async function getProjectsData(): Promise<ProjectsData> {
  const tTotal = mark();
  const { supabase, user } = await timed("projects:auth", () => requireUser());
  if (!user) redirect("/login");

  const tReads = mark();
  const [projectsRes, tasksRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id,name,description,color,status,sort_order,deadline")
      .eq("user_id", user.id),
    supabase
      .from("tasks")
      .select("id,project_id,title,description,due_date,status,sort_order,completed_at")
      .eq("user_id", user.id),
  ]);
  since("projects:reads(projects+tasks)", tReads);

  if (projectsRes.error) {
    throw new Error(`Projects: ${projectsRes.error.message}`);
  }

  if (tasksRes.error) {
    throw new Error(`Tasks: ${tasksRes.error.message}`);
  }

  const tasksByProject = new Map<string, ProjectTask[]>();
  for (const row of (tasksRes.data ?? []) as TaskRow[]) {
    const task = mapTask(row);
    const bucket = tasksByProject.get(row.project_id) ?? [];
    bucket.push(task);
    tasksByProject.set(row.project_id, bucket);
  }

  for (const tasks of tasksByProject.values()) {
    tasks.sort(compareTasks);
  }

  const projects = ((projectsRes.data ?? []) as ProjectRow[])
    .map((row): ProjectItem => {
      const tasks = tasksByProject.get(row.id) ?? [];
      const done = tasks.filter((task) => task.status === "done").length;
      const total = tasks.length;

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        color: row.color ?? "#1d4ed8",
        status: row.status,
        sortOrder: Number(row.sort_order ?? 0),
        deadline: row.deadline,
        progress: {
          total,
          done,
          percent: total > 0 ? Math.round((done / total) * 100) : 0,
        },
        tasks,
      };
    })
    .sort(compareProjects);

  since("projects:total", tTotal);
  return { projects };
}

export async function getProjectDetailData(
  projectId: string,
): Promise<ProjectDetailData> {
  const id = requireUuid(projectId);
  if (!id) redirect("/projects");

  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const [projectRes, tasksRes, eventsRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id,name,description,color,status,sort_order,deadline")
      .eq("user_id", user.id)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id,project_id,title,description,due_date,status,sort_order,completed_at")
      .eq("user_id", user.id)
      .eq("project_id", id),
    supabase
      .from("project_events")
      .select("id,project_id,task_id,kind,payload,created_at")
      .eq("user_id", user.id)
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (projectRes.error) {
    throw new Error(`Project: ${projectRes.error.message}`);
  }

  if (tasksRes.error) {
    throw new Error(`Tasks: ${tasksRes.error.message}`);
  }

  if (eventsRes.error) {
    throw new Error(`Project activity: ${eventsRes.error.message}`);
  }

  if (!projectRes.data) {
    redirect("/projects");
  }

  const tasks = ((tasksRes.data ?? []) as TaskRow[]).map(mapTask).sort(compareTasks);
  const project = mapProject(projectRes.data as ProjectRow, tasks);

  return {
    project,
    events: ((eventsRes.data ?? []) as ProjectEventRow[]).map(mapEvent),
  };
}

function mapProject(row: ProjectRow, tasks: ProjectTask[]): ProjectItem {
  const done = tasks.filter((task) => task.status === "done").length;
  const total = tasks.length;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color ?? "#1d4ed8",
    status: row.status,
    sortOrder: Number(row.sort_order ?? 0),
    deadline: row.deadline,
    progress: {
      total,
      done,
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
    },
    tasks,
  };
}

function mapTask(row: TaskRow): ProjectTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    status: row.status,
    sortOrder: Number(row.sort_order ?? 0),
    completedAt: row.completed_at,
  };
}

function mapEvent(row: ProjectEventRow): ProjectEventItem {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    kind: row.kind,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  };
}

function compareProjects(a: ProjectItem, b: ProjectItem): number {
  if (a.status !== b.status) {
    return a.status === "active" ? -1 : 1;
  }

  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

function compareTasks(a: ProjectTask, b: ProjectTask): number {
  if (a.status === "done" && b.status !== "done") {
    return 1;
  }

  if (a.status !== "done" && b.status === "done") {
    return -1;
  }

  return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);
}

function requireUuid(value: string): string | null {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidPattern.test(value) ? value : null;
}
