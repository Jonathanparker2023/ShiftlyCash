import "server-only";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireUser } from "@/lib/auth";
import { mark, since, timed } from "@/lib/perf";
import type {
  ProjectDetailData,
  ProjectEventItem,
  ProjectItem,
  ProjectsData,
  ProjectStatus,
  ProjectTask,
  Tag,
  TaskFilterInput,
  TaskStatus,
  TodayData,
  WeeklyReflection,
} from "@/lib/projects/types";

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  status: ProjectStatus;
  sort_order: number | null;
  deadline: string | null;
  is_inbox: boolean | null;
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
  created_at?: string | null;
  recur_unit: ProjectTask["recurUnit"];
  recur_interval: number | null;
  recur_anchor_date: string | null;
  projects?: { name: string; is_inbox?: boolean | null } | { name: string; is_inbox?: boolean | null }[] | null;
};

type TagRow = {
  id: string;
  name: string;
  color: string | null;
  sort_order: number | null;
  archived_at: string | null;
};

type TaskTagRow = {
  task_id: string;
  tag_id: string;
  tags: TagRow | TagRow[] | null;
};

type ProjectEventRow = {
  id: string;
  project_id: string | null;
  task_id: string | null;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type WeeklyReflectionRow = {
  id: string;
  week_start: string;
  shipped: string | null;
  stuck: string | null;
  next_week: string | null;
  updated_at: string;
};

export async function getProjectsData(): Promise<ProjectsData> {
  const tTotal = mark();
  const { supabase, user } = await timed("projects:auth", () => requireUser());
  if (!user) redirect("/login");

  const tReads = mark();
  const [projectsRes, tasksRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id,name,description,color,status,sort_order,deadline,is_inbox")
      .eq("user_id", user.id)
      .eq("is_inbox", false),
    supabase
      .from("tasks")
      .select(
        "id,project_id,title,description,due_date,status,sort_order,completed_at,recur_unit,recur_interval,recur_anchor_date",
      )
      .eq("user_id", user.id),
  ]);
  since("projects:reads(projects+tasks)", tReads);

  if (projectsRes.error) {
    throw new Error(`Projects: ${projectsRes.error.message}`);
  }

  if (tasksRes.error) {
    throw new Error(`Tasks: ${tasksRes.error.message}`);
  }

  const taskRows = (tasksRes.data ?? []) as TaskRow[];
  const [allTags, taskTags] = await Promise.all([
    getTagsForUser(supabase),
    getTaskTagsForTasks(
      supabase,
      user.id,
      taskRows.map((task) => task.id),
    ),
  ]);

  const tasksByProject = new Map<string, ProjectTask[]>();
  for (const row of taskRows) {
    const task = mapTask(row, taskTags.get(row.id) ?? []);
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
        isInbox: Boolean(row.is_inbox),
        progress: {
          total,
          done,
          percent: total > 0 ? Math.round((done / total) * 100) : 0,
        },
        tags: allTags,
        tasks,
      };
    })
    .sort(compareProjects);

  since("projects:total", tTotal);
  return { projects, tags: allTags };
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
      .select("id,name,description,color,status,sort_order,deadline,is_inbox")
      .eq("user_id", user.id)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select(
        "id,project_id,title,description,due_date,status,sort_order,completed_at,recur_unit,recur_interval,recur_anchor_date",
      )
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

  const taskRows = (tasksRes.data ?? []) as TaskRow[];
  const [allTags, taskTags] = await Promise.all([
    getTagsForUser(supabase),
    getTaskTagsForTasks(
      supabase,
      user.id,
      taskRows.map((task) => task.id),
    ),
  ]);
  const tasks = taskRows
    .map((task) => mapTask(task, taskTags.get(task.id) ?? []))
    .sort(compareTasks);
  const project = mapProject(projectRes.data as ProjectRow, tasks, allTags);

  return {
    project,
    events: ((eventsRes.data ?? []) as ProjectEventRow[]).map(mapEvent),
  };
}

export async function getTagsForUser(
  supabase: SupabaseClient,
): Promise<Tag[]> {
  const userId = await getAuthedUserId(supabase);
  if (!userId) return [];

  const { data, error } = await supabase
    .from("tags")
    .select("id,name,color,sort_order,archived_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Tags: ${error.message}`);
  }

  return ((data ?? []) as TagRow[]).map(mapTag);
}

