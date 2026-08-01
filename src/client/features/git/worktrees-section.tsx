import { useState } from "react";
import type { RepoOverview, WorktreeStatus } from "../../api.ts";
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
import { branchLabel, dirName, stateTags } from "./worktree-state.ts";

// One linked worktree, in a card of its own: what it is called and the state
// rail that says what you would do with it, its branch and the way into its
// changes under that, and the removal that tidies it away held out to the right
// of all three.
//
// The card is what ties the action to the worktree. Right-aligning alone works
// at laptop width and fails at desktop width, where the buttons pull away into a
// column of their own with an ocean of space between each one and the worktree
// it acts on — on a destructive action that is a misclick waiting to happen. The
// card's border draws the row's extent, so the remove is unambiguously inside
// one worktree's box rather than floating in space shared with its neighbours.
// The action itself takes the destructive variant, solid at rest rather than
// lighting up on hover, so what it does is legible before it is touched.
function WorktreeRow({
  repo,
  worktree,
  onRemove,
}: {
  repo: RepoOverview;
  worktree: WorktreeStatus;
  onRemove: () => void;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-mono text-ink text-sm">
            {dirName(worktree.path)}
            {stateTags(worktree).map((tag) => (
              <Tag key={tag.label} tone={tag.tone}>
                {tag.label}
              </Tag>
            ))}
          </p>
          <p className="mt-1 font-mono text-ink-muted text-xs">{branchLabel(worktree)}</p>
          {/* The way into this worktree's changes sits with the worktree's own
              identity, well clear of the destructive action on the far side. */}
          <p className="mt-2 font-mono text-xs">
            <ChangesLink repo={repo} worktree={worktree} />
          </p>
        </div>
        <div className="shrink-0">
          <Button variant="negative" onClick={onRemove}>
            remove
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * A repo's linked worktrees and the whole lifecycle around them: creating one,
 * removing one, and — when git is holding records for worktrees whose
 * directories have gone — clearing those stale entries from the banner that
 * announces them. The primary checkout is not listed here; it is the repo, and
 * the page header already states where it is and what state it is in.
 *
 * Every operation runs through a confirming dialog and invalidates the shared
 * overview when it lands, so the section reflects the server's model rather than
 * an optimistic guess at it.
 */
export function WorktreesSection({ repo }: { repo: RepoOverview }) {
  const create = useCreateWorktree();
  const remove = useRemoveWorktree();
  const prune = usePruneWorktrees();
  const [creating, setCreating] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [removing, setRemoving] = useState<WorktreeStatus | null>(null);

  const linked = repo.worktrees.filter((worktree) => !worktree.primary);
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
      {linked.length === 0 ? (
        <EmptyState>
          This repo is just its own checkout. Create a worktree to start a piece of work beside it.
        </EmptyState>
      ) : (
        // Tight enough that a stack of cards still reads as one list rather
        // than a series of unrelated panels.
        <ul className="space-y-3">
          {linked.map((worktree) => (
            <li key={worktree.path}>
              <WorktreeRow repo={repo} worktree={worktree} onRemove={() => setRemoving(worktree)} />
            </li>
          ))}
        </ul>
      )}
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
