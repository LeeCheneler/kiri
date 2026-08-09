import { useState } from "react";
import { useLocation } from "wouter";
import { ApiError, deleteSession } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { ConfirmModal } from "../../design-system/surfaces/confirm-modal.tsx";
import { useSession } from "../../state/sessions.ts";
import { clearSessionDraft } from "./session-draft.ts";

/**
 * The chat right rail's delete control. Confirms, removes the session and its
 * messages, then returns to the session list — a 404 counts as already-deleted
 * (another tab, a stale view), so it still navigates. Disabled while a turn is
 * in flight, since the server refuses to remove a running session. Failures
 * surface inline. Reads the same shared session query the chat and aside use,
 * so it adds no fetch and renders nothing until that resolves.
 */
export function SessionActions({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const detail = useSession(id).data;
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!detail) return null;
  const running = detail.session.status === "running";

  const handleDelete = async () => {
    setConfirmOpen(false);
    setError(null);
    setPending(true);
    try {
      await deleteSession(id);
    } catch (cause) {
      // Already gone — intent satisfied, fall through and navigate. Anything
      // else surfaces inline and leaves us on the page.
      if (!(cause instanceof ApiError) || cause.status !== 404) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setPending(false);
        return;
      }
    }
    // The session (or its already-deleted remains) is gone — drop any unsent
    // draft we were holding for it before leaving. A project session returns
    // home to its project; a projectless one to the session list.
    clearSessionDraft(id);
    navigate(
      detail.session.projectId !== null
        ? `/projects/${encodeURIComponent(detail.session.projectId)}`
        : "/?view=sessions",
    );
  };

  return (
    <>
      <div className="flex flex-col items-start gap-1">
        {/* A quiet text action: a rare, considered move that shouldn't
            compete with the rail's controls. It still confirms — and only
            shows its red on approach. The negative margin re-aligns the
            borderless label with the rail's left edge. */}
        <div className="-mx-3 flex items-center">
          <Button
            variant="negative-quiet"
            pending={pending}
            pendingLabel="deleting…"
            disabled={running}
            title={running ? "a turn is in flight; cancel it first" : undefined}
            onClick={() => setConfirmOpen(true)}
          >
            delete session
          </Button>
        </div>
        {error ? (
          <p role="alert" className="font-mono text-xs text-status-failed">
            {error}
          </p>
        ) : null}
      </div>
      {confirmOpen ? (
        <ConfirmModal
          title="Delete this session?"
          body="This cannot be undone."
          confirmLabel="delete"
          variant="negative"
          onConfirm={handleDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </>
  );
}
