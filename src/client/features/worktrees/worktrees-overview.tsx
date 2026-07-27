import { useState } from "react";
import type { RepoOverview, WorktreeStatus } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Code } from "../../design-system/content/code.tsx";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Tag, type TagTone } from "../../design-system/content/tag.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import {
  useCreateWorktree,
  usePruneWorktrees,
  useRefreshWorktrees,
  useRemoveWorktree,
  useWorktrees,
} from "../../state/worktrees.ts";
import { CreateWorktreeModal } from "./create-worktree-modal.tsx";
import { PruneWorktreesModal, pruneTargets } from "./prune-worktrees-modal.tsx";
import { RemoveWorktreeModal } from "./remove-worktree-modal.tsx";

// Trailing directory name of an absolute path — what a worktree is known by in
// conversation ("kiri-feat-search"), with the full path kept alongside it.
const dirName = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

// The worktree's state as a rail of tags, ordered so the working tree leads and
// the rarer flags trail. Working-tree state is always stated — clean is a fact
// worth reading, not an absence. Tracking is reported only when it has
// something to say: a branch level with its upstream, or with no upstream at
// all, stays silent rather than showing a row of zeroes.
const stateTags = (worktree: WorktreeStatus): { label: string; tone: TagTone }[] => {
  const tags: { label: string; tone: TagTone }[] = [
    worktree.dirty ? { label: "dirty", tone: "caution" } : { label: "clean", tone: "positive" },
  ];
  if (worktree.upstreamGone) tags.push({ label: "upstream gone", tone: "negative" });
  if (worktree.ahead > 0) tags.push({ label: `ahead ${worktree.ahead}`, tone: "caution" });
  if (worktree.behind > 0) tags.push({ label: `behind ${worktree.behind}`, tone: "caution" });
  if (worktree.locked) tags.push({ label: "locked", tone: "neutral" });
  if (worktree.prunable) tags.push({ label: "prunable", tone: "negative" });
  return tags;
};

// One worktree: what it is called, where its branch sits, the state rail that
// says what you would do with it, and — for a linked worktree — the removal that
// tidies it away. The rail and the action are kept apart, so a row of facts
// never reads as a row of controls. The primary checkout carries no remove
// action; it is the repo.
function WorktreeRow({ worktree, onRemove }: { worktree: WorktreeStatus; onRemove: () => void }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-mono text-ink text-sm">
          {dirName(worktree.path)}
          {worktree.primary ? <Tag tone="accent">primary</Tag> : null}
        </p>
        <p className="mt-1 font-mono text-ink-muted text-xs">
          {worktree.detached ? "detached" : (worktree.branch ?? "no branch")}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 sm:justify-end">
        <div className="flex flex-wrap gap-2">
          {stateTags(worktree).map((tag) => (
            <Tag key={tag.label} tone={tag.tone}>
              {tag.label}
            </Tag>
          ))}
        </div>
        {worktree.primary ? null : (
          <Button variant="negative" onClick={onRemove}>
            remove
          </Button>
        )}
      </div>
    </div>
  );
}

// What a collapsed repo still has to say: its default branch, how many checkouts
// it holds, and how many of them are carrying something. Counts are only tagged
// when non-zero, so a settled repo collapses to its name and size.
const summaryTags = (repo: RepoOverview): { label: string; tone: TagTone }[] => {
  const count = (predicate: (worktree: WorktreeStatus) => boolean) =>
    repo.worktrees.filter(predicate).length;
  const total = repo.worktrees.length;
  const dirty = count((worktree) => worktree.dirty);
  const gone = count((worktree) => worktree.upstreamGone);
  const prunable = count((worktree) => worktree.prunable);
  return [
    ...(repo.defaultBranch === null
      ? []
      : [{ label: repo.defaultBranch, tone: "accent" as const }]),
    { label: `${total} ${total === 1 ? "worktree" : "worktrees"}`, tone: "neutral" as const },
    ...(dirty > 0 ? [{ label: `${dirty} dirty`, tone: "caution" as const }] : []),
    ...(gone > 0 ? [{ label: `${gone} upstream gone`, tone: "negative" as const }] : []),
    ...(prunable > 0 ? [{ label: `${prunable} prunable`, tone: "negative" as const }] : []),
  ];
};