export async function getTasksFiltered(
  supabase: SupabaseClient,
  filters: TaskFilterInput,
): Promise<ProjectTask[]> {
  const userId = await getAuthedUserId(supabase);
  if (!userId) return [];

  const tagIds = (filters.tagIds ?? []).filter((id) => requireUuid(id));
  let taskIdsFromTags: string[] | null = null;

  if (tagIds.length > 0) {
    const { data, error } = await supabase
      .from("task_tags")
      .select("task_id")
      .eq("user_id", userId)
      .in("tag_id", tagIds);

    if (error) {
      throw new Error(`Filtered task tags: ${error.message}`);
    }

    taskIdsFromTags = Array.from(
      new Set(((data ?? []) as { task_id: string }[]).map((row) => row.task_id)),
    );

    if (taskIdsFromTags.length === 0) {
      return [];
    }
  }

  let query = supabase
    .from("tasks")
    .select(
      "id,project_id,title,description,due_date,status,sort_order,completed_at,recur_unit,recur_interval,recur_anchor_date,projects!inner(name,is_inbox)",
    )
    .eq("user_id", userId);

  if (filters.statuses && filters.statuses.length > 0) {
    query = query.in("status", filters.statuses);
  }

  if (filters.dueBefore) {
    query = query.not("due_date", "is", null).lte("due_date", filters.dueBefore);
  }

  if (taskIdsFromTags) {
    query = query.in("id", taskIdsFromTags);
  }

  query = query.eq("projects.is_inbox", false);

  const { data, error } = await query
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Filtered tasks: ${error.message}`);
  }

  const taskRows = (data ?? []) as TaskRow[];
  const taskTags = await getTaskTagsForTasks(
    supabase,
    userId,
    taskRows.map((task) => task.id),
  );

  return taskRows.map((task) =>
    mapTask(task, taskTags.get(task.id) ?? [], getProjectName(task.projects)),
  );
}

export async function getTodayData(
  supabase: SupabaseClient,
  todayIso: string,
): Promise<TodayData> {
  const userId = await getAuthedUserId(supabase);
  if (!userId) return { dueToday: [], dueThisWeek: [] };

  const weekEndIso = addDaysIso(todayIso, 6);
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id,project_id,title,description,due_date,status,sort_order,completed_at,recur_unit,recur_interval,recur_anchor_date,projects!inner(name,is_inbox)",
    )
    .eq("user_id", userId)
    .eq("projects.is_inbox", false)
    .in("status", ["todo", "in_progress"])
    .gte("due_date", todayIso)
    .lte("due_date", weekEndIso)
    .order("due_date", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Today tasks: ${error.message}`);
  }

  const taskRows = (data ?? []) as TaskRow[];
  const taskTags = await getTaskTagsForTasks(
    supabase,
    userId,
    taskRows.map((task) => task.id),
  );
  const tasks = taskRows.map((task) =>
    mapTask(task, taskTags.get(task.id) ?? [], getProjectName(task.projects)),
  );

  return {
    dueToday: tasks.filter((task) => task.dueDate === todayIso),
    dueThisWeek: tasks.filter((task) => task.dueDate !== todayIso),
  };
}

export async function getInboxTasks(
  supabase: SupabaseClient,
): Promise<ProjectTask[]> {
  const userId = await getAuthedUserId(supabase);
  if (!userId) return [];

  const { data: inbox, error: inboxError } = await supabase
    .from("projects")
    .select("id,name")
    .eq("user_id", userId)
    .eq("is_inbox", true)
    .maybeSingle();

  if (inboxError) {
    throw new Error(`Inbox project: ${inboxError.message}`);
  }

  const inboxProject = inbox as { id: string; name: string } | null;
  if (!inboxProject) {
    return [];
  }

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id,project_id,title,description,due_date,status,sort_order,completed_at,created_at,recur_unit,recur_interval,recur_anchor_date",
    )
    .eq("user_id", userId)
    .eq("project_id", inboxProject.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Inbox tasks: ${error.message}`);
  }

  const taskRows = (data ?? []) as TaskRow[];
  return taskRows.map((task) => mapTask(task, [], inboxProject.name));
}

export async function getCurrentWeekReflection(
  supabase: SupabaseClient,
  weekStartIso: string,
): Promise<WeeklyReflection | null> {
  const userId = await getAuthedUserId(supabase);
  if (!userId) return null;

  const { data, error } = await supabase
    .from("weekly_reflections")
    .select("id,week_start,shipped,stuck,next_week,updated_at")
    .eq("user_id", userId)
    .eq("week_start", weekStartIso)
    .maybeSingle();

  if (error) {
    throw new Error(`Weekly reflection: ${error.message}`);
  }

  return data ? mapWeeklyReflection(data as WeeklyReflectionRow) : null;
}

function mapProject(
  row: ProjectRow,
  tasks: ProjectTask[],
  tags: Tag[] = [],
): ProjectItem {
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
    isInbox: Boolean(row.is_inbox),
    progress: {
      total,
      done,
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
    },
    tags,
    tasks,
  };
}

function mapTask(
  row: TaskRow,
  tags: Tag[] = [],
  projectName?: string,
): ProjectTask {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    status: row.status,
    sortOrder: Number(row.sort_order ?? 0),
    completedAt: row.completed_at,
    recurUnit: row.recur_unit,
    recurInterval: row.recur_interval,
    recurAnchorDate: row.recur_anchor_date,
    tags,
  };
}

function mapTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? "#94a3b8",
    sortOrder: Number(row.sort_order ?? 0),
    archivedAt: row.archived_at,
  };
}

function mapWeeklyReflection(row: WeeklyReflectionRow): WeeklyReflection {
  return {
    id: row.id,
    weekStart: row.week_start,
    shipped: row.shipped,
    stuck: row.stuck,
    nextWeek: row.next_week,
    updatedAt: row.updated_at,
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

async function getAuthedUserId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user.id;
}

async function getTaskTagsForTasks(
  supabase: SupabaseClient,
  userId: string,
  taskIds: string[],
): Promise<Map<string, Tag[]>> {
  if (taskIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("task_tags")
    .select("task_id,tag_id,tags(id,name,color,sort_order,archived_at)")
    .eq("user_id", userId)
    .in("task_id", taskIds);

  if (error) {
    throw new Error(`Task tags: ${error.message}`);
  }

  const byTask = new Map<string, Tag[]>();
  for (const row of (data ?? []) as TaskTagRow[]) {
    const tagRow = Array.isArray(row.tags) ? row.tags[0] : row.tags;
    if (!tagRow || tagRow.archived_at) {
      continue;
    }

    const tags = byTask.get(row.task_id) ?? [];
    tags.push(mapTag(tagRow));
    byTask.set(row.task_id, tags);
  }

  for (const tags of byTask.values()) {
    tags.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  return byTask;
}

function getProjectName(value: TaskRow["projects"]): string | undefined {
  const project = Array.isArray(value) ? value[0] : value;
  return project?.name;
}

function addDaysIso(startIso: string, days: number): string {
  const date = new Date(`${startIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function requireUuid(value: string): string | null {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidPattern.test(value) ? value : null;
}
