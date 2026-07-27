import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { ConfigStore } from "../config/store.ts";
import type { EventBus } from "../events/index.ts";
import { resolveWorktreeRoots } from "../worktrees/config.ts";
import { createWorktree, pruneWorktrees, removeWorktree } from "../worktrees/operations.ts";
import { type RepoOverview, worktreesOverview } from "../worktrees/overview.ts";
import { type CommandRunner, defaultCommandRunner } from "../worktrees/prepare.ts";
import type { WorktreesConfig } from "../worktrees/schema.ts";
import type { WorktreeStatus } from "../worktrees/status.ts";

export interface WorktreeToolsDeps {
  /** Workspace config; the configured roots resolve against its working directory. */
  config: ConfigStore;
  /**
   * The `worktrees:` config section, read live per call so a `kiri.yaml` edit
   * applies on the next call. Its `roots` bound what these tools can reach and
   * its prep policy is what a create runs.
   */
  getWorktreesConfig: () => WorktreesConfig | undefined;
  /** When supplied, a create, remove, or prune publishes `worktrees.changed` so live clients refetch. */
  bus?: EventBus;
  /** Command runner for the prep pipeline; injectable so tests never invoke package managers. */
  run?: CommandRunner;
}

// One worktree as the model sees it: the fields that drive a decision, with
// the incidental flags carried only when they are true, so a repo with a dozen
// clean worktrees costs a dozen short lines rather than a wall of `false`.
const compactWorktree = (worktree: WorktreeStatus) => ({
  path: worktree.path,
  branch: worktree.branch,
  primary: worktree.primary || undefined,
  dirty: worktree.dirty || undefined,
  ahead: worktree.ahead || undefined,
  behind: worktree.behind || undefined,
  upstream_gone: worktree.upstreamGone || undefined,
  locked: worktree.locked || undefined,
  prunable: worktree.prunable || undefined,
});

const compactRepo = (repo: RepoOverview) => ({
  name: repo.name,
  root: repo.root,
  worktrees: repo.worktrees.map(compactWorktree),
});

// How a dirty or unpushed worktree is described back to the model when a
// remove is refused, so it can tell the user what would be lost rather than
// just that something was.
const describeUnsavedWork = (worktree: WorktreeStatus): string => {
  const parts: string[] = [];
  if (worktree.dirty) parts.push("uncommitted changes");
  if (worktree.ahead > 0) {
    parts.push(
      `${worktree.ahead} commit${worktree.ahead === 1 ? "" : "s"} not pushed to its upstream`,
    );
  }
  return parts.join(" and ");
};

/**
 * First-party tools for managing the user's git worktrees across the repos
 * under the configured `worktrees.roots`: `worktree_list` reports the grouped
 * model (each repo's primary checkout and linked worktrees with their live
 * state), `worktree_create` adds one — resolving or creating its branch and
 * running the repo's prep pipeline — `worktree_remove` deletes one and tidies
 * up after it, and `worktree_prune` clears stale admin entries. Every tool
 * addresses repos and worktrees the roots actually reach, so a path outside
 * them is rejected rather than driving git somewhere unexpected. A create,
 * remove, or prune that changed anything publishes `worktrees.changed`, so the
 * app's worktree surface reflects it without a reload. Expected failures throw
 * with a message naming the call that recovers from them, surfaced to the model
 * as a tool error so the turn self-corrects.
 */
