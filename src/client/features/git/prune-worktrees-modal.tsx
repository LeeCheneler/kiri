import { useState } from "react";
import type { PruneWorktreesResult, RepoOverview } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { List } from "../../design-system/content/list.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";

/** A repo with the stale entries a prune would clear from it. */
export interface PruneTarget {
  repo: string;
  paths: string[];
}

/**
 * The repos holding stale worktree entries, with the paths a prune would clear
 * from each. Repos with nothing stale are left out entirely, so an empty result
 * means there is nothing to prune anywhere.
 */
export const pruneTargets = (repos: RepoOverview[]): PruneTarget[] =>
  repos
    .map((repo) => ({
      repo: repo.name,
      paths: repo.worktrees.filter((worktree) => worktree.prunable).map(({ path }) => path),
    }))
    .filter((target) => target.paths.length > 0);

const entries = (count: number): string => `${count} ${count === 1 ? "entry" : "entries"}`;

/**
 * Confirms clearing the stale worktree entries git still holds — records for
 * worktrees whose directories have gone. Lists exactly what would be cleared,
 * grouped by repo, before anything runs. Housekeeping only: it removes no
 * directory and touches no branch. Opened from the banner that appears when
 * something is stale, so there is always something to list.
 *
 * The dialog stays open through the prune and swaps its confirmation for what
 * was cleared. A failure keeps the confirmation, with the reason beside the
 * actions. Built on the design-system `Modal`, so Escape and a backdrop click
 * route to `onClose`.
 */
export function PruneWorktreesModal({
  repos,
  onPrune,
  onClose,
}: {
  repos: RepoOverview[];
  onPrune: (repo: string) => Promise<PruneWorktreesResult>;
  onClose: () => void;
}) {
  const targets = pruneTargets(repos);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cleared, setCleared] = useState<number | null>(null);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      let total = 0;
      // One call per repo, in listing order, so a failure names the repo it
      // stopped at and the repos already cleared stay cleared.
      for (const target of targets) {
        const result = await onPrune(target.repo);
        total += result.pruned.length;
      }
      setCleared(total);
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
          {targets.map((target) => (
            <div key={target.repo}>
              <Eyebrow tone="muted">{target.repo}</Eyebrow>
              <div className="mt-2 break-all font-mono text-ink text-xs">
                <List>
                  {target.paths.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </List>
              </div>
            </div>
          ))}
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
