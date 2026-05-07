import { ProjectsView } from "@/components/projects/ProjectsView";
import { getProjectsData } from "@/lib/projects/data";

export default async function ProjectsPage() {
  const data = await getProjectsData();

  return <ProjectsView initialData={data} />;
}
