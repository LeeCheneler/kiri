import { useState } from "react";
import type { PullResult, WorktreeStatus } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { usePullCheckout } from "../../state/git.ts";
import { SyncTag } from "./sync-outcome.tsx";

/**
 * Whether a fast-forward would actually land. The server refuses every other
 * case by name, and a pull here is `--ff-only` and never a merge, rebase, or
 * stash — so rather than offering a button that can only answer back, the action
 * simply isn't there. What is in the way is already on the checkout's own state
 * rail: dirty, ahead, upstream gone.
 */
const pullable = (worktree: WorktreeStatus): boolean =>
  worktree.behind > 0 &&
  worktree.ahead === 0 &&
  !worktree.dirty &&
  !worktree.detached &&
  !worktree.upstreamGone &&
  worktree.branch !== null;

/**
 * The pull for one checkout, alongside the checkout itself so the action never
 * drifts from what it acts on. Renders nothing at all when a fast-forward would
 * be refused — which is most of the time — so a page with nothing to pull says
 * nothing rather than spending a band on it.
 *
 * Inline-level throughout, so it sits in a checkout's card without a layout of
 * its own. Routine rather than destructive: it takes the ordinary outlined
 * button, leaving the solid negative treatment to the removal it sits beside.
 *
 * A pull that works says nothing: the button shows it working, then the checkout
 * is no longer behind and the action goes with it. What actually moved is on the
 * checkout's own state rail. Only a pull that did not happen reports itself —
 * a refusal with its reason, or git's own message.
 */
export function CheckoutPull({ worktree }: { worktree: WorktreeStatus }) {
  const pull = usePullCheckout();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<PullResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onPull = () => {
    setPending(true);
    setErrorMessage(null);
    pull(worktree.path)
      .then((result) =>
        setFailure(result.status === "refused" || result.status === "failed" ? result : null),
      )
      .catch((error: unknown) =>
        setErrorMessage(error instanceof Error ? error.message : "Try again."),
      )
      .finally(() => setPending(false));
  };

  const offered = pullable(worktree);
  if (!offered && failure === null && errorMessage === null) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {offered ? (
        <Button onClick={onPull} pending={pending} pendingLabel="Pulling…">
          Pull
        </Button>
      ) : null}
      {failure === null ? null : (
        <span className="inline-flex flex-wrap items-center gap-2">
          <SyncTag status={failure.status} />
          <span
            className={`whitespace-pre-wrap break-words font-mono text-xs ${
              failure.error === undefined ? "text-ink-muted" : "text-status-failed"
            }`}
          >
            {failure.reason ?? failure.error}
          </span>
        </span>
      )}
      {errorMessage === null ? null : (
        <span className="font-mono text-status-failed text-xs">{errorMessage}</span>
      )}
    </span>
  );
}
