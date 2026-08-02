import { SCAN_CONCURRENCY, mapConcurrent } from "./concurrency.ts";
import type { RepoOverview } from "./overview.ts";
import { runGit } from "./run.ts";

/**
 * How an update attempt ended. `refused` is kiri declining before running
 * anything, with a reason; `failed` is git having run and said no.
 */
export type SyncStatus = "updated" | "up-to-date" | "refused" | "failed";

/** Outcome of fetching one repo. */
export interface FetchResult {
  /** Directory name of the repo fetched. */
  repo: string;
  status: SyncStatus;
  /** Git's own report of what moved, line by line. Empty unless updated. */
  updates: string[];
  /** Why kiri declined to fetch; present only on a refusal. */
  reason?: string;
  /** Git's message; present only on a failure. */
  error?: string;
}

/** Outcome of fast-forwarding one checkout. */
export interface PullResult {
  /** Absolute path of the checkout. */
  path: string;
  /** The branch it is on; null when detached. */
  branch: string | null;
  status: SyncStatus;
  /** Commits fast-forwarded onto the branch; 0 unless updated. */
  commits: number;
  /** Why the pull was refused; present only on a refusal. */
  reason?: string;
  /** Git's message; present only on a failure. */
  error?: string;
}

/** The repo identity a fetch needs: what to call it and where it lives. */
export type FetchTarget = Pick<RepoOverview, "name" | "root">;

/** A repo and every checkout of it an update brings along. */
export type UpdateTarget = Pick<RepoOverview, "name" | "root" | "worktrees">;

/** Outcome of updating one repo: its fetch, then each of its checkouts. */
export interface UpdateResult {
  /** Directory name of the repo updated. */
  repo: string;
  /** How the repo's fetch went. */
  fetch: FetchResult;
  /** One outcome per checkout, in the repo's own order. Empty when the fetch never landed. */
  checkouts: PullResult[];
}

/**
 * Fetch one repo with `git fetch --prune`, run in its primary checkout: one
 * fetch serves every worktree of the repo, since they share an object store,
 * and the prune is what turns a branch whose upstream was deleted into a `[gone]`
 * upstream on the next scan. A repo with no remote is refused rather than left
 * to git's own fatal; a fetch that reached the network and failed — offline,
 * auth — comes back as a failure carrying git's message. What changed is git's
 * own summary, the lines it prints in a terminal, so an empty one means nothing
 * moved.
 */
export async function fetchRepo(repo: FetchTarget): Promise<FetchResult> {
  const remotes = await runGit(repo.root, "remote");
  if (!remotes.ok) return { repo: repo.name, status: "failed", updates: [], error: remotes.stderr };
  if (remotes.stdout.trim() === "") {
    return { repo: repo.name, status: "refused", updates: [], reason: "the repo has no remote" };
  }

  const fetched = await runGit(repo.root, "fetch", "--prune");
  if (!fetched.ok) return { repo: repo.name, status: "failed", updates: [], error: fetched.stderr };

  // git reports a fetch on stderr and says nothing at all when the refs were
  // already current, so its own output is both the "did anything move" signal
  // and the detail of what did.
  const updates = fetched.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return { repo: repo.name, status: updates.length === 0 ? "up-to-date" : "updated", updates };
}

/**
 * Fetch every repo in `repos`, with the same bound the scan runs under so a
 * workspace of dozens does not open dozens of connections at once. One repo
 * failing never stops the rest — every repo comes back with its own outcome, in
 * input order.
 */
export const fetchRepos = async (repos: readonly FetchTarget[]): Promise<FetchResult[]> =>
  mapConcurrent(repos, SCAN_CONCURRENCY, fetchRepo);

/** How many conflicting paths a refusal names before it summarises the rest. */
const NAMED_CONFLICTS = 5;

// `<mode> <object> <stage>\t<path>` — the conflicted-file entries git lists
// under the merged tree. The informational messages that follow take no such
// shape, so matching the line is enough to tell the two blocks apart.
const CONFLICT_ENTRY = /^\d{6} [0-9a-f]+ [123]\t(.+)$/;

/**
 * The paths reconciling `HEAD` with its upstream would conflict in: an empty
 * array when it would merge cleanly, and null when git could not answer —
 * no merge base, or a git too old for `merge-tree --write-tree`.
 *
 * Nothing is written or checked out; the merge happens entirely in the object
 * store. It reads `@{upstream}` as it stands right now, so it is only as
 * truthful as the last fetch.
 */
const conflictingPaths = async (path: string): Promise<string[] | null> => {
  const merged = await runGit(path, "merge-tree", "--write-tree", "@{upstream}", "HEAD");
  if (merged.ok) return [];
  const paths = merged.stdout
    .split("\n")
    .map((line) => CONFLICT_ENTRY.exec(line)?.[1])
    .filter((file): file is string => file !== undefined);
  return paths.length === 0 ? null : [...new Set(paths)];
};

