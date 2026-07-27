import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { createConfigStore } from "../config/store.ts";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import type { CommandResult, CommandRunner } from "../worktrees/prepare.ts";
import type { WorktreesConfig } from "../worktrees/schema.ts";
import { worktreeTools } from "./worktree-tools.ts";

const git = (cwd: string, ...args: string[]): string => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
};

// Invoke a tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (t: ToolSet[string], input: unknown = {}): Promise<Record<string, unknown>> =>
  (
    t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<Record<string, unknown>>
  )(input, { toolCallId: "call-1", messages: [] } as unknown as ToolExecutionOptions);

// A runner that fails the test if the prep pipeline dispatches anything.
const neverRun: CommandRunner = async (command) => {
  throw new Error(`unexpected command: ${command}`);
};

const failingRunner =
  (result: CommandResult): CommandRunner =>
  async () =>
    result;

describe("worktreeTools", () => {
  let base: string;
  // The scanned root, kept clear of the bare origins so discovery finds only
  // the repos a test set up under it.
  let root: string;
  let published: KiriEvent[];

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "kiri-worktree-tools-")));
    root = join(base, "roots");
    mkdirSync(root);
    published = [];
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const at = (name: string): string => join(root, name);

  // A repo with a bare `origin` holding `main`, and origin/HEAD set locally,
  // so branch resolution and the post-remove pull have a remote to work with.
  const initRepo = (name = "repo"): string => {
    const origin = join(base, "origins", `${name}.git`);
    mkdirSync(origin, { recursive: true });
    git(origin, "init", "-q", "--bare", "-b", "main");
    const repo = at(name);
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
    writeFileSync(join(repo, "file.txt"), "hello");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "init");
    git(repo, "remote", "add", "origin", origin);
    git(repo, "push", "-q", "-u", "origin", "main");
    git(repo, "remote", "set-head", "origin", "-a");
    return repo;
  };

  // A real bus, so the tools' publishes are observed exactly as a live client
  // would receive them.
  const bus = createEventBus();
  bus.subscribe((event) => published.push(event));

  const tools = (
    roots: string[] = [root],
    options: { config?: Omit<WorktreesConfig, "roots">; run?: CommandRunner } = {},
  ): ToolSet =>
    worktreeTools({
      config: createConfigStore(base),
      getWorktreesConfig: () => ({ roots, ...options.config }),
      bus,
      run: options.run ?? neverRun,
    });

  describe("worktree_list", () => {
    it("reports the scanned roots and the repos found under them", async () => {
      const repo = initRepo();

      const result = await run(tools().worktree_list);

      expect(result.roots).toEqual([root]);
      expect(result.repos).toEqual([
        {
          name: "repo",
          root: repo,
          worktrees: [
            {
              path: repo,
              branch: "main",
              primary: true,
              dirty: undefined,
              ahead: undefined,
              behind: undefined,
              upstream_gone: undefined,
              locked: undefined,
              prunable: undefined,
            },
          ],
        },
      ]);
    });

    it("carries the live state of a linked worktree", async () => {
      const repo = initRepo();
      await run(tools().worktree_create, { repo: "repo", branch: "feature", skip_prepare: true });
      const worktree = at("repo-feature");
      writeFileSync(join(worktree, "file.txt"), "changed");

      const result = await run(tools().worktree_list);
      const [found] = result.repos as [{ worktrees: Record<string, unknown>[] }];

      expect(found.worktrees[1]).toMatchObject({
        path: worktree,
        branch: "feature",
        dirty: true,
      });
      expect(repo).toBe(at("repo"));
    });

    it("reports no repos when the configured roots hold none", async () => {
      const result = await run(tools([at("empty")]).worktree_list);

      expect(result.repos).toEqual([]);
    });
  });

  describe("worktree_create", () => {
    it("creates a worktree for a new branch and publishes the change", async () => {
      initRepo();

      const result = await run(tools().worktree_create, {
        repo: "repo",
        branch: "feature",
        skip_prepare: true,
      });

      expect(result).toMatchObject({
        status: "ok",
        path: at("repo-feature"),
        branch: "feature",
        branch_source: "new",
        base_ref: "origin/main",
        prepare: null,
      });
      expect(existsSync(at("repo-feature"))).toBe(true);
      expect(published).toEqual([{ type: "worktrees.changed" }]);
    });

    it("names the directory after the supplied name and cuts from the given base", async () => {
      const repo = initRepo();
      git(repo, "branch", "release");

      const result = await run(tools().worktree_create, {
        repo: repo,
        branch: "work/thing",
        name: "custom",
        base_ref: "release",
        skip_prepare: true,
      });

      expect(result.path).toBe(at("repo-custom"));
      expect(result.base_ref).toBe("release");
    });

    it("runs the repo's prep pipeline and reports it", async () => {
      initRepo();
      const commands: string[] = [];
      const runner: CommandRunner = async (command) => {
        commands.push(command);
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const result = await run(
        tools([root], {
          config: { defaults: { prepare: { install: "off", postCreate: ["echo ready"] } } },
          run: runner,
        }).worktree_create,
        { repo: "repo", branch: "feature" },
      );

      expect(commands).toEqual(["echo ready"]);
      expect(result.prepare).toMatchObject({ status: "ok" });
    });

    it("returns a failed prep as a result carrying its report, the worktree left in place", async () => {
      initRepo();

      const result = await run(
        tools([root], {
          config: { defaults: { prepare: { install: "off", postCreate: ["boom"] } } },
          run: failingRunner({ exitCode: 1, stdout: "", stderr: "nope" }),
        }).worktree_create,
        { repo: "repo", branch: "feature" },
      );

      expect(result.status).toBe("failed");
      expect(result.prepare).toMatchObject({ status: "failed" });
      expect(existsSync(at("repo-feature"))).toBe(true);
      expect(published).toEqual([{ type: "worktrees.changed" }]);
    });

    it("throws naming worktree_list for a repo outside the configured roots", async () => {
      initRepo();

      await expect(
        run(tools().worktree_create, { repo: "other", branch: "feature" }),
      ).rejects.toThrow(/No repo "other".*worktree_list/s);
      expect(published).toEqual([]);
    });

    it("throws when the worktree could not be created at all", async () => {
      initRepo();
      mkdirSync(at("repo-feature"));

      await expect(
        run(tools().worktree_create, { repo: "repo", branch: "feature" }),
      ).rejects.toThrow(/already exists/);
      expect(published).toEqual([]);
    });
  });

  describe("worktree_remove", () => {
    const createFeature = async (branch = "feature"): Promise<string> => {
      const result = await run(tools().worktree_create, {
        repo: "repo",
        branch,
        skip_prepare: true,
      });
      published = [];
      return result.path as string;
    };

    it("removes a linked worktree, reports the deleted branch, and publishes", async () => {
      initRepo();
      const worktree = await createFeature();

      const result = await run(tools().worktree_remove, { path: worktree });

      expect(result).toMatchObject({ path: worktree, branch: "feature", pull: "ok" });
      expect(result.deleted_branch_sha).toMatch(/^[0-9a-f]{40}$/);
      expect(existsSync(worktree)).toBe(false);
      expect(published).toEqual([{ type: "worktrees.changed" }]);
    });

    it("refuses a worktree with uncommitted changes, naming force", async () => {
      initRepo();
      const worktree = await createFeature();
      writeFileSync(join(worktree, "file.txt"), "changed");

      await expect(run(tools().worktree_remove, { path: worktree })).rejects.toThrow(
        /uncommitted changes.*force: true/s,
      );
      expect(existsSync(worktree)).toBe(true);
      expect(published).toEqual([]);
    });

    it("names unpushed commits in the refusal", async () => {
      initRepo();
      const worktree = await createFeature();
      git(worktree, "push", "-q", "-u", "origin", "feature");
      writeFileSync(join(worktree, "file.txt"), "more");
      git(worktree, "commit", "-qam", "more");

      await expect(run(tools().worktree_remove, { path: worktree })).rejects.toThrow(
        /1 commit not pushed/,
      );
    });

    it("removes a dirty worktree when forced", async () => {
      initRepo();
      const worktree = await createFeature();
      writeFileSync(join(worktree, "file.txt"), "changed");

      const result = await run(tools().worktree_remove, { path: worktree, force: true });

      expect(result.path).toBe(worktree);
      expect(existsSync(worktree)).toBe(false);
    });

    it("throws for a path that is not a discovered worktree", async () => {
      initRepo();

      await expect(run(tools().worktree_remove, { path: at("nowhere") })).rejects.toThrow(
        /No worktree at.*worktree_list/s,
      );
    });

    it("refuses the repo's primary checkout", async () => {
      const repo = initRepo();

      await expect(run(tools().worktree_remove, { path: repo })).rejects.toThrow(
        /primary checkout/,
      );
    });

    it("surfaces a removal git refuses", async () => {
      initRepo();
      const worktree = await createFeature();
      git(at("repo"), "worktree", "lock", worktree);

      await expect(run(tools().worktree_remove, { path: worktree })).rejects.toThrow(
        /Could not remove/,
      );
      expect(existsSync(worktree)).toBe(true);
    });
  });

  describe("worktree_prune", () => {
    it("prunes stale admin entries and publishes the change", async () => {
      initRepo();
      const worktree = await run(tools().worktree_create, {
        repo: "repo",
        branch: "feature",
        skip_prepare: true,
      });
      rmSync(worktree.path as string, { recursive: true, force: true });
      published = [];

      const result = await run(tools().worktree_prune, { repo: "repo" });

      expect(result).toEqual({ repo: "repo", pruned: [worktree.path] });
      expect(published).toEqual([{ type: "worktrees.changed" }]);
    });

    it("publishes nothing when there was nothing to prune", async () => {
      initRepo();

      const result = await run(tools().worktree_prune, { repo: "repo" });

      expect(result).toEqual({ repo: "repo", pruned: [] });
      expect(published).toEqual([]);
    });

    it("throws for a repo outside the configured roots", async () => {
      initRepo();

      await expect(run(tools().worktree_prune, { repo: "other" })).rejects.toThrow(/worktree_list/);
    });
  });
});
