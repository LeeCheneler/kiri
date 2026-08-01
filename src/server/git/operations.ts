import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { resolveWorktreeConfig } from "./config.ts";
import { discoverRepos } from "./discovery.ts";
import {
  type CommandRunner,
  type PrepareReport,
  defaultCommandRunner,
  prepareWorktree,
} from "./prepare.ts";
import { type GitResult, runGit } from "./run.ts";
import type { GitConfig } from "./schema.ts";

/** How the branch a new worktree checks out was resolved. */
export type BranchSource = "local" | "remote" | "new";

/** What to create, and how to prepare it. */
export interface CreateWorktreeOptions {
  /** The repo to create the worktree for — its primary checkout or any of its worktrees. */
  repoPath: string;
  /** Branch to check out: reused when it exists locally or on origin, otherwise created. */
  branch: string;
  /**
   * Directory suffix for the worktree, giving `<repo>-<name>`. Defaults to the
   * branch with its slashes flattened.
   */
  name?: string;
  /** Base for a brand-new branch. Defaults to the repo's default branch on origin. */
  baseRef?: string;
  /** Skip the prep pipeline entirely, leaving the worktree bare. */
  skipPrepare?: boolean;
  /** The `git:` config section, used to resolve the repo's prep policy. */
  config?: GitConfig;
}

/**
 * Outcome of a create. `failed` covers both a worktree that could not be
 * created and one that was created but whose prep pipeline failed — `path`
 * names the directory either way, and a non-null `prepare` distinguishes them.
 */
export interface CreateWorktreeResult {
  status: "ok" | "failed";
  /** Absolute path the worktree was, or would have been, created at. */
  path: string;
  branch: string;
  /** How the branch was resolved; null when the worktree was never created. */
  branchSource: BranchSource | null;
  /** The base a brand-new branch was cut from; null when the branch already existed. */
  baseRef: string | null;
  /** The prep report; null when prep was skipped or the worktree was never created. */
  prepare: PrepareReport | null;
  /** Failure reason, present only on a failed create. */
  error?: string;
}

/** Outcome of the fast-forward pull of the primary checkout after a remove. */
export type PullOutcome = "ok" | "skipped" | "failed";

/** Outcome of a remove, including the non-fatal follow-up work. */
export interface RemoveWorktreeResult {
  status: "ok" | "failed";
  /** Absolute path of the worktree that was, or would have been, removed. */
  path: string;
  /** The branch the worktree was on; null when it was detached. */
  branch: string | null;
  /** Sha the deleted branch pointed at, for `git branch <name> <sha>` recovery. */
  deletedBranchSha: string | null;
  pull: PullOutcome;
  /** Non-fatal notes: a skipped or failed pull, a branch left in place. */
  warnings: string[];
  /** Failure reason, present only on a failed remove. */
  error?: string;
}

/** Outcome of a prune. */
export interface PruneWorktreesResult {
  status: "ok" | "failed";
  /** Absolute paths of the worktrees whose stale admin entries were pruned. */
  pruned: string[];
  /** Failure reason, present only on a failed prune. */
  error?: string;
}

// The primary checkout of the repo containing `dir` — where the real `.git`
// lives, resolvable from any of its worktrees — or null when `dir` is not
// inside a git working tree.
const primaryCheckout = async (dir: string): Promise<string | null> => {
  const result = await runGit(dir, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!result.ok) return null;
  const commonDir = result.stdout.trim();
  return commonDir === "" ? null : dirname(commonDir);
};

const hasRef = async (repo: string, ref: string): Promise<boolean> =>
  (await runGit(repo, "show-ref", "--verify", "--quiet", ref)).ok;

const hasOrigin = async (repo: string): Promise<boolean> =>
  (await runGit(repo, "remote", "get-url", "origin")).ok;

// The branch HEAD points at, or null when detached.
const currentBranch = async (repo: string): Promise<string | null> =>
  (await runGit(repo, "symbolic-ref", "--quiet", "--short", "HEAD")).stdout.trim() || null;

const ORIGIN_HEAD_PREFIX = "refs/remotes/origin/";

// Branches tried, in order, when origin's HEAD is unset locally — the same
// convention git itself initialises repos with.
const FALLBACK_DEFAULT_BRANCHES = ["main", "master"];

