import { useState } from "react";
import type { RepoOverview, WorktreeStatus } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Code } from "../../design-system/content/code.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { Card } from "../../design-system/surfaces/card.tsx";
import { useRefreshWorktrees, useWorktrees } from "../../state/worktrees.ts";

// Trailing directory name of an absolute path — what a worktree is known by in
// conversation ("kiri-feat-search"), with the full path kept alongside it.
const dirName = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

// The worktree's position relative to its upstream, as short mono facts. A
// branch with no upstream reports nothing, so a clean tracking branch reads as
// silence rather than a row of zeroes.
const trackingFacts = (worktree: WorktreeStatus): string[] => {
  if (worktree.upstreamGone) return ["upstream gone"];
  const facts: string[] = [];
  if (worktree.ahead > 0) facts.push(`ahead ${worktree.ahead}`);
  if (worktree.behind > 0) facts.push(`behind ${worktree.behind}`);
  return facts;
};

// One worktree: what it is called, where its branch sits, and the flags that
// change what you would do with it.
function WorktreeRow({ worktree }: { worktree: WorktreeStatus }) {
  const facts = [
    ...trackingFacts(worktree),
    ...(worktree.dirty ? ["dirty"] : []),
    ...(worktree.locked ? ["locked"] : []),
    ...(worktree.prunable ? ["prunable"] : []),
  ];
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="font-mono text-ink text-sm">
          {dirName(worktree.path)}
          {worktree.primary ? (
            <span className="ml-2 text-ink-muted text-xs uppercase tracking-widest">primary</span>
          ) : null}
        </p>
        <p className="mt-0.5 font-mono text-ink-muted text-xs">
          {worktree.detached ? "detached" : (worktree.branch ?? "no branch")}
        </p>
      </div>
      <div className="shrink-0">
        <Meta>
          {facts.length === 0 ? (
            <span>clean</span>
          ) : (
            facts.map((fact) => <span key={fact}>{fact}</span>)
          )}
        </Meta>
      </div>
    </div>
  );
}

// One repo: its name and primary path above the checkouts that share its git
// directory, primary first as the server orders them.
function RepoCard({ repo }: { repo: RepoOverview }) {
  return (
    <Card>
      <h2 className="font-mono text-base text-ink">{repo.name}</h2>
      <p className="mt-1 break-all font-mono text-ink-muted text-xs">{repo.root}</p>
      <ul className="mt-5 space-y-4">
        {repo.worktrees.map((worktree) => (
          <li key={worktree.path}>
            <WorktreeRow worktree={worktree} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

// The scanned roots, listed so a "nothing found" result is obviously about
// these folders and not about the repos themselves.
function ScannedRoots({ roots }: { roots: string[] }) {
  return (
    <div>
      <Eyebrow tone="muted">Scanned</Eyebrow>
      <ul className="mt-2 space-y-1">
        {roots.map((root) => (
          <li key={root} className="break-all font-mono text-ink-muted text-xs">
            {root}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Worktrees surface: every repo discovered under the configured roots,
 * each with its primary checkout and linked worktrees and their live state —
 * branch, dirty flag, upstream position, and the locked / prunable flags.
 * Read-only. Refreshing re-runs discovery on the server; the listing otherwise
 * stays current through `useWorktreesLive`, so a refresh triggered from
 * another open client lands here too.
 */
export function WorktreesOverview() {
  const query = useWorktrees();
  const refresh = useRefreshWorktrees();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const onRefresh = () => {
    setRefreshing(true);
    setRefreshError(null);
    refresh()
      .catch((error: unknown) =>
        setRefreshError(error instanceof Error ? error.message : "Try again."),
      )
      .finally(() => setRefreshing(false));
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Breadcrumb items={[]} current="Worktrees" />
        <Button onClick={onRefresh} pending={refreshing} pendingLabel="Refreshing…">
          Refresh
        </Button>
      </div>
      {refreshError ? (
        <div className="mt-6">
          <Notice tone="negative" announce="polite" title="Couldn't refresh worktrees">
            {refreshError}
          </Notice>
        </div>
      ) : null}
      <div className="mt-6">
        <Body query={query} />
      </div>
    </section>
  );
}

function Body({ query }: { query: ReturnType<typeof useWorktrees> }) {
  if (query.isPending) return <LoadingState>Loading worktrees…</LoadingState>;
  if (query.isError) {
    return (
      <Notice tone="negative" announce="polite" title="Couldn't load worktrees">
        {query.error instanceof Error ? query.error.message : "Try again."}
      </Notice>
    );
  }

  const { roots, repos } = query.data;
  if (roots.length === 0) {
    return (
      <EmptyState>
        kiri scans the folders listed under <Code>worktrees.roots</Code> in your{" "}
        <Code>kiri.yaml</Code> for git repos. None are listed, so there is nothing to scan.
      </EmptyState>
    );
  }
  if (repos.length === 0) {
    return (
      <div className="space-y-6">
        <EmptyState>No git repos were found under the configured roots.</EmptyState>
        <ScannedRoots roots={roots} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {repos.map((repo) => (
        <RepoCard key={repo.gitCommonDir} repo={repo} />
      ))}
    </div>
  );
}
