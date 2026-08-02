import { useState } from "react";
import type { RepoOverview, WorktreeStatus } from "../../api.ts";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { Code } from "../../design-system/content/code.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Tag, type TagTone } from "../../design-system/content/tag.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { Card } from "../../design-system/surfaces/card.tsx";
import { useGitOverview, useUpdateAllRepos } from "../../state/git.ts";
import { ScanFreshness } from "./scan-status.tsx";
import {
  type RepoUpdateFailure,
  RepoUpdateReport,
  UpdateAction,
  type UpdateReport,
  useUpdate,
} from "./update.tsx";

// The path a repo's own page lives at, keyed by its directory name.
const repoHref = (repo: RepoOverview): string => `/git/${encodeURIComponent(repo.name)}`;

// Whether a repo is carrying something a person would want to act on.
const wantsAttention = (repo: RepoOverview): boolean =>
  repo.worktrees.some((worktree) => worktree.dirty || worktree.upstreamGone || worktree.prunable);

const total = (repo: RepoOverview, of: (worktree: WorktreeStatus) => number): number =>
  repo.worktrees.reduce((sum, worktree) => sum + of(worktree), 0);

// What a repo has to say from the list, without opening it: how many checkouts
// it holds beyond its primary, and everything inside it that is unfinished.
// Ahead and behind are summed in commits, matching the vocabulary of the tags on
// a worktree's own row; the rest are counts of the checkouts concerned. A repo
// carrying nothing at all says "clean" rather than going silent — an absence of
// tags reads as missing data, not as a settled repo.
const summaryTags = (repo: RepoOverview): { label: string; tone: TagTone }[] => {
  const count = (predicate: (worktree: WorktreeStatus) => boolean) =>
    total(repo, (worktree) => (predicate(worktree) ? 1 : 0));
  const linked = count((worktree) => !worktree.primary);
  const dirty = count((worktree) => worktree.dirty);
  const ahead = total(repo, (worktree) => worktree.ahead);
  const behind = total(repo, (worktree) => worktree.behind);
  const gone = count((worktree) => worktree.upstreamGone);
  const prunable = count((worktree) => worktree.prunable);
  const tags: { label: string; tone: TagTone }[] = [];
  if (linked > 0) {
    tags.push({ label: `${linked} ${linked === 1 ? "worktree" : "worktrees"}`, tone: "neutral" });
  }
  if (dirty > 0) tags.push({ label: `${dirty} dirty`, tone: "caution" });
  if (ahead > 0) tags.push({ label: `ahead ${ahead}`, tone: "caution" });
  if (behind > 0) tags.push({ label: `behind ${behind}`, tone: "caution" });
  if (gone > 0) tags.push({ label: `${gone} upstream gone`, tone: "negative" });
  if (prunable > 0) tags.push({ label: `${prunable} prunable`, tone: "negative" });
  if (tags.length === 0) tags.push({ label: "clean", tone: "positive" });
  return tags;
};

// One repo, as much of it as reads at a glance: its name as the way into its own
// page, where it lives on disk, the branch a new one is cut from, and the rail
// of everything inside it that is unfinished.
function RepoCard({ repo, failure }: { repo: RepoOverview; failure?: RepoUpdateFailure }) {
  return (
    <Card>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span className="min-w-0 text-2xl">
          <HeadlineLink href={repoHref(repo)}>{repo.name}</HeadlineLink>
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {summaryTags(repo).map((tag) => (
            <Tag key={tag.label} tone={tag.tone}>
              {tag.label}
            </Tag>
          ))}
        </span>
      </div>
      <p className="mt-2 break-all font-mono text-ink-muted text-xs">{repo.root}</p>
      <p className="mt-1 font-mono text-ink-muted text-xs">
        {repo.defaultBranch === null ? "no default branch" : `default branch ${repo.defaultBranch}`}
      </p>
      {/* Whatever the last update could not do to this repo, inside the repo's
          own card — a reason belongs to the thing it is about. */}
      <RepoUpdateReport failure={failure} />
    </Card>
  );
}

/**
 * Substring filter across repo name, worktree path, and branch (case-
 * insensitive). A repo matches on its own name, or on anything checked out
 * inside it — so the branch you are half-way through finds the repo it lives in
 * without you remembering which one that is. An empty query passes everything.
 */
