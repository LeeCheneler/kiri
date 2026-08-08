import { useState } from "react";
import { useLocation } from "wouter";
import { ApiError } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { ConfirmModal } from "../../design-system/surfaces/confirm-modal.tsx";

/**
 * The quiet delete action at the foot of an article page, shared by the
 * session- and project-owned readers (run articles are immutable and never
 * offer it). Confirms, runs the caller's deleter, and navigates to
 * `returnTo` — the owning session or project — treating a 404 as already
 * deleted. Failures surface inline and stay on the page.
 */
export function DeleteArticleButton({
  onDelete,
  returnTo,
}: {
  onDelete: () => Promise<void>;
  returnTo: string;
}) {
  const [, navigate] = useLocation();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setConfirmOpen(false);
    setError(null);
    setPending(true);
    try {
      await onDelete();
    } catch (cause) {
      // Already gone — intent satisfied, fall through and navigate. Anything
      // else surfaces inline and leaves us on the page.
      if (!(cause instanceof ApiError) || cause.status !== 404) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setPending(false);
        return;
      }
    }
    navigate(returnTo);
  };

  return (
    <>
      <div className="-mx-3">
        <Button
          variant="negative-quiet"
          pending={pending}
          pendingLabel="deleting…"
          onClick={() => setConfirmOpen(true)}
        >
          delete article
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 font-mono text-xs text-status-failed">
          {error}
        </p>
      ) : null}
      {confirmOpen ? (
        <ConfirmModal
          title="Delete this article?"
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
