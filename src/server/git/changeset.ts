import { SCAN_CONCURRENCY, mapConcurrent } from "./concurrency.ts";
import { runGit } from "./run.ts";

/**
 * How many changed files one view reports. A changeset past this is a
 * mechanical change nobody reads file by file, and the list is flagged
 * `truncated` with `totalFiles` stating what was actually found.
 */
export const MAX_FILES = 500;

/**
 * How many bytes of one file's patch are returned. Past it the patch is cut at
 * the last whole line and {@link PATCH_TRUNCATION_MARKER} is appended, so a
 * generated file cannot hand the browser a megabyte of text.
 */
export const MAX_PATCH_BYTES = 200_000;

/** Appended to a patch that hit {@link MAX_PATCH_BYTES}, on its own line. */
export const PATCH_TRUNCATION_MARKER = "... patch truncated";

// git's empty tree: the base a diff is taken against when HEAD has no commit,
// so a repo whose first commit hasn't happened still reports its staged files.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Which of the two views of a checkout to compute. */
export type ChangesetView = "uncommitted" | "branch";

/** What happened to a file. A type change reads as a modification. */
export type ChangeKind = "added" | "modified" | "deleted" | "renamed";

/** Why a view has nothing to show beyond "nothing changed". */
export type ChangesetEmptyReason =
  | "no-default-branch"
  | "on-default-branch"
  | "no-merge-base"
  | "no-commits";

/** One changed file in a view. Counts are 0 for a binary file, which has no lines. */
export interface ChangesetFile {
  /** Path relative to the checkout root, as git reports it. */
  path: string;
  /** The path it moved from, for a rename; null otherwise. */
  previousPath: string | null;
  kind: ChangeKind;
  insertions: number;
  deletions: number;
  binary: boolean;
}

/** One view of a checkout: what changed, and how the view was resolved. */
export interface Changeset {
  view: ChangesetView;
  /** Changed files ordered by path, at most {@link MAX_FILES} of them. */
  files: ChangesetFile[];
  /** How many changed files were found, which exceeds `files.length` when truncated. */
  totalFiles: number;
  /** Whether the file cap dropped files from `files`. */
  truncated: boolean;
  /** The commit the branch view diffed against; null for the uncommitted view. */
  mergeBase: string | null;
  /** Why the view is empty when the reason isn't simply "nothing changed"; null otherwise. */
  emptyReason: ChangesetEmptyReason | null;
}

/** One file's unified patch, exactly as git wrote it. */
export interface FilePatch {
  path: string;
  /**
   * git's unified diff, unmodified — preamble, hunk headers and all. Empty when
   * the file has no diff in this view. A binary file's patch is git's textual
   * "Binary files … differ" line; the bytes are never returned.
   */
  patch: string;
  /** Whether the patch hit {@link MAX_PATCH_BYTES} and carries the truncation marker. */
  truncated: boolean;
}

/** What to compute a view for. */
export interface ChangesetOptions {
  /** Absolute path of the checkout to inspect. */
  path: string;
  view: ChangesetView;
  /** The repo's default branch — the branch view's other side. Null when it has none. */
  defaultBranch: string | null;
}

// A file's change as read from git, before its counts are known.
interface RawChange {
  path: string;
  previousPath: string | null;
  kind: ChangeKind;
  /** Counts from a numstat pass; null for an untracked file, measured separately. */
  counts: { insertions: number; deletions: number; binary: boolean } | null;
}

// git's -z output is a flat run of NUL-terminated fields; the trailing NUL
// yields an empty final field that carries no record.
const fields = (stdout: string): string[] => stdout.split("\0").filter((f) => f.length > 0);

const kindOf = (status: string): ChangeKind =>
  status.startsWith("A")
    ? "added"
    : status.startsWith("D")
      ? "deleted"
      : status.startsWith("R")
        ? "renamed"
        : "modified";

// Parse `--name-status -z`: a status field then its path, except a rename,
// whose status is followed by the old path and then the new one.
const parseNameStatus = (
  stdout: string,
): { path: string; previousPath: string | null; kind: ChangeKind }[] => {
  const parts = fields(stdout);
  const changes: { path: string; previousPath: string | null; kind: ChangeKind }[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    const kind = kindOf(status);
    const previousPath = kind === "renamed" ? parts[i++] : null;
    changes.push({ path: parts[i++], previousPath, kind });
  }
  return changes;
};