const filterRepos = (repos: RepoOverview[], query: string): RepoOverview[] => {
  const q = query.trim().toLowerCase();
  if (q === "") return repos;
  return repos.filter(
    (repo) =>
      repo.name.toLowerCase().includes(q) ||
      repo.worktrees.some(
        (worktree) =>
          worktree.path.toLowerCase().includes(q) ||
          (worktree.branch?.toLowerCase().includes(q) ?? false),
      ),
  );
};

/**
 * Repos wanting a decision lead, then the ones holding a linked worktree, then
 * the rest. Scanning a couple of dozen repos leaves the handful actually being
 * worked in scattered down a long alphabetical list; hoisting them puts the work
 * at the top without hiding anything. The server's ordering holds within each
 * group, so the quiet repos stay alphabetical.
 */
const attentionFirst = (repos: RepoOverview[]): RepoOverview[] => {
  const active = (repo: RepoOverview) => repo.worktrees.some((worktree) => !worktree.primary);
  const rank = (repo: RepoOverview) => {
    if (wantsAttention(repo)) return 0;
    return active(repo) ? 1 : 2;
  };
  return [...repos].sort((a, b) => rank(a) - rank(b));
};

// The scanned roots, listed so a "nothing found" result is obviously about these
// folders and not about the repos themselves.
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
 * The Git surface's landing page: every repo discovered under the configured
 * roots, each summarised down to what is unfinished inside it and linking
 * through to its own page, where its worktrees are managed. Repos wanting a
 * decision lead the list, and the filter reaches into them — a repo is matched
 * by its name, or by the path or branch of anything checked out inside it. The
 * ahead and behind counts are only as current as each repo's last update, so the
 * list carries the update that brings every repo — and every checkout inside
 * them — current in one action.
 *
 * An update that worked says nothing: the repos it moved simply stop being
 * behind. A repo it could not reach, or a checkout of one it could not
 * fast-forward, is named with its reason inside that repo's own card.
 *
 * The server holds the model in memory and rescans in the background, so the
 * listing appears at once and says how old it is. Updating rescans as part of
 * settling, and the page otherwise stays current through `useGitLive`, so an
 * operation run from another open client lands here too.
 */
export function RepoList() {
  const query = useGitOverview();
  const update = useUpdate(useUpdateAllRepos());
  const [filter, setFilter] = useState("");
  const repos = query.data?.repos ?? [];

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Breadcrumb items={[]} current="Git" />
        {/* The page's one action, on the line its freshness reads on. */}
        <div className="flex flex-wrap items-start justify-end gap-3">
          <ScanFreshness overview={query.data} />
          {repos.length > 0 ? <UpdateAction label="Update all" update={update} /> : null}
        </div>
      </div>
      {repos.length > 0 ? (
        <div className="mt-6 max-w-sm">
          <TextInput value={filter} onChange={setFilter} placeholder="Filter repos…" />
        </div>
      ) : null}
      <div className="mt-6">
        <Body query={query} filter={filter} report={update.report} />
      </div>
    </section>
  );
}

function Body({
  query,
  filter,
  report,
}: {
  query: ReturnType<typeof useGitOverview>;
  filter: string;
  report: UpdateReport;
}) {
  if (query.isPending) return <LoadingState>Loading repos…</LoadingState>;
  if (query.isError) {
    return (
      <Notice tone="negative" announce="polite" title="Couldn't load repos">
        {query.error instanceof Error ? query.error.message : "Try again."}
      </Notice>
    );
  }

  const { roots, repos } = query.data;
  if (roots.length === 0) {
    return (
      <EmptyState>
        kiri scans the folders listed under <Code>git.roots</Code> in your <Code>kiri.yaml</Code>{" "}
        for git repos. None are listed, so there is nothing to scan.
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

  const matched = attentionFirst(filterRepos(repos, filter));
  if (matched.length === 0) {
    return <EmptyState>No repos match “{filter.trim()}”.</EmptyState>;
  }

  // A list of repos, marked up as one, so each card is an item a reader can
  // step through rather than a run of unrelated panels.
  return (
    <ul className="space-y-4">
      {matched.map((repo) => (
        <li key={repo.gitCommonDir}>
          <RepoCard repo={repo} failure={report.get(repo.name)} />
        </li>
      ))}
    </ul>
  );
}
