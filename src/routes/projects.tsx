import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/shared";
import { ProjectsPage } from "@/components/app/projects";
import { defined, id } from "@/lib/search";

export const Route = createFileRoute("/projects")({
  head: () => pageHead("Projects"),
  validateSearch: (s: Record<string, unknown>): { project?: string } =>
    defined({ project: id(s["project"]) }),
  component: ProjectsRoute,
});
function ProjectsRoute() {
  const { project } = Route.useSearch();
  return <ProjectsPage project={project} />;
}
