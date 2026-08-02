import { useEffect, useState } from "react";
import { useSearchParams } from "wouter";
import type { ChangeKind, ChangesetEmptyReason, ChangesetFile, ChangesetView } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import {
  SegmentedControl,
  type SegmentedOption,
} from "../../design-system/actions/segmented-control.tsx";
import { Diff } from "../../design-system/content/diff.tsx";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Tag, type TagTone } from "../../design-system/content/tag.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import {
  useChangeset,
  useFilePatch,
  useGitOverview,
  usePatchLimiter,
  useRefreshChangesets,
} from "../../state/git.ts";
import type { Limiter } from "../../state/limit-concurrency.ts";
import { branchLabel, dirName, stateTags } from "./worktree-state.ts";

const GIT_CRUMB = { label: "Git", href: "/git" };

const VIEWS: readonly SegmentedOption<ChangesetView>[] = [
  { value: "uncommitted", label: "Uncommitted" },
  { value: "branch", label: "Branch" },
];

const KIND_TONES: Record<ChangeKind, TagTone> = {
  added: "positive",
  modified: "neutral",
  deleted: "negative",
  renamed: "accent",
};

/**
 * How many files open with their diff showing. Reading a changeset is scrolling
 * through its diffs, so files start expanded — but the server caps a changeset
 * at 500 files of up to 200 KB of patch each, which is more markup than a
 * browser renders comfortably and more git than anyone asked for in one go.
 * Past this many, the rest start collapsed: every file still says what happened
 * to it, and its diff is one click — and one request — away. Fifty covers the
 * changesets people actually read end to end.
 */
export const AUTO_OPEN_FILES = 50;

// The server reports why a view is empty as a code and leaves the wording here,
// so each reads as something a person can act on rather than a symbol.
const EMPTY_REASONS: Record<ChangesetEmptyReason, string> = {
  "no-default-branch":
    "This repo has no default branch to measure a branch against — origin's HEAD isn't set locally, and there's no main or master. Fetch the repo, or create one of those branches.",
  "on-default-branch":
    "This checkout is on the default branch, so there's nothing it introduces over it. Switch to Uncommitted for its working tree.",
  "no-merge-base":
    "This checkout shares no history with the default branch, so there's no commit the two have in common to compare from. Uncommitted still works.",
  "no-commits":
    "This checkout has no commits yet, so it has no branch history to compare. Switch to Uncommitted to see what's waiting to be committed.",
};

const nothingChanged = (view: ChangesetView, defaultBranch: string | null): string =>
  view === "uncommitted"
    ? "The working tree is clean — nothing has changed since the last commit."
    : `This branch introduces nothing over ${defaultBranch ?? "the default branch"}.`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Try again.";

// A truncated patch carries the server's marker on its own final line, and Diff
// states the truncation itself — left in place, the same fact would read twice.
const withoutTruncationMarker = (patch: string): string => {
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  lines.pop();
  return lines.join("\n");
};

// How much moved, in the diff's own colour language: additions in the ok tone,
// deletions in the failed tone. A side with nothing on it is left out rather
// than shown as a coloured zero, and a file that moved no lines at all — a mode
// change, an empty file arriving — says so in words instead of "+0 −0".
function LineCounts({ file }: { file: ChangesetFile }) {
  if (file.insertions === 0 && file.deletions === 0) {
    return <span className="font-mono text-ink-muted text-xs">no line changes</span>;
  }
  return (
    <span className="flex items-center gap-2 font-mono text-xs">
      {file.insertions > 0 ? <span className="text-status-ok">+{file.insertions}</span> : null}
      {file.deletions > 0 ? <span className="text-status-failed">−{file.deletions}</span> : null}
    </span>
  );
}

