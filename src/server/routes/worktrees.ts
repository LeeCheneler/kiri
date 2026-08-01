import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { loadKiriConfig } from "../config/loader.ts";
import type { ConfigStore } from "../config/store.ts";
import type { EventBus } from "../events/index.ts";
import { resolveWorktreeRoots } from "../git/config.ts";
import { createWorktree, pruneWorktrees, removeWorktree } from "../git/operations.ts";
import { type RepoOverview, worktreesOverview } from "../git/overview.ts";
import { onZodFail } from "./shared.ts";

export interface WorktreesRoutesDeps {
  /** Workspace config — the scanned roots are read from its `git:` section. */
  config: ConfigStore;
  /** Environment the config load resolves against. */
  env: Record<string, string | undefined>;
  /** When supplied, a refresh or a mutation publishes `git.changed` so live clients refetch. */
  bus?: EventBus;
}

const createBodySchema = z
  .object({
    repo: z.string().min(1),
    branch: z.string().min(1),
    name: z.string().min(1).optional(),
    baseRef: z.string().min(1).optional(),
    skipPrepare: z.boolean().optional(),
  })
  .strict();

const removeBodySchema = z
  .object({ path: z.string().min(1), force: z.boolean().optional() })
  .strict();

const pruneBodySchema = z.object({ repo: z.string().min(1) }).strict();

/**
 * Build the Hono sub-app for `/api/worktrees`. `GET /` returns the grouped
 * model — the scanned roots plus each discovered repo with its default branch
 * and the live status of its primary checkout and linked worktrees — rebuilt
 * from disk per request, so it always reflects the current `git:` roots.
 * `POST /refresh` returns the same freshly-built model.
 *
 * The mutations mirror the operations core: `POST /create` adds a worktree and
 * runs the repo's prep pipeline, `POST /remove` deletes one and tidies up after
 * it, and `POST /prune` clears a repo's stale admin entries. Each addresses only
 * the repos and worktrees the configured roots reach, so a path outside them is
 * refused rather than driving git somewhere unexpected, and each publishes
 * `git.changed` on success so every open client converges. A create whose
 * prep pipeline failed still left a worktree on disk, so it answers 200 with the
 * report rather than an error; a create that never made one answers 400.
 *
 * Mounted unconditionally: with no roots configured it answers with an empty
 * model, which is how the client learns there is nothing to scan.
 */
export function worktreesRoutes(deps: WorktreesRoutesDeps): Hono {
  const app = new Hono();

  const gitConfig = () => loadKiriConfig(deps.config, deps.env).git;

  const overview = () => worktreesOverview(resolveWorktreeRoots(gitConfig(), deps.config.cwd()));

  const changed = () => deps.bus?.publish({ type: "git.changed" });

  // The repo a request names, by directory name or by the absolute path of any
  // of its checkouts. Only repos the configured roots reach resolve.
  const findRepo = (repo: string): RepoOverview | undefined =>
    overview().repos.find(
      (candidate) =>
        candidate.name === repo ||
        candidate.root === repo ||
        candidate.worktrees.some((worktree) => worktree.path === repo),
    );

  app.get("/", (c) => c.json(overview()));

  app.post("/refresh", (c) => {
    const result = overview();
    changed();
    return c.json(result);
  });

  app.post(
    "/create",
    zValidator("json", createBodySchema, onZodFail("invalid create request")),
    async (c) => {
      const body = c.req.valid("json");
      const target = findRepo(body.repo);
      if (target === undefined) {
        return c.json({ error: `no repo "${body.repo}" under the configured worktree roots` }, 404);
      }

      const result = await createWorktree({
        repoPath: target.root,
        branch: body.branch,
        name: body.name,
        baseRef: body.baseRef,
        skipPrepare: body.skipPrepare,
        config: gitConfig(),
      });
      // A prep failure still leaves a usable worktree on disk, so it comes back
      // as a result carrying the report; only a create that produced nothing is
      // an error.
      if (result.status === "failed" && result.prepare === null) {
        return c.json({ error: result.error }, 400);
      }
      changed();
      return c.json(result);
    },
  );

  app.post(
    "/remove",
    zValidator("json", removeBodySchema, onZodFail("invalid remove request")),
    (c) => {
      const { path, force } = c.req.valid("json");
      const known = overview().repos.some((repo) =>
        repo.worktrees.some((worktree) => worktree.path === path && !worktree.primary),
      );
      if (!known) {
        return c.json(
          { error: `no linked worktree at "${path}" under the configured worktree roots` },
          404,
        );
      }

      const result = removeWorktree(path, force);
      if (result.status === "failed") return c.json({ error: result.error }, 400);
      changed();
      return c.json(result);
    },
  );

  app.post(
    "/prune",
    zValidator("json", pruneBodySchema, onZodFail("invalid prune request")),
    (c) => {
      const { repo } = c.req.valid("json");
      const target = findRepo(repo);
      if (target === undefined) {
        return c.json({ error: `no repo "${repo}" under the configured worktree roots` }, 404);
      }
      // `repo` resolved through the discovered repos, so the prune itself can only
      // succeed — its failure mode is a path that isn't a repo.
      const result = pruneWorktrees(target.root);
      changed();
      return c.json({ repo: target.name, pruned: result.pruned });
    },
  );

  return app;
}