/**
 * The repo's default branch: origin's HEAD when it is set locally, otherwise
 * whichever of main/master exists as a local branch. Never hits the network, so
 * a repo with neither has no discoverable default and yields null. `repo` is the
 * repo's primary checkout, or any directory inside one of its worktrees.
 */
export const defaultBranch = async (repo: string): Promise<string | null> => {
  const originHead = await runGit(repo, "symbolic-ref", "--quiet", `${ORIGIN_HEAD_PREFIX}HEAD`);
  if (originHead.ok) return originHead.stdout.trim().slice(ORIGIN_HEAD_PREFIX.length);
  for (const name of FALLBACK_DEFAULT_BRANCHES) {
    if (await hasRef(repo, `refs/heads/${name}`)) return name;
  }
  return null;
};

// The base a brand-new branch is cut from when the caller names none: the
// default branch on origin, or the local default branch when origin has no
// copy of it.
const defaultBaseRef = async (repo: string): Promise<string | null> => {
  const branch = await defaultBranch(repo);
  if (branch === null) return null;
  return (await hasRef(repo, `refs/remotes/origin/${branch}`)) ? `origin/${branch}` : branch;
};

// The directory suffix when the caller names none: the branch with its slashes
// flattened, so a nested branch still yields a single sibling directory.
const slugifyBranch = (branch: string): string => branch.replaceAll("/", "-");

/**
 * Create a worktree for `repoPath`'s repo as a sibling of its primary checkout,
 * named `<repo>-<name>`, where `name` defaults to the branch with its slashes
 * flattened. The branch is checked out when it exists
 * locally, tracked when it exists on origin, and otherwise created from
 * `baseRef`. Refuses to create over an existing directory. Unless `skipPrepare`
 * is set the prep pipeline then runs with the repo's resolved policy (defaults
 * merged with its `repos:` override), its report carried on the result; `run`
 * is forwarded to the pipeline so command execution can be stubbed.
 */
export async function createWorktree(
  options: CreateWorktreeOptions,
  run: CommandRunner = defaultCommandRunner,
): Promise<CreateWorktreeResult> {
  const { repoPath, branch, skipPrepare = false, config } = options;

  const primary = await primaryCheckout(repoPath);
  if (primary === null) {
    return {
      status: "failed",
      path: "",
      branch,
      branchSource: null,
      baseRef: null,
      prepare: null,
      error: `'${repoPath}' is not a git repository`,
    };
  }

  const name = options.name ?? slugifyBranch(branch);
  const path = join(dirname(primary), `${basename(primary)}-${name}`);
  const failed = (error: string): CreateWorktreeResult => ({
    status: "failed",
    path,
    branch,
    branchSource: null,
    baseRef: null,
    prepare: null,
    error,
  });

  if (existsSync(path)) return failed(`'${path}' already exists`);

  // Refresh refs so origin's branches and default are current. A failed fetch
  // is not fatal — branch resolution falls back to the refs already on disk.
  if (await hasOrigin(primary)) await runGit(primary, "fetch", "origin", "--quiet");

  let branchSource: BranchSource;
  let baseRef: string | null = null;
  let added: GitResult;
  if (await hasRef(primary, `refs/heads/${branch}`)) {
    branchSource = "local";
    added = await runGit(primary, "worktree", "add", path, branch);
  } else if (await hasRef(primary, `refs/remotes/origin/${branch}`)) {
    branchSource = "remote";
    added = await runGit(
      primary,
      "worktree",
      "add",
      "--track",
      "-b",
      branch,
      path,
      `origin/${branch}`,
    );
  } else {
    baseRef = options.baseRef ?? (await defaultBaseRef(primary));
    if (baseRef === null) {
      return failed(
        "could not work out a base ref: origin has no HEAD and there is no local main or master branch",
      );
    }
    branchSource = "new";
    added = await runGit(primary, "worktree", "add", "-b", branch, path, baseRef);
  }
  if (!added.ok) return failed(added.stderr);

  const created: CreateWorktreeResult = {
    status: "ok",
    path,
    branch,
    branchSource,
    baseRef,
    prepare: null,
  };
  if (skipPrepare) return created;

  const { prepare } = resolveWorktreeConfig(config, basename(primary));
  const report = await prepareWorktree(
    primary,
    path,
    {
      env: prepare.env ?? undefined,
      install: prepare.install,
      postCreate: prepare.postCreate,
    },
    run,
  );
  if (report.status === "failed") {
    const failedStep = report.steps[report.steps.length - 1];
    return {
      ...created,
      status: "failed",
      prepare: report,
      error: `prepare failed: ${failedStep.name}`,
    };
  }
  return { ...created, prepare: report };
}

