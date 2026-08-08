import { useState } from "react";
import { useLocation } from "wouter";
import type { ProjectSummary } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useCreateProject, useProjects } from "../../state/projects.ts";

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

// Substring filter across project names (case-insensitive). An empty query
// passes everything.
const filterProjects = (projects: ProjectSummary[], query: string): ProjectSummary[] => {
  const q = query.trim().toLowerCase();
  if (q === "") return projects;
  return projects.filter((project) => project.name.toLowerCase().includes(q));
};

function ProjectRow({ project, now }: { project: ProjectSummary; now?: Date }) {
  return (
    <div className="py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-xl">
          <HeadlineLink href={`/projects/${encodeURIComponent(project.id)}`}>
            {project.name}
          </HeadlineLink>
        </span>
        <Meta>
          <span>{plural(project.articleCount, "article")}</span>
          <span>{plural(project.sessionCount, "session")}</span>
          <span>created {formatRelativeTime(project.createdAt, now)}</span>
        </Meta>
      </div>
    </div>
  );
}

// The name-and-confirm dialog behind the create button. Owns its own field
// state so each opening starts blank; a successful create navigates straight
// to the new project's page.
function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const create = useCreateProject();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);
    setPending(true);
    try {
      const { id } = await create(name.trim());
      navigate(`/projects/${encodeURIComponent(id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  };

  return (
    <Modal title="New project" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <TextInput
          value={name}
          onChange={setName}
          label="Name"
          description="A project collects sessions around a shared corpus of articles."
        />
        <div className="flex items-center justify-end gap-3">
          <Button variant="dismissive" disabled={pending} onClick={onClose}>
            cancel
          </Button>
          <Button
            variant="primary"
            disabled={name.trim() === ""}
            pending={pending}
            pendingLabel="creating…"
            onClick={handleCreate}
          >
            create
          </Button>
        </div>
        {error ? (
          <p role="alert" className="font-mono text-xs text-status-failed">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * The project index: every project with its corpus and session sizes, each
 * linking to its page. The top bar filters the list client-side; the create
 * button opens a naming modal. Kept live by the shared project queries.
 * `now` is injectable so tests render deterministic relative times.
 */
export function ProjectsList({ now }: { now?: Date }) {
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <section>
      <Breadcrumb items={[]} current="Projects" />
      <div className="mt-6 max-w-sm">
        <TextInput value={query} onChange={setQuery} placeholder="Filter projects…" />
      </div>
      <div className="mt-4">
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          + New project
        </Button>
      </div>
      <div className="mt-8">
        <Body projects={projects} query={query} now={now} />
      </div>
      {createOpen ? <CreateProjectModal onClose={() => setCreateOpen(false)} /> : null}
    </section>
  );
}

function Body({
  projects,
  query,
  now,
}: {
  projects: ReturnType<typeof useProjects>;
  query: string;
  now?: Date;
}) {
  if (projects.isPending) return <LoadingState>Loading projects…</LoadingState>;
  if (projects.isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load projects: {projects.error.message}
      </p>
    );
  }

  if (projects.data.length === 0) {
    return (
      <EmptyState>
        no projects yet. a project collects sessions around a shared corpus of articles — create one
        and start sessions inside it.
      </EmptyState>
    );
  }

  const matched = filterProjects(projects.data, query);
  if (matched.length === 0) {
    return <EmptyState>No projects match “{query.trim()}”.</EmptyState>;
  }

  return (
    <div className="divide-y divide-rule">
      {matched.map((project) => (
        <ProjectRow key={project.id} project={project} now={now} />
      ))}
    </div>
  );
}
