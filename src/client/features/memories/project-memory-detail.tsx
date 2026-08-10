import {
  useDeleteProjectMemory,
  useProject,
  useProjectMemory,
  useUpdateProjectMemory,
} from "../../state/projects.ts";
import { MemoryDetailView } from "./memory-detail.tsx";

/**
 * One project-scoped memory's curation page: the same read, edit, and delete
 * affordances as a global memory, situated under its owning project and bound
 * to the project's queries. `now` is injectable so tests render deterministic
 * relative times.
 */
export function ProjectMemoryDetail({
  projectId,
  name,
  now,
}: {
  projectId: string;
  name: string;
  now?: Date;
}) {
  const memory = useProjectMemory(projectId, name);
  const update = useUpdateProjectMemory();
  const remove = useDeleteProjectMemory();
  // The owning project's name situates the memory; fall back to the short id
  // while it loads (or if the project query errors independently).
  const projectName = useProject(projectId).data?.project.name ?? projectId.slice(0, 8);
  return (
    <MemoryDetailView
      name={name}
      memory={memory}
      onSave={(patch) => update(projectId, name, patch)}
      onDelete={() => remove(projectId, name)}
      breadcrumbItems={[
        { label: "Projects", href: "/projects" },
        { label: projectName, href: `/projects/${encodeURIComponent(projectId)}` },
      ]}
      returnTo={`/projects/${encodeURIComponent(projectId)}`}
      now={now}
    />
  );
}