// One repo: a collapsible card whose summary is its name, its default branch,
// and the state of the checkouts inside, revealing its primary path and every
// worktree row — primary first, as the server orders them. A repo holding
// something that wants a decision starts expanded, so the work shows without a
// click.
function RepoCard({ repo }: { repo: RepoOverview }) {
  const remove = useRemoveWorktree();
  const [removing, setRemoving] = useState<WorktreeStatus | null>(null);
  const wantsAttention = repo.worktrees.some(
    (worktree) => worktree.dirty || worktree.upstreamGone || worktree.prunable,
  );
  return (
    <div className="overflow-hidden rounded-sm border border-rule bg-canvas-2">
      <Disclosure
        defaultOpen={wantsAttention}
        summary={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono text-ink text-sm">{repo.name}</span>
            <span className="ml-auto flex flex-wrap gap-2">
              {summaryTags(repo).map((tag) => (
                <Tag key={tag.label} tone={tag.tone}>
                  {tag.label}
                </Tag>
              ))}
            </span>
          </span>
        }
      >
        <p className="break-all font-mono text-ink-muted text-xs">{repo.root}</p>
        <ul className="mt-5 space-y-4">
          {repo.worktrees.map((worktree) => (
            <li key={worktree.path}>
              <WorktreeRow worktree={worktree} onRemove={() => setRemoving(worktree)} />
            </li>
          ))}
        </ul>
      </Disclosure>
      {removing ? (
        <RemoveWorktreeModal
          worktree={removing}
          onRemove={remove}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
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
 * The Worktrees surface: every repo discovered under the configured roots, each
 * with its default branch, its primary checkout and linked worktrees, and their
 * live state — branch, dirty flag, upstream position, and the locked / prunable
 * flags. The whole lifecycle runs from here: creating a worktree, removing one,
 * and — when git is holding records for worktrees that have gone — clearing
 * those stale entries from the banner that announces them. Refreshing re-runs
 * discovery on the
 * server; the listing otherwise stays current through `useWorktreesLive`, so an
 * operation run from another open client lands here too.
 */
export function WorktreesOverview() {
  const query = useWorktrees();
  const refresh = useRefreshWorktrees();
  const create = useCreateWorktree();
  const prune = usePruneWorktrees();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pruning, setPruning] = useState(false);

  const onRefresh = () => {
    setRefreshing(true);
    setRefreshError(null);
    refresh()
      .catch((error: unknown) =>
        setRefreshError(error instanceof Error ? error.message : "Try again."),
      )
      .finally(() => setRefreshing(false));
  };

  const repos = query.data?.repos ?? [];
  // The prune action only exists when something is actually stale, so nobody has
  // to click a button to find out there was nothing to do.
  const stale = pruneTargets(repos).reduce((total, target) => total + target.paths.length, 0);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Breadcrumb items={[]} current="Worktrees" />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onRefresh} pending={refreshing} pendingLabel="Refreshing…">
            Refresh
          </Button>
          {repos.length > 0 ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              New worktree
            </Button>
          ) : null}
        </div>
      </div>
      {refreshError ? (
        <div className="mt-6">
          <Notice tone="negative" announce="polite" title="Couldn't refresh worktrees">
            {refreshError}
          </Notice>
        </div>
      ) : null}
      {stale > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <Notice
            tone="warning"
            title={`${stale} stale ${stale === 1 ? "entry" : "entries"} to clear`}
          >
            Git still holds records for worktrees whose directories have gone.
          </Notice>
          <Button onClick={() => setPruning(true)}>Review and prune</Button>
        </div>
      ) : null}
      <div className="mt-6">
        <Body query={query} />
      </div>
      {creating ? (
        <CreateWorktreeModal repos={repos} onCreate={create} onClose={() => setCreating(false)} />
      ) : null}
      {pruning ? (
        <PruneWorktreesModal repos={repos} onPrune={prune} onClose={() => setPruning(false)} />
      ) : null}
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