const counts = (insertions: string, deletions: string) =>
  insertions === "-"
    ? { insertions: 0, deletions: 0, binary: true }
    : { insertions: Number(insertions), deletions: Number(deletions), binary: false };

// Parse `--numstat -z`, keyed by the file's current path. A record is
// "<ins>\t<del>\t<path>", or "<ins>\t<del>\t" followed by the old and new paths
// for a rename.
const parseNumstat = (stdout: string): Map<string, NonNullable<RawChange["counts"]>> => {
  const parts = fields(stdout);
  const byPath = new Map<string, NonNullable<RawChange["counts"]>>();
  for (let i = 0; i < parts.length; ) {
    const [insertions, deletions, inline] = parts[i++].split("\t");
    if (inline === "") i++; // rename: skip the old path, key on the new one
    byPath.set(inline === "" ? parts[i++] : inline, counts(insertions, deletions));
  }
  return byPath;
};

// The revision a working-tree diff is taken against: HEAD, or the empty tree
// when there are no commits yet.
const baseRevision = async (path: string): Promise<string> => {
  const head = await runGit(path, "rev-parse", "--verify", "--quiet", "HEAD");
  return head.ok ? "HEAD" : EMPTY_TREE;
};

// The tracked side of a view: which files changed and by how much. Two passes
// because git reports the kind and the counts in different formats.
const trackedChanges = async (path: string, ...revs: string[]): Promise<RawChange[]> => {
  const [status, numstat] = await Promise.all([
    runGit(path, "diff", "-z", "--name-status", "--find-renames", ...revs),
    runGit(path, "diff", "-z", "--numstat", "--find-renames", ...revs),
  ]);
  const byPath = parseNumstat(numstat.stdout);
  return parseNameStatus(status.stdout).map((change) => ({
    ...change,
    counts: byPath.get(change.path) ?? null,
  }));
};

// Untracked files, which no diff against a revision reports. Their counts come
// from a diff against /dev/null, one process each, so they are measured only
// after the file cap has been applied.
const untrackedChanges = async (path: string): Promise<RawChange[]> => {
  const result = await runGit(path, "ls-files", "-z", "--others", "--exclude-standard");
  return fields(result.stdout).map((file) => ({
    path: file,
    previousPath: null,
    kind: "added" as const,
    counts: null,
  }));
};

// Line counts for one untracked file. `--no-index` exits non-zero whenever the
// two sides differ, which is always here, so the output is what matters.
const untrackedCounts = async (path: string, file: string) => {
  const result = await runGit(path, "diff", "--numstat", "--no-index", "--", "/dev/null", file);
  const [insertions = "0", deletions = "0"] = result.stdout.split("\n")[0].split("\t");
  return counts(insertions, deletions);
};

const byPath = (a: RawChange, b: RawChange): number => a.path.localeCompare(b.path);

// Whether git has `file` in its index, which separates an unchanged file from
// an untracked one when neither has a diff against a revision.
const isTracked = async (path: string, file: string): Promise<boolean> =>
  (await runGit(path, "ls-files", "--error-unmatch", "--", file)).ok;

// The commit the branch view diffs against, plus the reason there isn't one.
const resolveMergeBase = async (
  options: ChangesetOptions,
): Promise<{ mergeBase: string | null; emptyReason: ChangesetEmptyReason | null }> => {
  if (options.defaultBranch === null) return { mergeBase: null, emptyReason: "no-default-branch" };

  const head = await runGit(options.path, "rev-parse", "--verify", "--quiet", "HEAD");
  if (!head.ok) return { mergeBase: null, emptyReason: "no-commits" };

  const branch = await runGit(options.path, "symbolic-ref", "--quiet", "--short", "HEAD");
  // A checkout sitting on the default branch introduces nothing over it; a
  // detached HEAD still has a merge-base worth diffing against.
  if (branch.ok && branch.stdout.trim() === options.defaultBranch) {
    return { mergeBase: null, emptyReason: "on-default-branch" };
  }

  const base = await runGit(options.path, "merge-base", options.defaultBranch, "HEAD");
  if (!base.ok) return { mergeBase: null, emptyReason: "no-merge-base" };
  return { mergeBase: base.stdout.trim(), emptyReason: null };
};

