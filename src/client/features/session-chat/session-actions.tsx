import { useState } from "react";
import { useLocation } from "wouter";
import { ApiError, deleteSession } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { useSession } from "../../state/sessions.ts";

/**
 * Session-level controls for the chat right rail. Deleting confirms, removes the
 * session and its messages, then returns to the session list — a 404 counts as
 * already-deleted (another tab, a stale view), so it still navigates. Delete is
 * disabled while a turn is in flight, since the server refuses to remove a
 * running session; it must be cancelled first. Failures surface inline. Reads
 * the same shared session query the chat and aside use, so it adds no fetch and
 * renders nothing until that resolves.
 */
export function SessionActions({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const detail = useSession(id).data;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!detail) return null;
  const running = detail.session.status === "running";

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
    navigate("/?view=sessions");
  };

  return (
    <div className="flex flex-col items-start gap-2">
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
