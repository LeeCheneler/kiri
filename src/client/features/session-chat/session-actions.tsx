import { useState } from "react";
import { useLocation } from "wouter";
import { ApiError, deleteSession } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { useSession, useUpdateSession } from "../../state/sessions.ts";
import { clearSessionDraft } from "./session-draft.ts";

/**
 * Session-level controls for the chat right rail: pin/unpin and delete.
 * Pinning toggles the session onto the feed's Pinned tab; the PATCH result
 * lands straight in the cached detail, so the label flips at once. Deleting
 * confirms, removes the session and its messages, then returns to the session
 * list — a 404 counts as already-deleted (another tab, a stale view), so it
 * still navigates. Delete is disabled while a turn is in flight, since the
 * server refuses to remove a running session; pinning stays available — it
 * never touches the turn. Failures from either action surface inline. Reads
 * the same shared session query the chat and aside use, so it adds no fetch
 * and renders nothing until that resolves.
 */
export function SessionActions({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const detail = useSession(id).data;
  const { setPinned } = useUpdateSession(id);
  const [pending, setPending] = useState(false);
  const [pinPending, setPinPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!detail) return null;
  const running = detail.session.status === "running";
  const pinned = detail.session.pinned;

  const handlePinToggle = async () => {
    setError(null);
    setPinPending(true);
    try {
      await setPinned(!pinned);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPinPending(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this session? This cannot be undone.")) return;
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
    // draft we were holding for it before leaving.
    clearSessionDraft(id);
    navigate("/?view=sessions");
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        pending={pinPending}
        pendingLabel={pinned ? "unpinning…" : "pinning…"}
        onClick={handlePinToggle}
      >
        {pinned ? "unpin session" : "pin session"}
      </Button>
      <Button
        variant="negative"
        pending={pending}
        pendingLabel="deleting…"
        disabled={running}
        title={running ? "a turn is in flight; cancel it first" : undefined}
        onClick={handleDelete}
      >
        delete session
      </Button>
      {error ? (
        <p role="alert" className="font-mono text-xs text-status-failed">
          {error}
        </p>
      ) : null}
    </div>
  );
}
