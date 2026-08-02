import { isAbsolute } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { loadKiriConfig } from "../config/loader.ts";
import type { ConfigStore } from "../config/store.ts";
import { changeset, filePatch } from "../git/changeset.ts";
import { createWorktree, pruneWorktrees, removeWorktree } from "../git/operations.ts";
import type { RepoOverview } from "../git/overview.ts";
import type { GitSnapshotStore } from "../git/snapshot.ts";
import { updateRepo, updateRepos } from "../git/sync.ts";
import { onZodFail } from "./shared.ts";

export interface GitRoutesDeps {
  /** The server-held overview. Reads serve it; mutations refresh it. */
  snapshot: GitSnapshotStore;
  /** Workspace config — the `git:` section drives a new worktree's prep pipeline. */
  config: ConfigStore;
  /** Environment the config load resolves against. */
  env: Record<string, string | undefined>;
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

const changesetQuerySchema = z
  .object({ path: z.string().min(1), view: z.enum(["uncommitted", "branch"]) })
  .strict();

const patchQuerySchema = changesetQuerySchema
  .extend({ file: z.string().min(1), previousPath: z.string().min(1).optional() })
  .strict();

// A file is addressed relative to its checkout, so an absolute path or one
// climbing out of it is refused rather than handed to git as a pathspec.
const insideCheckout = (file: string): boolean =>
  !isAbsolute(file) && !file.split("/").includes("..");

const updateBodySchema = z.object({ repo: z.string().min(1) }).strict();

/**
 * Build the Hono sub-app for `/api/git`. `GET /` answers from the snapshot —
 * the scanned roots plus each discovered repo with its default branch and the
 * status of its primary checkout and linked worktrees, alongside when that was
 * last scanned and whether a scan is running. It never touches the config, git,
 * or the disk, so it returns whatever is known right now rather than waiting for
 * a scan — the model it holds is renewed by the watcher, by a config change, and
 * by every mutation below.
 *
 * The changeset reads are the exception to answering from memory: `GET
 * /changeset` and `GET /changeset/patch` run git per request, because holding
 * every checkout's diffs would cost far more than it saves. One answers with a
 * checkout's changed files in the requested view, the other with a single file's
 * patch — served as git wrote it — so opening a changeset never means loading
 * every diff in it.
 *
 * The mutations mirror the operations core: `POST /create` adds a worktree and
 * runs the repo's prep pipeline, `POST /remove` deletes one and tidies up after
 * it, and `POST /prune` clears a repo's stale admin entries. Each addresses only
 * the repos and worktrees the configured roots reach, so a path outside them is
 * refused rather than driving git somewhere unexpected, and each refreshes the
 * snapshot on success — which publishes `git.changed`, so every open client
 * converges on a model that already includes the change. A create whose prep
 * pipeline failed still left a worktree on disk, so it answers 200 with the
 * report rather than an error; a create that never made one answers 400.
 *
 * `POST /update` and `POST /update-all` bring repos up to date: each fetches a
 * repo and fast-forwards every checkout of it that can take one. Update-all is
 * one request rather than a job — every discovered repo updated with the same
 * bound the scan runs under, the whole set of outcomes back together, and one
 * snapshot refresh when it settles, so one repo failing never takes down the
 * rest. An outcome is never an error: a refusal and a failed fetch both answer
 * 200 carrying their reason, since the request itself succeeded in finding out.
 *
 * Mounted unconditionally: with no roots configured it answers with an empty
 * model, which is how the client learns there is nothing to scan.
 */
export function gitRoutes(deps: GitRoutesDeps): Hono {
  const app = new Hono();

  const gitConfig = () => loadKiriConfig(deps.config, deps.env).git;

  // Both guards below resolve against the snapshot rather than a targeted fresh
  // read: a guard and the read that put the button on screen then agree, and a
  // stale answer is safe in both directions. A worktree that has since gone
  // fails in the operation itself, with git's own reason; one that has since
  // appeared is refused until the refresh behind it lands, moments later.
  const known = () => deps.snapshot.current();

  // The repo a request names, by directory name or by the absolute path of any
  // of its checkouts. Only repos the configured roots reach resolve.
  const findRepo = (repo: string): RepoOverview | undefined =>
    known().repos.find(
      (candidate) =>
        candidate.name === repo ||
        candidate.root === repo ||
        candidate.worktrees.some((worktree) => worktree.path === repo),
    );

  // The repo a checkout belongs to, so a changeset resolves the default branch
  // it is reviewed against without a second read of the disk.
  const findCheckout = (path: string): RepoOverview | undefined =>
    known().repos.find((repo) => repo.worktrees.some((worktree) => worktree.path === path));

  app.get("/", (c) => c.json(deps.snapshot.current()));

  app.get(
    "/changeset",
    zValidator("query", changesetQuerySchema, onZodFail("invalid changeset request")),
    async (c) => {
      const { path, view } = c.req.valid("query");
      const repo = findCheckout(path);
      if (repo === undefined) {
        return c.json(
          { error: `no checkout at "${path}" under the configured worktree roots` },
          404,
        );
      }
      return c.json(await changeset({ path, view, defaultBranch: repo.defaultBranch }));
    },
  );

  app.get(
    "/changeset/patch",
    zValidator("query", patchQuerySchema, onZodFail("invalid patch request")),
    async (c) => {
      const { path, view, file, previousPath } = c.req.valid("query");
      const repo = findCheckout(path);
      if (repo === undefined) {
        return c.json(
          { error: `no checkout at "${path}" under the configured worktree roots` },
          404,
        );
      }
      if (!insideCheckout(file) || (previousPath !== undefined && !insideCheckout(previousPath))) {
        return c.json({ error: "file must be a path inside the checkout" }, 400);
      }
      return c.json(
        await filePatch({ path, view, file, previousPath, defaultBranch: repo.defaultBranch }),
      );
    },
  );

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
      await deps.snapshot.refresh();
      return c.json(result);
    },
  );

  app.post(
    "/remove",
    zValidator("json", removeBodySchema, onZodFail("invalid remove request")),
    async (c) => {
      const { path, force } = c.req.valid("json");
      const linked = known().repos.some((repo) =>
        repo.worktrees.some((worktree) => worktree.path === path && !worktree.primary),
      );
      if (!linked) {
        return c.json(
          { error: `no linked worktree at "${path}" under the configured worktree roots` },
          404,
        );
      }

      const result = await removeWorktree(path, force);
      if (result.status === "failed") return c.json({ error: result.error }, 400);
      await deps.snapshot.refresh();
      return c.json(result);
    },
  );

  app.post(
    "/prune",
    zValidator("json", pruneBodySchema, onZodFail("invalid prune request")),
    async (c) => {
      const { repo } = c.req.valid("json");
      const target = findRepo(repo);
      if (target === undefined) {
        return c.json({ error: `no repo "${repo}" under the configured worktree roots` }, 404);
      }
      // `repo` resolved through the discovered repos, so the prune itself can only
      // succeed — its failure mode is a path that isn't a repo.
      const result = await pruneWorktrees(target.root);
      await deps.snapshot.refresh();
      return c.json({ repo: target.name, pruned: result.pruned });
    },
  );

  app.post(
    "/update",
    zValidator("json", updateBodySchema, onZodFail("invalid update request")),
    async (c) => {
      const { repo } = c.req.valid("json");
      const target = findRepo(repo);
      if (target === undefined) {
        return c.json({ error: `no repo "${repo}" under the configured worktree roots` }, 404);
      }
      const result = await updateRepo(target);
      await deps.snapshot.refresh();
      return c.json(result);
    },
  );

  app.post("/update-all", async (c) => {
    const results = await updateRepos(known().repos);
    await deps.snapshot.refresh();
    return c.json({ results });
  });

  return app;
}