const empty = (view: ChangesetView, emptyReason: ChangesetEmptyReason | null): Changeset => ({
  view,
  files: [],
  totalFiles: 0,
  truncated: false,
  mergeBase: null,
  emptyReason,
});

/**
 * Compute one view of a checkout: `uncommitted` diffs the working tree against
 * HEAD and adds every untracked file, `branch` diffs HEAD against its merge-base
 * with the repo's default branch — what the branch introduces. Read-only, and
 * never a fetch.
 *
 * At most {@link MAX_FILES} files come back, ordered by path, with `truncated`
 * and `totalFiles` reporting what was left out. A checkout with no default
 * branch, no commits, no merge-base, or one sitting on the default branch
 * returns an empty view carrying the reason rather than failing.
 */
export async function changeset(options: ChangesetOptions): Promise<Changeset> {
  const { path, view } = options;

  let mergeBase: string | null = null;
  let changes: RawChange[];
  if (view === "branch") {
    const resolved = await resolveMergeBase(options);
    if (resolved.mergeBase === null) return empty(view, resolved.emptyReason);
    mergeBase = resolved.mergeBase;
    changes = await trackedChanges(path, mergeBase, "HEAD");
  } else {
    const [tracked, untracked] = await Promise.all([
      trackedChanges(path, await baseRevision(path)),
      untrackedChanges(path),
    ]);
    changes = [...tracked, ...untracked];
  }

  changes.sort(byPath);
  const totalFiles = changes.length;
  const kept = changes.slice(0, MAX_FILES);

  const measured = await mapConcurrent(kept, SCAN_CONCURRENCY, async (change) => ({
    path: change.path,
    previousPath: change.previousPath,
    kind: change.kind,
    ...(change.counts ?? (await untrackedCounts(path, change.path))),
  }));

  return {
    view,
    files: measured,
    totalFiles,
    truncated: totalFiles > kept.length,
    mergeBase,
    emptyReason: null,
  };
}

/** Which file's patch to fetch, in which view. */
export interface FilePatchOptions extends ChangesetOptions {
  /** Path of the file, relative to the checkout root. */
  file: string;
  /** The file's pre-rename path, so git pairs the two sides into one patch. */
  previousPath?: string;
}

// Cut at the last whole line inside the cap, so the marker never lands mid-line.
// A patch always breaks lines in its own header, so the floor is unreachable.
const capPatch = (patch: string): FilePatch["patch"] => {
  const head = patch.slice(0, MAX_PATCH_BYTES);
  return `${head.slice(0, Math.max(head.lastIndexOf("\n"), 0))}\n${PATCH_TRUNCATION_MARKER}\n`;
};

/**
 * Fetch one file's unified patch in the given view, served exactly as git wrote
 * it — preamble, hunk headers and all — so nothing here decides how it renders.
 * A binary file yields git's textual "differ" line, never its bytes, and a patch
 * past {@link MAX_PATCH_BYTES} is cut at a line boundary and marked.
 *
 * An untracked file has no diff against a revision, so it is diffed against
 * /dev/null instead. A file with nothing to show in this view returns an empty
 * patch rather than failing.
 */
export async function filePatch(options: FilePatchOptions): Promise<FilePatch> {
  const { path, view, file } = options;
  const paths = options.previousPath === undefined ? [file] : [options.previousPath, file];

  let patch = "";
  if (view === "branch") {
    const { mergeBase } = await resolveMergeBase(options);
    if (mergeBase !== null) {
      const result = await runGit(
        path,
        "diff",
        "--find-renames",
        mergeBase,
        "HEAD",
        "--",
        ...paths,
      );
      patch = result.stdout;
    }
  } else {
    const result = await runGit(
      path,
      "diff",
      "--find-renames",
      await baseRevision(path),
      "--",
      ...paths,
    );
    patch = result.stdout;
    // Nothing to diff means the file is either untracked or unchanged; an
    // untracked one still has a patch, against an empty file.
    if (patch === "" && !(await isTracked(path, file))) {
      const untracked = await runGit(path, "diff", "--no-index", "--", "/dev/null", file);
      patch = untracked.stdout;
    }
  }

  if (patch.length <= MAX_PATCH_BYTES) return { path: file, patch, truncated: false };
  return { path: file, patch: capPatch(patch), truncated: true };
}
