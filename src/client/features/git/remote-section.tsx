import { useState } from "react";
import type { FetchResult, PullResult, RepoOverview, WorktreeStatus } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Tag } from "../../design-system/content/tag.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Card } from "../../design-system/surfaces/card.tsx";
import { useFetchRepo, usePullCheckout } from "../../state/git.ts";
import { RepoSection } from "./repo-section.tsx";
import { FetchReport, PullReport } from "./sync-outcome.tsx";
import { branchLabel, dirName } from "./worktree-state.ts";

/**
 * Why a checkout that is behind still cannot be fast-forwarded, or null when it
 * can. The server refuses these too — this is what keeps the action off screen
 * where it could only ever be refused, so nobody is offered a button that
 * answers back.
 */
const blockedReason = (worktree: WorktreeStatus): string | null => {
  if (worktree.ahead > 0) {
    return `Diverged — ${worktree.ahead} ahead of its upstream as well as behind it. Merge or rebase it yourself.`;
  }
  if (worktree.dirty) return "Uncommitted changes. Commit or stash them, then pull.";
  return null;
};

// One checkout that has commits waiting on its upstream, with the pull held
// inside its own card so the action stays beside the checkout it acts on rather
// than drifting to the far edge of a wide page.
function BehindRow({
  worktree,
  pending,
  onPull,
}: {
  worktree: WorktreeStatus;
  pending: boolean;
  onPull: () => void;
}) {
  const blocked = blockedReason(worktree);
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-mono text-ink text-sm">
            {dirName(worktree.path)}
            {worktree.primary ? <Tag>primary</Tag> : null}
            <Tag tone="caution">behind {worktree.behind}</Tag>
          </p>
          <p className="mt-1 font-mono text-ink-muted text-xs">{branchLabel(worktree)}</p>
        </div>
        {blocked === null ? (
          <div className="shrink-0">
            <Button variant="primary" onClick={onPull} pending={pending} pendingLabel="Pulling…">
              Pull
            </Button>
          </div>
        ) : null}
      </div>
      {blocked === null ? null : <p className="mt-3 font-mono text-ink-muted text-xs">{blocked}</p>}
    </Card>
  );
}

/**
 * A repo's standing with its remote: fetching it, and fast-forwarding whatever
 * that fetch leaves behind.
 *
 * Nothing in the read path fetches, so the ahead/behind counts the rest of the
 * page shows are measured against remote-tracking refs that are only as current
 * as the last fetch — a checkout can read as level while being twenty commits
 * behind. One fetch per repo serves all its worktrees, since they share an
 * object store, so it is offered once here rather than per checkout.
 *
 * Only checkouts actually behind their upstream are listed: everything else has
 * nothing to pull. A checkout that is behind but dirty, or behind and also
 * ahead, is listed without the action and with the reason it cannot be
 * fast-forwarded — a pull here is `--ff-only` and never a merge, so the decision
 * stays with the user and their terminal.
 */
export function RemoteSection({ repo }: { repo: RepoOverview }) {
  const fetchRepo = useFetchRepo();
  const pull = usePullCheckout();
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState<FetchResult | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pulls, setPulls] = useState<PullResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const failed = (error: unknown) =>
    setErrorMessage(error instanceof Error ? error.message : "Try again.");

  const onFetch = () => {
    setFetching(true);
    setErrorMessage(null);
    fetchRepo(repo.name)
      .then(setFetched)
      .catch(failed)
      .finally(() => setFetching(false));
  };

  const onPull = (path: string) => {
    setPulling(path);
    setErrorMessage(null);
    pull(path)
      .then((result) =>
        setPulls((current) => [...current.filter((done) => done.path !== path), result]),
      )
      .catch(failed)
      .finally(() => setPulling(null));
  };

  const behind = repo.worktrees.filter((worktree) => worktree.behind > 0);

  return (
    <RepoSection
      title="Remote"
      action={
        <Button onClick={onFetch} pending={fetching} pendingLabel="Fetching…">
          Fetch
        </Button>
      }
    >
      <div className="space-y-5">
        {errorMessage ? (
          <Notice tone="negative" announce="polite" title="Couldn't reach the server">
            {errorMessage}
          </Notice>
        ) : null}
        {fetched ? <FetchReport results={[fetched]} /> : null}
        {pulls.length > 0 ? <PullReport results={pulls} /> : null}
        {behind.length === 0 ? (
          <EmptyState>
            Nothing is behind its upstream. Fetch to check the remote for new commits.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {behind.map((worktree) => (
              <li key={worktree.path}>
                <BehindRow
                  worktree={worktree}
                  pending={pulling === worktree.path}
                  onPull={() => onPull(worktree.path)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </RepoSection>
  );
}
