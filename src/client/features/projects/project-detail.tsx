import { useState } from "react";
import { useLocation } from "wouter";
import { ApiError, type ProjectSessionSummary } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { ConfirmModal } from "../../design-system/surfaces/confirm-modal.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useDeleteProject, useProject, useRenameProject } from "../../state/projects.ts";
import { NewSessionButton } from "../session-chat/new-session-button.tsx";

const BREADCRUMB = [{ label: "Projects", href: "/projects" }];

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

// The label a session row leads with: its title, else its first user
// message, else its short id — the same fallback order as the feed.
const sessionLabel = (session: ProjectSessionSummary): string =>
  session.title ?? session.preview ?? session.id.slice(0, 8);

/**
 * One project's page: the container's article and session indexes, its name
 * editable in place, and the whole container deletable behind a confirm
 * that spells out the cascade. A 404 renders not-found — the project may
 * have been deleted in another tab. `now` is injectable so tests render
 * deterministic relative times.
 */
export function ProjectDetail({ id, now }: { id: string; now?: Date }) {
  const [, navigate] = useLocation();
  const project = useProject(id);
  const rename = useRenameProject();
  const remove = useDeleteProject();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (project.isPending) return <LoadingState>Loading project…</LoadingState>;
  if (project.isError) {
    if (project.error instanceof ApiError && project.error.status === 404) {
      return (
        <section>
          <Breadcrumb items={BREADCRUMB} current="Not found" />
          <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Project not found</h2>
          <p className="mt-3 font-mono text-sm text-ink-muted">
            No project with id <code className="text-ink">{id}</code>.
          </p>
        </section>
      );
    }
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load project: {project.error.message}
      </p>
    );
  }

  const data = project.data;

  const startEditing = () => {
    setName(data.project.name);
    setError(null);
    setEditing(true);
  };

  const handleRename = async () => {
    setError(null);
    setPending(true);
    try {
      await rename(id, name.trim());
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async () => {
    setConfirmOpen(false);
    setError(null);
    setPending(true);
    try {
      await remove(id);
    } catch (cause) {
      // Already gone — intent satisfied, fall through and navigate. Anything
      // else surfaces inline and leaves us on the page.
      if (!(cause instanceof ApiError) || cause.status !== 404) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setPending(false);
        return;
      }
    }
    navigate("/projects");
  };

  return (
    <section>
      <Breadcrumb items={BREADCRUMB} current={data.project.name} />
      {editing ? (
        <div className="mt-6 flex max-w-md flex-col gap-4">
          <TextInput value={name} onChange={setName} label="Name" />
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              pending={pending}
              pendingLabel="saving…"
              onClick={handleRename}
            >
              save
            </Button>
            <Button variant="dismissive" disabled={pending} onClick={() => setEditing(false)}>
              cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="mt-6 font-display text-4xl text-ink leading-tight">{data.project.name}</h2>
          <div className="mt-2">
            <Meta>
              <span>created {formatRelativeTime(data.project.createdAt, now)}</span>
            </Meta>
          </div>
        </>
      )}
      <div className="mt-10">
        <Eyebrow tone="muted">Articles</Eyebrow>
        {data.articles.length === 0 ? (
          <div className="mt-3">
            <EmptyState>
              no articles yet. sessions in this project write their articles into this shared
              corpus.
            </EmptyState>
          </div>
        ) : (
          <div className="mt-1 divide-y divide-rule">
            {data.articles.map((article) => (
              <div key={article.slug} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <HeadlineLink
                    href={`/projects/${encodeURIComponent(id)}/articles/${encodeURIComponent(article.slug)}`}
                  >
                    {article.heading ?? article.name}
                  </HeadlineLink>
                  <Meta>
                    <span>created {formatRelativeTime(article.createdAt, now)}</span>
                  </Meta>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow tone="muted">Sessions</Eyebrow>
          <NewSessionButton projectId={id} />
        </div>
        {data.sessions.length === 0 ? (
          <div className="mt-3">
            <EmptyState>
              no sessions yet. sessions created in this project appear here and share its article
              corpus.
            </EmptyState>
          </div>
        ) : (
          <div className="mt-1 divide-y divide-rule">
            {data.sessions.map((session) => (
              <div key={session.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <HeadlineLink href={`/sessions/${encodeURIComponent(session.id)}`}>
                    {sessionLabel(session)}
                  </HeadlineLink>
                  <Meta>
                    <span>{session.status}</span>
                    <span>started {formatRelativeTime(session.startedAt, now)}</span>
                  </Meta>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing ? null : (
        <div className="-mx-3 mt-10 flex items-center">
          <Button variant="dismissive" onClick={startEditing}>
            rename project
          </Button>
          <Button
            variant="negative-quiet"
            pending={pending}
            pendingLabel="deleting…"
            onClick={() => setConfirmOpen(true)}
          >
            delete project
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-3 font-mono text-xs text-status-failed">
          {error}
        </p>
      ) : null}
      {confirmOpen ? (
        <ConfirmModal
          title="Delete this project?"
          body={`This deletes the whole container: ${plural(data.articles.length, "article")} and ${plural(data.sessions.length, "session")}, including everything those sessions own. This cannot be undone.`}
          confirmLabel="delete"
          variant="negative"
          onConfirm={handleDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </section>
  );
}