// What a file's heading says whether or not its diff is showing: the path, what
// happened to it, how much moved, and the facts that belong to the file rather
// than to its diff — that it is binary, or that its patch was cut short. Folded
// shut, a changeset still reads as a summary of everything that changed.
//
// One line, read from both ends: the path at the left, what became of it at the
// right, just inboard of the disclosure's own caret. These are a readout rather
// than controls, and the card they sit in bounds them, so the distance between
// the two ends relates them instead of orphaning either. The path takes the
// space that is left and wraps within it rather than shouldering the rest off
// the row — long paths are the ordinary case here.
function FileSummary({ file, truncated }: { file: ChangesetFile; truncated: boolean }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-3">
      <span className="min-w-0 flex-1 break-all font-mono text-ink text-sm">{file.path}</span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {file.previousPath === null ? null : (
          <span className="font-mono text-ink-muted text-xs">from {file.previousPath}</span>
        )}
        <Tag tone={KIND_TONES[file.kind]}>{file.kind}</Tag>
        {file.binary ? <Tag>binary</Tag> : <LineCounts file={file} />}
        {truncated ? <Tag tone="caution">truncated</Tag> : null}
      </span>
    </span>
  );
}

// One file's patch, read while this is mounted — which is while the file is
// open, since a folded panel isn't rendered at all. The placeholder holds a
// diff's worth of height so the page doesn't lurch as patches land in whatever
// order they come back. Truncation is a fact about the file, so it is reported
// up to the heading that keeps saying it once the diff is folded away.
function FileDiff({
  path,
  view,
  file,
  limit,
  onTruncated,
}: {
  path: string;
  view: ChangesetView;
  file: ChangesetFile;
  limit: Limiter;
  onTruncated: (truncated: boolean) => void;
}) {
  const query = useFilePatch(path, view, file.path, file.previousPath, limit);
  const truncated = query.data?.truncated === true;

  useEffect(() => {
    onTruncated(truncated);
  }, [truncated, onTruncated]);

  if (query.isPending) {
    return (
      <div className="flex min-h-24 items-center border border-rule bg-paper px-4">
        <LoadingState>Computing this file's diff…</LoadingState>
      </div>
    );
  }
  if (query.isError) {
    return (
      <Notice tone="negative" announce="polite" title="Couldn't load this file's diff">
        {errorMessage(query.error)}
      </Notice>
    );
  }
  if (query.data.patch === "") {
    return <EmptyState>Git reports no diff for this file in this view.</EmptyState>;
  }
  return (
    <Diff
      patch={truncated ? withoutTruncationMarker(query.data.patch) : query.data.patch}
      truncated={truncated}
    />
  );
}

// One file in the sequence: a heading that always says what happened to it, and
// its diff beneath, foldable so a file that has been read can be put away
// without losing the shape of the changeset around it.
function FileSection({
  path,
  view,
  file,
  limit,
  defaultOpen,
}: {
  path: string;
  view: ChangesetView;
  file: ChangesetFile;
  limit: Limiter;
  defaultOpen: boolean;
}) {
  const [truncated, setTruncated] = useState(false);
  return (
    <div className="overflow-hidden rounded-sm border border-rule bg-canvas-2">
      <Disclosure
        summary={<FileSummary file={file} truncated={truncated} />}
        defaultOpen={defaultOpen}
      >
        {file.binary ? (
          <EmptyState>A binary file — it has no lines to diff.</EmptyState>
        ) : (
          <FileDiff path={path} view={view} file={file} limit={limit} onTruncated={setTruncated} />
        )}
      </Disclosure>
    </div>
  );
}

// Every changed file, one after another, each with its own diff beneath it, so
// the whole changeset reads top to bottom by scrolling.
//
// That means the page wants a patch per file, and each is a request the server
// computes with git — so they share one queue that admits a few at a time, and
// every file fills in the moment its own patch lands rather than the page
// waiting for the last. Past {@link AUTO_OPEN_FILES} the tail starts folded, and
// a folded panel is not rendered, so those files cost nothing until opened.
// Binary files ask for nothing either: there is no diff to compute.
function ChangedFiles({
  path,
  view,
  files,
}: {
  path: string;
  view: ChangesetView;
  files: ChangesetFile[];
}) {
  const limit = usePatchLimiter();
  return (
    <div className="space-y-4">
      {files.length > AUTO_OPEN_FILES ? (
        <p className="text-ink-muted text-xs">
          A changeset this size opens the first {AUTO_OPEN_FILES} diffs — the rest read on the file
          they belong to, and open one at a time.
        </p>
      ) : null}
      {files.map((file, index) => (
        <FileSection
          key={file.path}
          path={path}
          view={view}
          file={file}
          limit={limit}
          defaultOpen={index < AUTO_OPEN_FILES}
        />
      ))}
    </div>
  );
}

