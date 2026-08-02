import { useState } from "react";
import type { PullResult, RepoConflicts, RepoOverview, WorktreeStatus } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Tag } from "../../design-system/content/tag.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Card } from "../../design-system/surfaces/card.tsx";
import { useCreateWorktree, usePruneWorktrees, useRemoveWorktree } from "../../state/git.ts";
import { ChangesLink } from "./changes-link.tsx";
import { CreateWorktreeModal } from "./create-worktree-modal.tsx";
import { PruneWorktreesModal, entries, prunablePaths } from "./prune-worktrees-modal.tsx";
import { RemoveWorktreeModal } from "./remove-worktree-modal.tsx";
import { RepoSection } from "./repo-section.tsx";
import { SyncFailure } from "./sync-outcome.tsx";
import { branchLabel, conflictSummary, dirName, stateTags } from "./worktree-state.ts";

// One checkout, in a card of its own: what it is called and the state rail that
// says what you would do with it, its branch and the way into its changes under
// that, and the actions it takes held out to the right of all three.
//
// The card is what ties the action to the checkout. Right-aligning alone works
// at laptop width and fails at desktop width, where the buttons pull away into a
// column of their own with an ocean of space between each one and the worktree
// it acts on — on a destructive action that is a misclick waiting to happen. The
// card's border draws the row's extent, so the remove is unambiguously inside
// one worktree's box rather than floating in space shared with its neighbours.
// The action itself takes the destructive variant, solid at rest rather than
// lighting up on hover, so what it does is legible before it is touched.
//
// The primary checkout takes the same card as every linked one, marked by a tag
// and offered no removal: it is the repo, and git refuses to remove it. Giving
// it the shape the others have is what puts its state and its changes where a
// reader already knows to look for them — and it is updated with the rest, since
// moving the branch a worktree was cut from is the point of updating a repo.
//
// `failure` is the last update's reason for leaving this checkout where it was.
// It renders with the checkout's own identity rather than in the action cluster:
// a refusal is a sentence, and a sentence in a column of buttons pulls the
// buttons around — and so does the conflict summary below it, for the same
// reason.
//
// The state rail belongs on the row it describes: it is a readout, not an
// action, so keeping it with the checkout's name is what makes it readable at
// any width. The rule about a justified action drifting from what it acts on is
// about the remove button on the far side, not about status.
function CheckoutRow({
  repo,
  worktree,
  base,
  files,
  failure,
  onRemove,
}: {
  repo: RepoOverview;
  worktree: WorktreeStatus;
  /** The ref this checkout's branch was merged into; null when there was none. */
  base: string | null;
  /** Files that merge would conflict in; undefined when there is no answer. */
  files?: string[];
  failure?: PullResult;
  onRemove?: () => void;
}) {
  const summary = conflictSummary(base, files);
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-mono text-ink text-sm">
            {dirName(worktree.path)}
            {worktree.primary ? <Tag tone="accent">primary</Tag> : null}
            {stateTags(worktree, repo.defaultBranch, files).map((tag) => (
              <Tag key={tag.label} tone={tag.tone}>
                {tag.label}
              </Tag>
            ))}
          </p>
          <p className="mt-1 font-mono text-ink-muted text-xs">{branchLabel(worktree)}</p>
          {/* Which files a conflict is in, with the checkout it is about — the
              tag says there is one, this says what it would cost to sort out. */}
          {summary === null ? null : (
            <p className="mt-1 font-mono text-status-failed text-xs">{summary}</p>
          )}
          {/* The way into this checkout's changes sits with the checkout's own
              identity, well clear of the destructive action on the far side. */}
          <p className="mt-2 font-mono text-xs">
            <ChangesLink repo={repo} worktree={worktree} />
          </p>
          {failure === undefined ? null : (
            <p className="mt-2">
              <SyncFailure result={failure} />
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {onRemove === undefined ? null : (
            <Button variant="negative" onClick={onRemove}>
              remove
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * A repo's checkouts and the whole lifecycle around its worktrees: creating one,
 * removing one, and — when git is holding records for worktrees whose
 * directories have gone — clearing those stale entries from the banner that
 * announces them. The primary checkout leads the list, tagged as such and with
 * no removal offered, so every checkout carries its state and its actions in the
 * same shape rather than the repo's own being read somewhere else.
 *
 * Every operation runs through a confirming dialog and invalidates the shared
 * overview when it lands, so the section reflects the server's model rather than
 * an optimistic guess at it.
 */
export function WorktreesSection({
  repo,
  conflicts,
  failures = [],
}: {
  repo: RepoOverview;
  /** Whether each linked worktree's branch still merges into the default branch. */
  conflicts?: RepoConflicts;
  /** What the last update could not do, per checkout. */
  failures?: PullResult[];
}) {
  const create = useCreateWorktree();
  const remove = useRemoveWorktree();
  const prune = usePruneWorktrees();
  const [creating, setCreating] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [removing, setRemoving] = useState<WorktreeStatus | null>(null);

  const linked = repo.worktrees.filter((worktree) => !worktree.primary);
  // The primary leads, whatever order the scan reported the checkouts in.
  const checkouts = [...repo.worktrees.filter((worktree) => worktree.primary), ...linked];
  // The prune action only exists when something is actually stale, so nobody has
  // to click a button to find out there was nothing to do.
  const stale = prunablePaths(repo).length;

  return (
    <RepoSection
      title="Worktrees"
      action={
        <Button variant="primary" onClick={() => setCreating(true)}>
          New worktree
        </Button>
      }
    >
      {stale > 0 ? (
        // The action hugs the notice it belongs to rather than being pushed to
        // the far edge, for the same reason the rows are carded: across a wide
        // container a justified action drifts away from what it acts on.
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <Notice tone="warning" title={`${entries(stale)} to clear`}>
            Git still holds records for worktrees whose directories have gone.
          </Notice>
          <Button onClick={() => setPruning(true)}>Review and prune</Button>
        </div>
      ) : null}
      {/* Tight enough that a stack of cards still reads as one list rather than
          a series of unrelated panels. */}
      <ul className="space-y-3">
        {checkouts.map((worktree) => (
          <li key={worktree.path}>
            <CheckoutRow
              repo={repo}
              worktree={worktree}
              base={conflicts?.base ?? null}
              files={conflicts?.worktrees.find((entry) => entry.path === worktree.path)?.files}
              failure={failures.find((failure) => failure.path === worktree.path)}
              onRemove={worktree.primary ? undefined : () => setRemoving(worktree)}
            />
          </li>
        ))}
      </ul>
      {linked.length === 0 ? (
        <div className="mt-4">
          <EmptyState>
            This repo is just its own checkout. Create a worktree to start a piece of work beside
            it.
          </EmptyState>
        </div>
      ) : null}
      {creating ? (
        <CreateWorktreeModal repo={repo} onCreate={create} onClose={() => setCreating(false)} />
      ) : null}
      {removing ? (
        <RemoveWorktreeModal
          worktree={removing}
          onRemove={remove}
          onClose={() => setRemoving(null)}
        />
      ) : null}
      {pruning ? (
        <PruneWorktreesModal repo={repo} onPrune={prune} onClose={() => setPruning(false)} />
      ) : null}
    </RepoSection>
  );
}
