export type ProjectStatus = "active" | "archived";
export type TaskStatus = "todo" | "in_progress" | "done";
export type RecurUnit = "day" | "week" | "month" | "year";

export type Tag = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  archivedAt: string | null;
};

export type TaskTag = {
  taskId: string;
  tagId: string;
};

export type ProjectTask = {
  id: string;
  projectId: string;
  projectName?: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: TaskStatus;
  sortOrder: number;
  completedAt: string | null;
  recurUnit: RecurUnit | null;
  recurInterval: number | null;
  recurAnchorDate: string | null;
  tags: Tag[];
};

export type ProjectItem = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: ProjectStatus;
  sortOrder: number;
  deadline: string | null;
  progress: {
    total: number;
    done: number;
    percent: number;
  };
  tags: Tag[];
  tasks: ProjectTask[];
};

export type ProjectEventItem = {
  id: string;
  projectId: string | null;
  taskId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ProjectsData = {
  projects: ProjectItem[];
  tags: Tag[];
};

export type ProjectDetailData = {
  project: ProjectItem;
  events: ProjectEventItem[];
};

export type TaskFilterInput = {
  tagIds?: string[];
  statuses?: TaskStatus[];
  dueBefore?: string | null;
};