/**
 * Remove a linked worktree — directory and all — then tidy up after it: prune
 * the stale admin entry, fast-forward the primary checkout when it sits on the
 * default branch with an origin remote, and delete the worktree's branch with
 * `-D` (squash merges mean git rarely sees a branch as merged), reporting the
 * sha it was on so `git branch <name> <sha>` can recover it. Refuses to remove
 * a dirty worktree unless `force`, and never removes the primary checkout or
 * deletes the default branch. Env symlinks are unlinked with the directory,
 * never followed, so the primary's env files are untouched. A failed pull or
 * branch deletion warns rather than fails the removal.
 */
export async function removeWorktree(
  worktreePath: string,
  force = false,
): Promise<RemoveWorktreeResult> {
  const primary = await primaryCheckout(worktreePath);
  const failed = (path: string, error: string): RemoveWorktreeResult => ({
    status: "failed",
    path,
    branch: null,
    deletedBranchSha: null,
    pull: "skipped",
    warnings: [],
    error,
  });
  if (primary === null) return failed(worktreePath, `'${worktreePath}' is not a git worktree`);

  const path = (await runGit(worktreePath, "rev-parse", "--show-toplevel")).stdout.trim();
  if (path === primary) {
    return failed(path, `'${path}' is the primary checkout, not a linked worktree`);
  }

  const status = (await runGit(path, "status", "--porcelain")).stdout.trim();
  if (!force && status !== "") {
    return failed(path, `'${path}' has uncommitted changes; re-run with force to remove it anyway`);
  }

  const branch = await currentBranch(path);
  const branchSha =
    branch === null ? null : (await runGit(primary, "rev-parse", branch)).stdout.trim();

  const removeArgs = force ? ["worktree", "remove", "--force", path] : ["worktree", "remove", path];
  const removed = await runGit(primary, ...removeArgs);
  if (!removed.ok) return failed(path, removed.stderr);
  await runGit(primary, "worktree", "prune");

  const warnings: string[] = [];
  const defaultName = await defaultBranch(primary);
  const current = await currentBranch(primary);

  let pull: PullOutcome = "skipped";
  if (defaultName === null) {
    warnings.push("could not work out the default branch — skipped the pull");
  } else if (current !== defaultName) {
    warnings.push(
      `the primary checkout is on '${current ?? "a detached HEAD"}', not '${defaultName}' — skipped the pull`,
    );
  } else if (!(await hasOrigin(primary))) {
    warnings.push("no origin remote — skipped the pull");
  } else {
    // --no-rebase overrides a global pull.rebase=true, which refuses to pull
    // whenever the checkout has unstaged changes; --ff-only still means this
    // can only fast-forward, never merge.
    const pulled = await runGit(primary, "pull", "--ff-only", "--no-rebase");
    pull = pulled.ok ? "ok" : "failed";
    if (!pulled.ok) warnings.push(`pull failed — sort it out in ${primary}: ${pulled.stderr}`);
  }

  let deletedBranchSha: string | null = null;
  if (branch !== null) {
    if (branch === defaultName) {
      warnings.push(`'${branch}' is the default branch — left it in place`);
    } else {
      const deleted = await runGit(primary, "branch", "-D", branch);
      if (deleted.ok) deletedBranchSha = branchSha;
      else warnings.push(`could not delete branch '${branch}': ${deleted.stderr}`);
    }
  }

  return { status: "ok", path, branch, deletedBranchSha, pull, warnings };
}

/**
 * Prune the stale worktree admin entries of `repoPath`'s repo — the records git
 * still holds for worktrees whose directories have gone — reporting the paths
 * that were pruned.
 */
export async function pruneWorktrees(repoPath: string): Promise<PruneWorktreesResult> {
  const primary = await primaryCheckout(repoPath);
  if (primary === null) {
    return { status: "failed", pruned: [], error: `'${repoPath}' is not a git repository` };
  }

  // Read the prunable set first: git reports what it pruned only on stderr,
  // and exits successfully either way.
  const [repo] = await discoverRepos([primary]);
  const prunable = repo.worktrees.filter((worktree) => worktree.prunable).map(({ path }) => path);

  await runGit(primary, "worktree", "prune");
  return { status: "ok", pruned: prunable };
}
