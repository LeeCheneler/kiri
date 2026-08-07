import { useState } from "react";
import { useLocation } from "wouter";
import { ApiError } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { Textarea } from "../../design-system/actions/textarea.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { ConfirmModal } from "../../design-system/surfaces/confirm-modal.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useDeleteMemory, useMemory, useUpdateMemory } from "../../state/memories.ts";

const BREADCRUMB = [{ label: "Memories", href: "/memories" }];

/**
 * One memory's curation page: the fact rendered as markdown with its summary
 * and freshness, editable in place (summary and body together), and deletable
 * behind a confirm. Edits persist through the REST surface and re-render from
 * the server's truth; deleting returns to the index. A 404 renders not-found
 * — the memory may have been deleted by a session in another tab. `now` is
 * injectable so tests render deterministic relative times.
 */
export function MemoryDetail({ name, now }: { name: string; now?: Date }) {
  const [, navigate] = useLocation();
  const memory = useMemory(name);
  const update = useUpdateMemory();
  const remove = useDeleteMemory();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (memory.isPending) return <LoadingState>Loading memory…</LoadingState>;
  if (memory.isError) {
    if (memory.error instanceof ApiError && memory.error.status === 404) {
      return (
        <section>
          <Breadcrumb items={BREADCRUMB} current="Not found" />
          <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Memory not found</h2>
          <p className="mt-3 font-mono text-sm text-ink-muted">
            No memory named <code className="text-ink">{name}</code>.
          </p>
        </section>
      );
    }
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load memory: {memory.error.message}
      </p>
    );
  }

  const data = memory.data;

  const startEditing = () => {
    setDescription(data.description);
    setBody(data.contentMd);
    setError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    setError(null);
    setPending(true);
    try {
      await update(name, { description, contentMd: body });
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
      await remove(name);
    } catch (cause) {
      // Already gone — intent satisfied, fall through and navigate. Anything
      // else surfaces inline and leaves us on the page.
      if (!(cause instanceof ApiError) || cause.status !== 404) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setPending(false);
        return;
      }
    }
    navigate("/memories");
  };

  return (
    <section>
      <Breadcrumb items={BREADCRUMB} current={name} />
      <h2 className="mt-6 font-display text-4xl text-ink leading-tight">{name}</h2>
      {editing ? (
        <div className="mt-6 flex flex-col gap-4">
          <TextInput
            value={description}
            onChange={setDescription}
            label="Summary"
            description="One line, shown in the memory index every session sees."
          />
          <Textarea
            value={body}
            onChange={setBody}
            label="Memory"
            description="Markdown. The full fact, loaded into a conversation on recall."
            rows={10}
          />
          <div className="flex items-center gap-3">
            <Button variant="primary" pending={pending} pendingLabel="saving…" onClick={handleSave}>
              save
            </Button>
            <Button variant="dismissive" disabled={pending} onClick={() => setEditing(false)}>
              cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 font-mono text-sm text-ink-muted">{data.description}</p>
          <div className="mt-2">
            <Meta>
              <span>updated {formatRelativeTime(data.updatedAt, now)}</span>
            </Meta>
          </div>
          <div className="mt-8">
            <Markdown content={data.contentMd} />
          </div>
          <div className="-mx-3 mt-8 flex items-center">
            <Button variant="dismissive" onClick={startEditing}>
              edit memory
            </Button>
            <Button
              variant="negative-quiet"
              pending={pending}
              pendingLabel="deleting…"
              onClick={() => setConfirmOpen(true)}
            >
              delete memory
            </Button>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="mt-3 font-mono text-xs text-status-failed">
          {error}
        </p>
      ) : null}
      {confirmOpen ? (
        <ConfirmModal
          title="Delete this memory?"
          body="Future sessions will no longer recall it. This cannot be undone."
          confirmLabel="delete"
          variant="negative"
          onConfirm={handleDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </section>
  );
}