// A conflicted merge stages one entry per side, and a wide conflict can run to
// hundreds of files — enough of them to see the shape of it, then a count.
const namePaths = (paths: string[]): string =>
  paths.length <= NAMED_CONFLICTS
    ? paths.join(", ")
    : `${paths.slice(0, NAMED_CONFLICTS).join(", ")} and ${paths.length - NAMED_CONFLICTS} more`;

// What a divergence has to say beyond the counts. Reconciling it is the user's
// to do either way; whether it will fight back is the part they cannot see
// without trying it.
const divergence = (conflicts: string[] | null): string => {
  if (conflicts === null) return "";
  return conflicts.length === 0
    ? ", and reconciling it would not conflict"
    : `, and reconciling it would conflict in ${namePaths(conflicts)}`;
};

/**
 * Fast-forward the checkout at `path` with `git pull --ff-only`, and nothing
 * else: it either moves the branch straight along its upstream or it does not
 * happen. Refused, with a stated reason, when HEAD is detached, the branch has
 * no upstream, that upstream has gone, or the branch has diverged from it —
 * every one of those needing a decision kiri will not make for you. A branch
 * level with its upstream, or merely ahead of it, is already up to date and
 * nothing runs.
 *
 * A divergence also says whether reconciling it would conflict, and where. That
 * costs an extra merge, so it is computed only once a branch is known to have
 * diverged — rare enough to be free in the ordinary case, and never paid by the
 * read path.
 */
export async function fastForwardPull(path: string): Promise<PullResult> {
  const branch =
    (await runGit(path, "symbolic-ref", "--quiet", "--short", "HEAD")).stdout.trim() || null;
  const refused = (reason: string): PullResult => ({
    path,
    branch,
    status: "refused",
    commits: 0,
    reason,
  });
  if (branch === null) return refused("HEAD is detached — check out a branch to pull it");

  // One read answers all three tracking questions: whether there is an upstream,
  // whether it still exists, and whether the branch has moved apart from it.
  const tracking = await runGit(
    path,
    "for-each-ref",
    "--format=%(upstream:short)%09%(upstream:track)",
    `refs/heads/${branch}`,
  );
  const [upstream = "", track = ""] = tracking.stdout.trim().split("\t");
  if (upstream === "") return refused(`'${branch}' has no upstream to pull from`);
  if (track === "[gone]") return refused(`the upstream of '${branch}' no longer exists`);
  if (track === "") return { path, branch, status: "up-to-date", commits: 0 };

  const counts = await runGit(path, "rev-list", "--left-right", "--count", "@{upstream}...HEAD");
  const [behind = 0, ahead = 0] = counts.stdout.trim().split(/\s+/).map(Number);
  if (ahead > 0 && behind > 0) {
    return refused(
      `'${branch}' has diverged from ${upstream} — ${ahead} ahead, ${behind} behind${divergence(
        await conflictingPaths(path),
      )}. Merge or rebase it yourself.`,
    );
  }
  if (behind === 0) return { path, branch, status: "up-to-date", commits: 0 };

  if ((await runGit(path, "status", "--porcelain")).stdout.trim() !== "") {
    return refused("the working tree has uncommitted changes — commit or stash them first");
  }

  // --no-rebase overrides a global pull.rebase=true, which would otherwise
  // rebase rather than fast-forward; --ff-only still means this can only move
  // the branch straight along its upstream.
  const pulled = await runGit(path, "pull", "--ff-only", "--no-rebase");
  if (!pulled.ok) return { path, branch, status: "failed", commits: 0, error: pulled.stderr };
  return { path, branch, status: "updated", commits: behind };
}

/**
 * Bring one repo current: fetch it once, then fast-forward every checkout of it
 * that can take one. The primary checkout is included — updating a repo can
 * move the branch a worktree was cut from, which is the point.
 *
 * A fetch that never landed stops there: without current remote-tracking refs
 * there is nothing for a fast-forward to move toward, and a repo that is offline
 * would only fail again once per checkout. Everything past the fetch is reported
 * per checkout, and a checkout that cannot be fast-forwarded is left exactly as
 * it was, with its reason.
 *
 * Checkouts run one at a time: they share one object store, and a repo's fetch
 * has already done the slow part.
 */
export async function updateRepo(repo: UpdateTarget): Promise<UpdateResult> {
  const fetched = await fetchRepo(repo);
  if (fetched.status === "refused" || fetched.status === "failed") {
    return { repo: repo.name, fetch: fetched, checkouts: [] };
  }

  const checkouts: PullResult[] = [];
  for (const worktree of repo.worktrees) {
    checkouts.push(await fastForwardPull(worktree.path));
  }
  return { repo: repo.name, fetch: fetched, checkouts };
}

/**
 * Update every repo in `repos`, under the same bound the scan runs under. One
 * repo failing never stops the rest — every repo comes back with its own
 * outcome, in input order.
 */
export const updateRepos = async (repos: readonly UpdateTarget[]): Promise<UpdateResult[]> =>
  mapConcurrent(repos, SCAN_CONCURRENCY, updateRepo);
