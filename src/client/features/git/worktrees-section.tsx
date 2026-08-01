import { useState } from "react";
import type { RepoOverview, WorktreeStatus } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Tag } from "../../design-system/content/tag.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { useCreateWorktree, usePruneWorktrees, useRemoveWorktree } from "../../state/git.ts";
import { CreateWorktreeModal } from "./create-worktree-modal.tsx";
import { PruneWorktreesModal, entries, prunablePaths } from "./prune-worktrees-modal.tsx";
import { RemoveWorktreeModal } from "./remove-worktree-modal.tsx";
import { RepoSection } from "./repo-section.tsx";
import { branchLabel, dirName, stateTags } from "./worktree-state.ts";

// One linked worktree: what it is called and the state rail that says what you
// would do with it, its branch under that, and the removal that tidies it away
// held out to the right of both. The action sits clear of the tag rail rather
// than trailing it — tags are non-interactive by definition, and an action at
// the end of a run of them reads as one more label. It takes the destructive
// variant, solid at rest rather than lighting up on hover, so what it does is
// legible before it is touched.
function WorktreeRow({ worktree, onRemove }: { worktree: WorktreeStatus; onRemove: () => void }) {
  return (
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
      </div>
      <div className="shrink-0">
        <Button variant="negative" onClick={onRemove}>
          remove
        </Button>
      </div>
    </div>
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
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
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
        <ul className="space-y-4">
          {linked.map((worktree) => (
            <li key={worktree.path}>
              <WorktreeRow worktree={worktree} onRemove={() => setRemoving(worktree)} />
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
