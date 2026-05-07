export type ProjectStatus = "active" | "archived";
export type TaskStatus = "todo" | "in_progress" | "done";

export type ProjectTask = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: TaskStatus;
  sortOrder: number;
  completedAt: string | null;
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
  tasks: ProjectTask[];
};

export type ProjectsData = {
  projects: ProjectItem[];
};
