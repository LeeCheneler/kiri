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
 * The outcome outlives the action: a checkout that pulls successfully stops
 * being behind and the button goes, so what happened is stated where the button
 * was rather than disappearing with it.
 */
export function CheckoutPull({ worktree }: { worktree: WorktreeStatus }) {
  const pull = usePullCheckout();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PullResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onPull = () => {
    setPending(true);
    setErrorMessage(null);
    pull(worktree.path)
      .then(setResult)
      .catch((error: unknown) =>
        setErrorMessage(error instanceof Error ? error.message : "Try again."),
      )
      .finally(() => setPending(false));
  };

  const offered = pullable(worktree);
  if (!offered && result === null && errorMessage === null) return null;

  const detail = result === null ? null : (result.reason ?? result.error);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {offered ? (
        <Button onClick={onPull} pending={pending} pendingLabel="Pulling…">
          Pull
        </Button>
      ) : null}
      {result === null ? null : (
        <span className="inline-flex flex-wrap items-center gap-2">
          <SyncTag status={result.status} />
          {result.status === "updated" ? (
            <span className="font-mono text-ink-muted text-xs">
              fast-forwarded {result.commits} {result.commits === 1 ? "commit" : "commits"}
            </span>
          ) : null}
          {detail === undefined || detail === null ? null : (
            <span
              className={`whitespace-pre-wrap break-words font-mono text-xs ${
                result.error === undefined ? "text-ink-muted" : "text-status-failed"
              }`}
            >
              {detail}
            </span>
          )}
        </span>
      )}
      {errorMessage === null ? null : (
        <span className="font-mono text-status-failed text-xs">{errorMessage}</span>
      )}
    </span>
  );
}
