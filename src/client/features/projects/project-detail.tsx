import { type ReactNode, useCallback, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ApiError } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { Textarea } from "../../design-system/actions/textarea.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Prose } from "../../design-system/content/prose.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { type TabDef, Tabs } from "../../design-system/navigation/tabs.tsx";
import { ConfirmModal } from "../../design-system/surfaces/confirm-modal.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import {
  useDeleteProject,
  useProjectArticlesFeed,
  useProjectOverview,
  useProjectSessionsFeed,
  useRenameProject,
  useSaveProjectInstructions,
} from "../../state/projects.ts";
import { ArticleRow } from "../activity-feed/article-row.tsx";
import { SessionRow } from "../session-chat/session-row.tsx";
import { ProjectTasks } from "./project-tasks.tsx";

const BREADCRUMB = [{ label: "Projects", href: "/projects" }];

const plural = (count: number, noun: string, plural = `${noun}s`): string =>
  `${count} ${count === 1 ? noun : plural}`;

// The renaming dialog behind the rename button. Owns its own field state,
// prefilled from the stored name each time it opens.
function RenameProjectModal({
  id,
  initialName,
  onClose,
}: {
  id: string;
  initialName: string;
  onClose: () => void;
}) {
  const rename = useRenameProject();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRename = async () => {
    setError(null);
    setPending(true);
    try {
      await rename(id, name.trim());
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  };

  return (
    <Modal title="Rename project" onClose={onClose}>
      {/* A form so Enter in the name field saves too; the guard mirrors the
          save button's disabled state, which Enter doesn't pass through. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || name.trim() === "") return;
          void handleRename();
        }}
        className="flex flex-col gap-4"
      >
        <TextInput value={name} onChange={setName} label="Name" />
        <div className="flex items-center justify-end gap-3">
          <Button variant="dismissive" disabled={pending} onClick={onClose}>
            cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={name.trim() === ""}
            pending={pending}
            pendingLabel="saving…"
          >
            save
          </Button>
        </div>
        {error ? (
          <p role="alert" className="font-mono text-xs text-status-failed">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

// The instructions editor behind the edit action: a roomy markdown field in a
// wide dialog, prefilled from the stored body each time it opens. Saving a
// blank body clears the project's instructions.
function EditInstructionsModal({
  id,
  initialInstructions,
  onClose,
}: {
  id: string;
  initialInstructions: string;
  onClose: () => void;
}) {
  const save = useSaveProjectInstructions();
  const [instructions, setInstructions] = useState(initialInstructions);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    setPending(true);
    try {
      await save(id, instructions);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  };

  return (
    <Modal title="Project instructions" size="lg" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Textarea
          value={instructions}
          onChange={setInstructions}
          label="Instructions"
          description="Markdown. Carried by every session in this project, from its next turn. Leave empty for none."
          rows={18}
        />
        <div className="flex items-center justify-end gap-3">
          <Button variant="dismissive" disabled={pending} onClick={onClose}>
            cancel
          </Button>
          <Button variant="primary" pending={pending} pendingLabel="saving…" onClick={handleSave}>
            save
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

function ProjectIndex<T>({
  noun,
  items,
  pending,
  error,
  hasNextPage,
  fetchingNextPage,
  fetchNextPage,
  empty,
  itemKey,
  renderItem,
}: {
  noun: string;
  items: T[];
  pending: boolean;
  error: Error | null;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  empty: ReactNode;
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}) {
  const stateRef = useRef({ fetchingNextPage, fetchNextPage });
  stateRef.current = { fetchingNextPage, fetchNextPage };
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!el) {
      observerRef.current = null;
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const current = stateRef.current;
      if (entries.some((entry) => entry.isIntersecting) && !current.fetchingNextPage) {
        void current.fetchNextPage();
      }
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  if (pending) return <LoadingState>Loading {noun}…</LoadingState>;
  if (error) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load {noun}: {error.message}
      </p>
    );
  }
  if (items.length === 0) return <>{empty}</>;

  return (
    <div>
      <ul className="space-y-6">
        {items.map((item) => (
          <li key={itemKey(item)}>{renderItem(item)}</li>
        ))}
      </ul>
      {hasNextPage ? (
        <div ref={sentinelRef} className="py-6 text-center">
          {fetchingNextPage ? (
            <output className="font-mono text-xs text-ink-muted uppercase tracking-widest">
              loading more {noun}…
            </output>
          ) : null}
        </div>
      ) : (
        <output className="block py-6 text-center font-mono text-xs text-ink-muted uppercase tracking-widest">
          end of {noun}
        </output>
      )}
    </div>
  );
}

function ProjectIndexes({ id, projectName, now }: { id: string; projectName: string; now?: Date }) {
  const sessions = useProjectSessionsFeed(id);
  const articles = useProjectArticlesFeed(id);

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div>
        <Eyebrow tone="muted">Sessions</Eyebrow>
        <div className="mt-3">
          <ProjectIndex
            noun="sessions"
            items={sessions.data ?? []}
            pending={sessions.isPending}
            error={sessions.error}
            hasNextPage={sessions.hasNextPage}
            fetchingNextPage={sessions.isFetchingNextPage}
            fetchNextPage={sessions.fetchNextPage}
            empty={
              <EmptyState>
                no sessions yet. sessions created in this project appear here and share its article
                corpus.
              </EmptyState>
            }
            itemKey={(session) => session.id}
            renderItem={(session) => <SessionRow session={session} now={now} context="scoped" />}
          />
        </div>
      </div>
      <div>
        <Eyebrow tone="muted">Articles</Eyebrow>
        <div className="mt-3">
          <ProjectIndex
            noun="articles"
            items={articles.data ?? []}
            pending={articles.isPending}
            error={articles.error}
            hasNextPage={articles.hasNextPage}
            fetchingNextPage={articles.isFetchingNextPage}
            fetchNextPage={articles.fetchNextPage}
            empty={
              <EmptyState>
                no articles yet. sessions in this project write their articles into this shared
                corpus.
              </EmptyState>
            }
            itemKey={(article) => article.slug}
            renderItem={(article) => (
              <ArticleRow
                article={{
                  ...article,
                  producer: { kind: "project", id, label: projectName },
                }}
                now={now}
                context="scoped"
              />
            )}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * One project's page: the container's session and article indexes side by
 * side, with its instructions, memories, and task list on their own tabs, its
 * name renameable through a modal, and the whole container
 * deletable behind a confirm that spells out the cascade. A 404 renders
 * not-found — the project may have been deleted in another tab. `now` is
 * injectable so tests render deterministic relative times.
 */
export function ProjectDetail({ id, now }: { id: string; now?: Date }) {
  const [, navigate] = useLocation();
  const project = useProjectOverview(id);
  const remove = useDeleteProject();
  const [pending, setPending] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
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

  // The container's four panels. Sessions and articles stay side by side on
  // the default tab; tasks, instructions, and memories each get their own —
  // tasks first, as the day-to-day surface — so the instructions body renders
  // in full rather than behind a disclosure and the task list only fetches
  // once its tab is opened.
  const tabs: TabDef[] = [
    {
      id: "sessions",
      label: "Sessions & articles",
      content: <ProjectIndexes id={id} projectName={data.project.name} now={now} />,
    },
    { id: "tasks", label: "Tasks", content: <ProjectTasks projectId={id} /> },
    {
      id: "instructions",
      label: "Instructions",
      content:
        data.project.instructions === null ? (
          <>
            <EmptyState>
              no instructions yet. what you write here joins the standing instructions of every
              session in this project.
            </EmptyState>
            <div className="-mx-3 mt-3 flex items-center">
              <Button variant="dismissive" onClick={() => setInstructionsOpen(true)}>
                edit instructions
              </Button>
            </div>
          </>
        ) : (
          <>
            <Prose>
              <Markdown content={data.project.instructions} />
            </Prose>
            <div className="-mx-3 mt-4 flex items-center">
              <Button variant="dismissive" onClick={() => setInstructionsOpen(true)}>
                edit instructions
              </Button>
            </div>
          </>
        ),
    },
    {
      id: "memories",
      label: "Memories",
      content:
        data.memories.length === 0 ? (
          <EmptyState>
            no memories yet. facts saved by this project's sessions land here and reach every
            session in the project, not the rest of the workspace.
          </EmptyState>
        ) : (
          <div className="-mt-2 divide-y divide-rule">
            {data.memories.map((memory) => (
              <div key={memory.name} className="py-3">
                {/* Details above the display face, the listing pages' rhythm. */}
                <Meta>
                  <span>updated {formatRelativeTime(memory.updatedAt, now)}</span>
                </Meta>
                <div className="mt-1">
                  <HeadlineLink
                    href={`/projects/${encodeURIComponent(id)}/memories/${encodeURIComponent(memory.name)}`}
                  >
                    {memory.name}
                  </HeadlineLink>
                </div>
                <p className="mt-1 font-mono text-sm text-ink-muted">{memory.description}</p>
              </div>
            ))}
          </div>
        ),
    },
  ];

  return (
    <section>
      <Breadcrumb items={BREADCRUMB} current={data.project.name} />
      <h2 className="mt-6 font-display text-4xl text-ink leading-tight">{data.project.name}</h2>
      {/* The container's own actions trail the byline as further meta items,
          picking up its middot separators. */}
      <div className="mt-2">
        <Meta>
          <span>created {formatRelativeTime(data.project.createdAt, now)}</span>
          <Button variant="dismissive" size="inline" onClick={() => setRenameOpen(true)}>
            rename project
          </Button>
          <Button
            variant="negative-quiet"
            size="inline"
            pending={pending}
            pendingLabel="deleting…"
            onClick={() => setConfirmOpen(true)}
          >
            delete project
          </Button>
        </Meta>
      </div>
      {error ? (
        <p role="alert" className="mt-2 font-mono text-xs text-status-failed">
          {error}
        </p>
      ) : null}
      <div className="mt-10">
        <Tabs tabs={tabs} label="Project details" />
      </div>
      {renameOpen ? (
        <RenameProjectModal
          id={id}
          initialName={data.project.name}
          onClose={() => setRenameOpen(false)}
        />
      ) : null}
      {instructionsOpen ? (
        <EditInstructionsModal
          id={id}
          initialInstructions={data.project.instructions ?? ""}
          onClose={() => setInstructionsOpen(false)}
        />
      ) : null}
      {confirmOpen ? (
        <ConfirmModal
          title="Delete this project?"
          body={`This deletes the whole container: ${plural(data.articleCount, "article")}, ${plural(data.memories.length, "memory", "memories")} and ${plural(data.sessionCount, "session")}, including everything those sessions own. This cannot be undone.`}
          confirmLabel="delete"
          variant="negative"
          onConfirm={handleDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </section>
  );
}
