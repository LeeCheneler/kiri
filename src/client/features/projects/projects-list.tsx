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
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useCreateProject, useProjects } from "../../state/projects.ts";

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

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

/**
 * The project index: every project with its corpus and session sizes, each
 * linking to its page, plus the create form. Kept live by the shared
 * project queries. `now` is injectable so tests render deterministic
 * relative times.
 */
export function ProjectsList({ now }: { now?: Date }) {
  const projects = useProjects();
  const create = useCreateProject();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (name.trim() === "") return;
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
    <section>
      <Breadcrumb items={[]} current="Projects" />
      <div className="mt-6 flex items-center gap-3">
        <TextInput value={name} onChange={setName} placeholder="New project name…" />
        <Button variant="primary" pending={pending} pendingLabel="creating…" onClick={handleCreate}>
          create
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 font-mono text-xs text-status-failed">
          {error}
        </p>
      ) : null}
      <div className="mt-8">
        <Body projects={projects} now={now} />
      </div>
    </section>
  );
}

function Body({ projects, now }: { projects: ReturnType<typeof useProjects>; now?: Date }) {
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

  return (
    <div className="divide-y divide-rule">
      {projects.data.map((project) => (
        <ProjectRow key={project.id} project={project} now={now} />
      ))}
    </div>
  );
}