export function worktreeTools(deps: WorktreeToolsDeps): ToolSet {
  const { config, getWorktreesConfig, bus, run = defaultCommandRunner } = deps;

  const overview = () =>
    worktreesOverview(resolveWorktreeRoots(getWorktreesConfig(), config.cwd()));

  const changed = () => bus?.publish({ type: "worktrees.changed" });

  // The repo a call names, by directory name or by the absolute path of any of
  // its checkouts. Only repos the configured roots reach resolve.
  const requireRepo = (repo: string): RepoOverview => {
    const found = overview().repos.find(
      (candidate) =>
        candidate.name === repo ||
        candidate.root === repo ||
        candidate.worktrees.some((worktree) => worktree.path === repo),
    );
    if (found === undefined) {
      throw new Error(
        `No repo "${repo}" under the configured worktree roots — call worktree_list to see the repos kiri can reach.`,
      );
    }
    return found;
  };

  // The linked worktree a call names, by absolute path. The primary checkout
  // resolves but is rejected: removing it is never what was meant.
  const requireLinkedWorktree = (path: string): WorktreeStatus => {
    for (const repo of overview().repos) {
      const found = repo.worktrees.find((worktree) => worktree.path === path);
      if (found === undefined) continue;
      if (found.primary) {
        throw new Error(
          `"${path}" is ${repo.name}'s primary checkout, not a linked worktree — call worktree_list and pass the path of a linked worktree.`,
        );
      }
      return found;
    }
    throw new Error(
      `No worktree at "${path}" under the configured worktree roots — call worktree_list for the exact paths.`,
    );
  };

  return {
    worktree_list: tool({
      description:
        "List the git worktrees kiri can reach: the roots it scans, and for each repo found under them its directory name, its primary checkout, and every linked worktree with its branch and live state (dirty, commits ahead/behind its upstream, a gone upstream, locked, prunable). Call it before worktree_create, worktree_remove, or worktree_prune to get the exact repo name or worktree path — those calls only accept repos and worktrees this reports.",
      inputSchema: z.object({}),
      execute: async () => {
        const model = overview();
        return { roots: model.roots, repos: model.repos.map(compactRepo) };
      },
    }),

    worktree_create: tool({
      description:
        "Create a git worktree for one of the user's repos: an isolated checkout of a branch, as a sibling directory of the repo's primary checkout, so work happens off the checkout the user is sitting in. Reach for it when a piece of work wants its own branch and directory. The branch is checked out when it already exists locally, tracked when it exists on origin, and otherwise created from base_ref. The repo's configured prep runs after create (seeding env files, running its post-create commands, installing dependencies) and its report comes back with the result — a failed prep leaves the worktree in place, so report what failed rather than recreating it.",
      inputSchema: z.object({
        repo: z
          .string()
          .min(1)
          .describe(
            "Repo to create the worktree for — its directory name or an absolute checkout path, exactly as worktree_list reports it.",
          ),
        branch: z
          .string()
          .min(1)
          .describe(
            "Branch to check out. Reused when it already exists locally or on origin, otherwise created.",
          ),
        name: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Directory suffix for the worktree, giving `<repo>-<name>`. Defaults to the branch with its slashes flattened.",
          ),
        base_ref: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Base a brand-new branch is cut from. Ignored when the branch already exists. Defaults to the repo's default branch on origin.",
          ),
        skip_prepare: z
          .boolean()
          .optional()
          .describe(
            "Skip the prep pipeline, leaving the worktree bare — no env files, no post-create commands, no install. Defaults to false.",
          ),
      }),
      execute: async ({ repo, branch, name, base_ref, skip_prepare }) => {
        const target = requireRepo(repo);
        const result = await createWorktree(
          {
            repoPath: target.root,
            branch,
            name,
            baseRef: base_ref,
            skipPrepare: skip_prepare,
            config: getWorktreesConfig(),
          },
          run,
        );
        // A prep failure still leaves a usable worktree on disk, so it comes
        // back as a result carrying the report rather than an error that would
        // read as "nothing happened" and invite a retry over the new directory.
        if (result.status === "failed" && result.prepare === null) {
          throw new Error(
            `Could not create a worktree for "${target.name}": ${result.error} — call worktree_list to check the current worktrees, then retry with a different branch or name.`,
          );
        }
        changed();
        return {
          status: result.status,
          path: result.path,
          branch: result.branch,
          branch_source: result.branchSource,
          base_ref: result.baseRef,
          prepare: result.prepare,
          error: result.error,
        };
      },
    }),

    worktree_remove: tool({
      description:
        "Remove one of the user's linked git worktrees: deletes its directory, prunes the stale admin entry, fast-forwards the repo's primary checkout when it is sitting on the default branch, and deletes the worktree's branch — reporting the sha it was on, so the branch can be restored with `git branch <name> <sha>`. A worktree with uncommitted changes or unpushed commits is refused unless force is set; check with the user before forcing, since that work is lost for good. The repo's primary checkout can never be removed this way.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe(
            "Absolute path of the linked worktree to remove, exactly as worktree_list reports it.",
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            "Remove the worktree even though it has uncommitted changes, discarding them. Defaults to false.",
          ),
      }),
      execute: async ({ path, force }) => {
        const worktree = requireLinkedWorktree(path);
        const unsaved = describeUnsavedWork(worktree);
        if (unsaved !== "" && force !== true) {
          throw new Error(
            `"${path}" has ${unsaved} — nothing was removed. Tell the user what would be lost and, only if they want it gone anyway, call worktree_remove again with force: true.`,
          );
        }
        const result = removeWorktree(path, force);
        if (result.status === "failed") {
          throw new Error(
            `Could not remove "${path}": ${result.error} — call worktree_list to check its current state.`,
          );
        }
        changed();
        return {
          path: result.path,
          branch: result.branch,
          deleted_branch_sha: result.deletedBranchSha,
          pull: result.pull,
          warnings: result.warnings,
        };
      },
    }),

    worktree_prune: tool({
      description:
        "Prune a repo's stale worktree admin entries — the records git still holds for worktrees whose directories have gone, which worktree_list reports as prunable. Housekeeping only: it removes no directory and touches no branch. Returns the paths that were pruned.",
      inputSchema: z.object({
        repo: z
          .string()
          .min(1)
          .describe(
            "Repo to prune — its directory name or an absolute checkout path, exactly as worktree_list reports it.",
          ),
      }),
      execute: async ({ repo }) => {
        const target = requireRepo(repo);
        // `repo` resolved through the discovered repos, so the prune itself
        // can only succeed — its failure mode is a path that isn't a repo.
        const result = pruneWorktrees(target.root);
        if (result.pruned.length > 0) changed();
        return { repo: target.name, pruned: result.pruned };
      },
    }),
  };
}
