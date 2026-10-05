import { useState } from "react";
import { Button } from "../../design-system/actions/button.tsx";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useSession, useUpdateSession } from "../../state/sessions.ts";

// The rename dialog: a single title field seeded from the stored title, saved
// from the footer action or Enter (the form catches the submit). A saved
// blank clears the title back to the untitled fallback; a saved no-change is
// dropped rather than PATCHed. Escape, backdrop, and cancel all abandon the
// edit; the native dialog hands focus back to the edit action either way.
function RenameSessionModal({
  title,
  onCommit,
  onClose,
}: {
  title: string | null;
  onCommit: (title: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(title ?? "");
  const save = () => {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next !== (title ?? null)) onCommit(next);
    onClose();
  };
  return (
    <Modal title="Rename session" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col"
      >
        <TextInput
          label="Title"
          value={draft}
          onChange={setDraft}
          placeholder="Name this session…"
        />
        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="dismissive" onClick={onClose}>
            cancel
          </Button>
          <Button type="submit" variant="primary">
            save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// The session's name in Details: the stored title read-only (the
// short id stands in for an untitled session), with a quiet edit action under
// it that opens the rename dialog.
function SessionTitle({
  title,
  fallback,
  onCommit,
}: {
  title: string | null;
  fallback: string;
  onCommit: (title: string | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-xs tracking-widest text-ink-muted uppercase">Title</span>
      {title !== null ? (
        <p className="break-words font-display text-ink text-lg leading-snug">{title}</p>
      ) : (
        <p className="font-mono text-ink-muted text-sm">{fallback}</p>
      )}
      {/* Align the padded button label with the metadata above it. */}
      <div className="-mx-3 self-start">
        <Button variant="dismissive" onClick={() => setRenaming(true)}>
          edit title
        </Button>
      </div>
      {renaming ? (
        <RenameSessionModal title={title} onCommit={onCommit} onClose={() => setRenaming(false)} />
      ) : null}
    </div>
  );
}

/** Session details: editable title, parent navigation, read-only directory and start time. */
export function SessionAside({ id }: { id: string }) {
  const detail = useSession(id).data;
  const { setTitle } = useUpdateSession(id);
  if (!detail) return null;
  const { session } = detail;

  return (
    <div className="space-y-8">
      {/* Renaming never touches the turn, so — like pinning — it stays
          available while one is in flight. */}
      <SessionTitle
        title={session.title}
        fallback={session.id.slice(0, 8)}
        onCommit={(title) => void setTitle(title)}
      />
      {/* A delegated worker keeps a route back to the conversation that spawned it. */}
      {detail.parent ? (
        <section>
          <Eyebrow tone="muted">Parent</Eyebrow>
          <div className="mt-1.5 text-sm">
            <HeadlineLink href={`/sessions/${detail.parent.id}`}>
              {detail.parent.label}
            </HeadlineLink>
          </div>
        </section>
      ) : null}
      <section className="space-y-4">
        {/* Where the session is working. Display-only by design: the
            assistant moves the directory through its own sandbox-validated
            tool, and the app offers no path entry to get wrong. */}
        {session.cwd ? (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-xs tracking-widest text-ink-muted uppercase">
              Working directory
            </span>
            <p className="break-all font-mono text-xs text-ink">{session.cwd}</p>
          </div>
        ) : null}
        <Meta>
          <span>started {formatRelativeTime(session.startedAt)}</span>
        </Meta>
      </section>
    </div>
  );
}
