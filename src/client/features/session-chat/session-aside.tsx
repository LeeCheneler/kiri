import { useState } from "react";
import { Button } from "../../design-system/actions/button.tsx";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";
import { useModels, useSession, useUpdateSession } from "../../state/sessions.ts";

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

// The session's name at the top of the rail: the stored title read-only (the
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
      {/* The negative margin re-aligns the borderless label with the rail's
          left edge, as the quiet foot actions do. */}
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

/**
 * The session chat rail's metadata: the session's title (read-only, renamed
 * through its edit action's dialog — a saved blank restores the untitled
 * fallback)
 * and the working directory (display-only). The model group — conversation
 * model, effort, image model — lives in the message composer's models popover
 * (`SessionModelControls`): it answers "what handles the next message", so it
 * sits where the message is typed. The session's vitals (context fill, start
 * time) live in `SessionVitals` below it. Reads the same shared session query
 * the chat body uses (no second fetch) and renders nothing until it resolves.
 */
export function SessionAside({ id }: { id: string }) {
  const detail = useSession(id).data;
  const { setTitle } = useUpdateSession(id);
  const modelFailures = useModels().data?.failures ?? [];
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
      {/* A delegated worker names the session that spawned it — the way back
          up to the conversation this one is working for. Mirrors the project
          link's lockup: a container, not one of the session's own facts. */}
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
        {/* A provider whose listing failed leaves a gap in the composer's
            pickers; the rail has the room to name it and why, so a missing
            model reads as a config issue, not an absence. */}
        {modelFailures.length > 0 ? (
          <div className="space-y-3">
            {modelFailures.map((failure) => (
              <Notice
                key={failure.provider}
                tone="negative"
                announce="polite"
                title={`${failure.provider} models unavailable`}
              >
                {failure.reason}
              </Notice>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