// How old the diff on screen is, or nothing to say before there is one. The
// time is when the query last resolved: no endpoint reports it, and none should
// grow a clock so a readout can exist.
const computedLabel = (query: ReturnType<typeof useChangeset>): string => {
  if (query.isFetching) return "Computing…";
  if (!query.isSuccess) return "";
  return `Computed ${formatRelativeTime(new Date(query.dataUpdatedAt).toISOString())}`;
};

// The changeset itself, once there is one to render.
function ChangesetBody({
  query,
  path,
  view,
  defaultBranch,
}: {
  query: ReturnType<typeof useChangeset>;
  path: string;
  view: ChangesetView;
  defaultBranch: string | null;
}) {
  if (query.isPending) return <LoadingState>Working out what changed…</LoadingState>;
  if (query.isError) {
    return (
      <Notice tone="negative" announce="polite" title="Couldn't read what changed">
        {errorMessage(query.error)}
      </Notice>
    );
  }

  const { files, totalFiles, truncated, emptyReason } = query.data;
  if (emptyReason !== null) return <EmptyState>{EMPTY_REASONS[emptyReason]}</EmptyState>;
  if (files.length === 0) return <EmptyState>{nothingChanged(view, defaultBranch)}</EmptyState>;

  return (
    <div className="space-y-8">
      {truncated ? (
        <Notice
          tone="warning"
          announce="polite"
          title={`Showing ${files.length} of ${totalFiles} changed files`}
        >
          A changeset this size is past what anyone reads in one sitting, so the page stops here.
        </Notice>
      ) : null}
      <ChangedFiles path={path} view={view} files={files} />
    </div>
  );
}

/**
 * One view of one checkout: the control that chooses it, how old the diff on
 * screen is beside the refresh that renews it, then every changed file with its
 * diff beneath it.
 *
 * The two controls are not one cluster, so they don't read as one: choosing a
 * view changes what is being looked at, while refresh recomputes what it is
 * being looked at through. The view sits at the left of the row, the refresh at
 * the right of it with the freshness immediately to its left, as everywhere else
 * on this surface. Both act on the page rather than on a row of it, so the row
 * spans the page's full measure and the refresh lands on the same right edge as
 * the rule above it and the diffs below.
 *
 * The freshness line is the same bargain the repo page's scan status strikes,
 * for a different reason: there the model trails the disk because the scan runs
 * in the background, here because a diff is computed once per read and nothing
 * signals when a file changes underneath it. The shapes are near enough to read
 * as one system and the sources have nothing in common, so they are two small
 * readouts rather than one shared component holding an "or" in the middle.
 *
 * The time comes from when the query last resolved — no endpoint reports it, and
 * none should grow a clock for this — so it resets by itself when the view
 * switches to a key of its own.
 */
function CheckoutChanges({
  path,
  view,
  onViewChange,
  defaultBranch,
}: {
  path: string;
  view: ChangesetView;
  onViewChange: (view: ChangesetView) => void;
  defaultBranch: string | null;
}) {
  const query = useChangeset(path, view);
  const refresh = useRefreshChangesets();

  return (
    <>
      <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
        <SegmentedControl label="View" options={VIEWS} value={view} onChange={onViewChange} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-ink-muted text-xs" aria-live="polite">
            {computedLabel(query)}
          </p>
          <Button onClick={refresh} pending={query.isFetching} pendingLabel="Refreshing…">
            Refresh
          </Button>
        </div>
      </div>
      <div className="mt-8">
        <ChangesetBody query={query} path={path} view={view} defaultBranch={defaultBranch} />
      </div>
    </>
  );
}

