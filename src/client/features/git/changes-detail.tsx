import { useState } from "react";
import { useSearchParams } from "wouter";
import type { ChangeKind, ChangesetEmptyReason, ChangesetFile, ChangesetView } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import {
  SegmentedControl,
  type SegmentedOption,
} from "../../design-system/actions/segmented-control.tsx";
import { Diff } from "../../design-system/content/diff.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Tag, type TagTone } from "../../design-system/content/tag.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { Card } from "../../design-system/surfaces/card.tsx";
import {
  useChangeset,
  useFilePatch,
  useGitOverview,
  useRefreshChangesets,
} from "../../state/git.ts";
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

// One file's diff, fetched when the file is picked and never before — the
// component only mounts once something is selected, so a changeset of a hundred
// files costs one request until one of them is actually read.
function FilePatchPanel({
  path,
  view,
  file,
}: {
  path: string;
  view: ChangesetView;
  file: ChangesetFile;
}) {
  const query = useFilePatch(path, view, file.path, file.previousPath);

  if (query.isPending) return <LoadingState>Computing this file's diff…</LoadingState>;
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
      patch={query.data.truncated ? withoutTruncationMarker(query.data.patch) : query.data.patch}
      truncated={query.data.truncated}
    />
  );
}

// A file's line in the list: what it is, what happened to it, and how much
// moved.
function FileSummary({ file }: { file: ChangesetFile }) {
  return (
    <>
      <span className="block break-all font-mono text-ink text-sm">{file.path}</span>
      <span className="mt-1 flex flex-wrap items-center gap-2">
        <Tag tone={KIND_TONES[file.kind]}>{file.kind}</Tag>
        {file.binary ? (
          <Tag>binary</Tag>
        ) : (
          <span className="font-mono text-ink-muted text-xs">
            +{file.insertions} −{file.deletions}
          </span>
        )}
        {file.previousPath === null ? null : (
          <span className="font-mono text-ink-muted text-xs">from {file.previousPath}</span>
        )}
      </span>
    </>
  );
}

// The changed files beside the one being read. The list keeps its own column so
// moving between files never scrolls the page, and each row is the whole width
// of that column, so the thing you click stays attached to the file it opens.
function FileList({
  files,
  selected,
  onSelect,
}: {
  files: ChangesetFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <Card>
      <ul className="-mx-2 max-h-[70dvh] divide-y divide-rule overflow-y-auto">
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              onClick={() => onSelect(file.path)}
              aria-current={file.path === selected ? "true" : undefined}
              className="block w-full cursor-pointer px-2 py-3 text-left outline-none transition-colors duration-150 hover:bg-paper focus-visible:bg-paper focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1 aria-[current]:bg-paper"
            >
              <FileSummary file={file} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// The changed files and the diff of whichever one is being read.
function Changeset({
  path,
  view,
  defaultBranch,
}: {
  path: string;
  view: ChangesetView;
  defaultBranch: string | null;
}) {
  const query = useChangeset(path, view);
  const [selected, setSelected] = useState<string | null>(null);

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

  const file = files.find((candidate) => candidate.path === selected) ?? null;

  return (
    <div className="space-y-6">
      {truncated ? (
        <Notice
          tone="warning"
          announce="polite"
          title={`Showing ${files.length} of ${totalFiles} changed files`}
        >
          A changeset this size is past what anyone reads file by file, so the list stops here.
        </Notice>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-8">
          <FileList files={files} selected={selected} onSelect={setSelected} />
        </div>
        <div className="min-w-0">
          {file === null ? (
            <EmptyState>Pick a file to read what changed in it.</EmptyState>
          ) : (
            <div className="space-y-3">
              <p className="break-all font-mono text-ink text-sm">{file.path}</p>
              {file.binary ? (
                <EmptyState>A binary file — it has no lines to diff.</EmptyState>
              ) : (
                <FilePatchPanel path={path} view={view} file={file} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One checkout's changes, read-only: its working tree against its last commit,
 * or what its branch introduces over its merge-base with the repo's default
 * branch. Nothing on this page writes — there is no staging, committing,
 * discarding, or editing from a diff.
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
 * asked to change. Recompute is offered instead, and switching view reads
 * afresh.
 */
export function ChangesDetail({ repo: name, checkout }: { repo: string; checkout: string }) {
  const query = useGitOverview();
  const [params, setParams] = useSearchParams();
  const refresh = useRefreshChangesets();

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
          {stateTags(worktree).map((tag) => (
            <Tag key={tag.label} tone={tag.tone}>
              {tag.label}
            </Tag>
          ))}
        </p>
        <p className="mt-2 break-all font-mono text-ink-muted text-sm">{worktree.path}</p>
      </header>
      {/* The control and the recompute sit together at the left rather than
          being justified apart: across a page this wide, an action pushed to the
          far edge drifts away from what it acts on. */}
      <div className="mt-8 flex flex-wrap items-end gap-6">
        <SegmentedControl
          label="View"
          options={VIEWS}
          value={view}
          onChange={(next) => setParams(next === "uncommitted" ? {} : { view: next })}
        />
        <Button onClick={refresh}>Recompute</Button>
      </div>
      {/* Keyed by view so switching starts from an unpicked list rather than
          carrying one view's selection into another's files. */}
      <div className="mt-8">
        <Changeset key={view} path={worktree.path} view={view} defaultBranch={repo.defaultBranch} />
      </div>
    </section>
  );
}
