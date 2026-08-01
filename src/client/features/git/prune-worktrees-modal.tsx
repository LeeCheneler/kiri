import { useState } from "react";
import type { PruneWorktreesResult, RepoOverview } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { List } from "../../design-system/content/list.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";

/**
 * The paths a prune would clear from `repo` — the records git still holds for
 * worktrees whose directories have gone. Empty when there is nothing stale, so
 * the prune affordance can be shown only when it has work to do.
 */
export const prunablePaths = (repo: RepoOverview): string[] =>
  repo.worktrees.filter((worktree) => worktree.prunable).map(({ path }) => path);

/** `N entry` / `N entries`, for counts stated in the dialog's copy. */
export const entries = (count: number): string => `${count} ${count === 1 ? "entry" : "entries"}`;

/**
 * Confirms clearing the stale worktree entries git still holds for `repo` —
 * records for worktrees whose directories have gone. Lists exactly what would be
 * cleared before anything runs. Housekeeping only: it removes no directory and
 * touches no branch. Opened from the banner that appears when something is
 * stale, so there is always something to list.
 *
 * The dialog stays open through the prune and swaps its confirmation for what
 * was cleared. A failure keeps the confirmation, with the reason beside the
 * actions. Built on the design-system `Modal`, so Escape and a backdrop click
 * route to `onClose`.
 */
export function PruneWorktreesModal({
  repo,
  onPrune,
  onClose,
}: {
  repo: RepoOverview;
  onPrune: (repo: string) => Promise<PruneWorktreesResult>;
  onClose: () => void;
}) {
  const paths = prunablePaths(repo);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cleared, setCleared] = useState<number | null>(null);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await onPrune(repo.name);
      setCleared(result.pruned.length);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Nothing was pruned.");
    } finally {
      setSubmitting(false);
    }
  };

  const done = (
    <div className="flex items-center justify-end">
      <Button variant="primary" onClick={onClose}>
        done
      </Button>
    </div>
  );

  return (
    <Modal title="prune stale entries" onClose={onClose}>
      {cleared === null ? (
        <div className="flex flex-col gap-5">
          <p className="font-mono text-ink-muted text-xs leading-relaxed">
            Git still holds records for these worktrees, whose directories have gone. Clearing them
            removes no directory and touches no branch.
          </p>
          <div>
            <Eyebrow tone="muted">{repo.name}</Eyebrow>
            <div className="mt-2 break-all font-mono text-ink text-xs">
              <List>
                {paths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </List>
            </div>
          </div>
          <div>
            {errorMessage ? (
              <p role="alert" className="mb-3 font-mono text-sm text-status-failed">
                {errorMessage}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-3">
              <Button variant="dismissive" onClick={onClose}>
                cancel
              </Button>
              <Button
                variant="primary"
                pending={submitting}
                pendingLabel="pruning…"
                onClick={() => void submit()}
              >
                prune
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Notice tone="informational" announce="polite" title={`Cleared ${entries(cleared)}`}>
            Git's records match what's on disk again.
          </Notice>
          {done}
        </div>
      )}
    </Modal>
  );
}