/**
 * One checkout's changes, read-only: its working tree against its last commit,
 * or what its branch introduces over its merge-base with the repo's default
 * branch. Nothing on this page writes — there is no staging, committing,
 * discarding, or editing from a diff.
 *
 * The whole changeset is on the page at once, file after file, the way a pull
 * request reads — nothing to pick, nothing to open. Each file folds away once it
 * has been read, and its heading keeps saying what happened to it either way.
 * That costs a patch per file, so they share a queue that reads a few at a time
 * and each file fills in as its own arrives; past what a browser renders
 * comfortably the tail starts folded and reads on demand.
 *
 * `repo` and `checkout` are directory names, matching how `/git/:repo` already
 * addresses a repo; the primary checkout's directory is the repo's own, so it
 * needs no id of its own. Either naming nothing the scan holds renders a
 * not-found state rather than an empty page.
 *
 * The view lives in the URL so a branch's changes can be linked to directly.
 * Only the two known views are honoured — anything else reads as the working
 * tree rather than erroring on a hand-edited link.
 *
 * Diffs are computed per request and are not part of the overview snapshot, so
 * they are not invalidated alongside it: a working tree moves constantly, and
 * recomputing on every scan would be a great deal of git for a page nobody
 * asked to change. The page says how old the diff on screen is and offers the
 * refresh that renews it instead, and switching view reads afresh.
 */
export function ChangesDetail({ repo: name, checkout }: { repo: string; checkout: string }) {
  const query = useGitOverview();
  const [params, setParams] = useSearchParams();

  const view: ChangesetView = params.get("view") === "branch" ? "branch" : "uncommitted";

  if (query.isPending) return <LoadingState>Loading checkout…</LoadingState>;
  if (query.isError) {
    return (
      <Notice tone="negative" announce="polite" title="Couldn't load checkout">
        {errorMessage(query.error)}
      </Notice>
    );
  }

  const repo = query.data.repos.find((candidate) => candidate.name === name);
  const worktree = repo?.worktrees.find((candidate) => dirName(candidate.path) === checkout);
  if (repo === undefined || worktree === undefined) {
    return (
      <section>
        <Breadcrumb items={[GIT_CRUMB]} current="Not found" />
        <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Checkout not found</h2>
        <p className="mt-3 font-mono text-ink-muted text-sm">
          No checkout named <code className="text-ink">{checkout}</code> was found in a repo named{" "}
          <code className="text-ink">{name}</code> under the configured roots.
        </p>
      </section>
    );
  }

  return (
    <section>
      <Breadcrumb
        items={[GIT_CRUMB, { label: repo.name, href: `/git/${encodeURIComponent(repo.name)}` }]}
        current={checkout}
      />
      <header className="mt-6 border-rule border-b pb-8">
        <Eyebrow>Changes</Eyebrow>
        <h2 className="mt-2 font-display text-5xl text-ink italic leading-[0.95] tracking-tight">
          {checkout}
        </h2>
        <p className="mt-4 flex flex-wrap items-center gap-2 font-mono text-ink text-sm">
          {branchLabel(worktree)}
          {/* Whatever the conflict check last found for this checkout, which
              the overview carries; this page never runs the merge itself. */}
          {stateTags(worktree, repo.defaultBranch, worktree.conflicts).map((tag) => (
            <Tag key={tag.label} tone={tag.tone}>
              {tag.label}
            </Tag>
          ))}
        </p>
        <p className="mt-2 break-all font-mono text-ink-muted text-sm">{worktree.path}</p>
      </header>
      {/* Keyed by view so switching starts from a fresh set of diffs, and from a
          freshness of its own, rather than carrying one view's into another's. */}
      <CheckoutChanges
        key={view}
        path={worktree.path}
        view={view}
        onViewChange={(next) => setParams(next === "uncommitted" ? {} : { view: next })}
        defaultBranch={repo.defaultBranch}
      />
    </section>
  );
}
