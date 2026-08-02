import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConflictCache, repoConflicts } from "./conflicts.ts";
import { gitOverview } from "./overview.ts";
import type { RepoOverview } from "./overview.ts";

const git = (cwd: string, ...args: string[]): string => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
};

// A repo at `dir` on `main` with two committed files.
const initRepo = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "a.txt"), "one\n");
  writeFileSync(join(dir, "b.txt"), "two\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
};

const commitInto = (dir: string, files: Record<string, string>, message: string): void => {
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  git(dir, "commit", "-qam", message);
};

describe("checking whether a worktree still merges into the default branch", () => {
  let base: string;
  let root: string;
  let origin: string;
  let clone: string;

  // A repo cloned from `origin`, so it has a real `origin/main` to merge into.
  // Its primary checkout is parked on a branch of its own, leaving `main` free
  // for a linked worktree to hold — git lets only one checkout have a branch.
  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "kiri-conflicts-")));
    root = join(base, "root");
    mkdirSync(root, { recursive: true });
    origin = join(base, "origin");
    initRepo(origin);
    git(origin, "config", "receive.denyCurrentBranch", "ignore");
    clone = join(root, "project");
    git(root, "clone", "-q", origin, "project");
    git(clone, "config", "user.email", "test@example.com");
    git(clone, "config", "user.name", "Test");
    git(clone, "checkout", "-q", "-b", "scratch");
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  // A linked worktree of the clone on `branch`, cut from the current main.
  const addWorktree = (name: string, branch: string): string => {
    const path = join(root, name);
    git(clone, "worktree", "add", "-q", "-b", branch, path, "main");
    git(path, "config", "user.email", "test@example.com");
    git(path, "config", "user.name", "Test");
    return path;
  };

  // Move origin's main on, then bring the clone's remote-tracking ref with it.
  const moveOrigin = (files: Record<string, string>): void => {
    commitInto(origin, files, "moved on");
    git(clone, "fetch", "-q", "origin");
  };

  const overview = async (): Promise<RepoOverview> => (await gitOverview([root])).repos[0];

  it("names the files a branch would conflict in", async () => {
    const path = addWorktree("project-feature", "feature");
    commitInto(path, { "a.txt": "branch\n", "b.txt": "branch\n" }, "branch edit");
    moveOrigin({ "a.txt": "origin\n", "b.txt": "origin\n" });

    const result = await repoConflicts(await overview());

    expect(result.base).toBe("origin/main");
    expect(result.worktrees).toEqual([{ path, files: ["a.txt", "b.txt"] }]);
  });

  it("reports a branch that still merges cleanly as conflicting in nothing", async () => {
    const path = addWorktree("project-feature", "feature");
    commitInto(path, { "a.txt": "branch\n" }, "branch edit");
    moveOrigin({ "b.txt": "origin\n" });

    const result = await repoConflicts(await overview());

    expect(result.worktrees).toEqual([{ path, files: [] }]);
  });

  it("says nothing about the primary checkout", async () => {
    const result = await repoConflicts(await overview());

    expect(result.worktrees).toEqual([]);
  });

  it("says nothing about a worktree sitting on the default branch", async () => {
    git(clone, "worktree", "add", "-q", join(root, "project-main"), "main");

    const result = await repoConflicts(await overview());

    expect(result.worktrees).toEqual([]);
  });

  it("says nothing about a detached worktree", async () => {
    const path = join(root, "project-detached");
    git(clone, "worktree", "add", "-q", "--detach", path, "main");

    const result = await repoConflicts(await overview());

    expect(result.worktrees).toEqual([]);
  });

  it("says nothing at all when origin has no copy of the default branch", async () => {
    addWorktree("project-feature", "feature");
    const repo = await overview();

    const result = await repoConflicts({ ...repo, defaultBranch: "no-such-branch" });

    expect(result.base).toBeNull();
    expect(result.worktrees).toEqual([]);
  });

  it("says nothing at all when the repo has no discoverable default branch", async () => {
    addWorktree("project-feature", "feature");
    const repo = await overview();

    const result = await repoConflicts({ ...repo, defaultBranch: null });

    expect(result.base).toBeNull();
    expect(result.worktrees).toEqual([]);
  });

  it("omits a worktree whose merge git cannot compute rather than calling it clean", async () => {
    // An unrelated history has no merge base, so the merge has no answer.
    const path = addWorktree("project-feature", "feature");
    git(path, "checkout", "-q", "--orphan", "feature-orphan");
    git(path, "commit", "-q", "-m", "unrelated", "--allow-empty");

    const result = await repoConflicts(await overview());

    expect(result.worktrees).toEqual([]);
  });

  describe("remembering what the check found", () => {
    it("attaches a remembered answer to the worktree it is about", async () => {
      const path = addWorktree("project-feature", "feature");
      commitInto(path, { "a.txt": "branch\n" }, "branch edit");
      moveOrigin({ "a.txt": "origin\n" });
      const repo = await overview();
      const cache = createConflictCache();

      cache.record(repo, await repoConflicts(repo));
      const attached = cache.attach({ roots: [root], repos: [repo] });

      const worktree = attached.repos[0].worktrees.find((w) => w.path === path);
      expect(worktree?.conflicts).toEqual(["a.txt"]);
    });

    it("says nothing about a repo the check has never run for", async () => {
      const path = addWorktree("project-feature", "feature");
      const repo = await overview();
      const cache = createConflictCache();

      const attached = cache.attach({ roots: [root], repos: [repo] });

      expect(attached.repos[0].worktrees.find((w) => w.path === path)?.conflicts).toBeUndefined();
    });

    it("drops an answer once the worktree's branch has moved", async () => {
      const path = addWorktree("project-feature", "feature");
      commitInto(path, { "a.txt": "branch\n" }, "branch edit");
      moveOrigin({ "a.txt": "origin\n" });
      const repo = await overview();
      const cache = createConflictCache();
      cache.record(repo, await repoConflicts(repo));

      commitInto(path, { "a.txt": "branch again\n" }, "another branch edit");
      const attached = cache.attach({ roots: [root], repos: [await overview()] });

      expect(attached.repos[0].worktrees.find((w) => w.path === path)?.conflicts).toBeUndefined();
    });

    it("drops an answer once the repo has fetched again", async () => {
      const path = addWorktree("project-feature", "feature");
      commitInto(path, { "a.txt": "branch\n" }, "branch edit");
      moveOrigin({ "a.txt": "origin\n" });
      const repo = await overview();
      const cache = createConflictCache();
      cache.record(repo, await repoConflicts(repo));

      const attached = cache.attach({
        roots: [root],
        repos: [{ ...repo, lastFetchedAt: new Date(Date.now() + 60_000).toISOString() }],
      });

      expect(attached.repos[0].worktrees.find((w) => w.path === path)?.conflicts).toBeUndefined();
    });

    it("leaves a worktree the check had no answer for unmarked", async () => {
      addWorktree("project-feature", "feature");
      const repo = await overview();
      const cache = createConflictCache();

      cache.record(repo, { repo: repo.name, base: "origin/main", worktrees: [] });
      const attached = cache.attach({ roots: [root], repos: [repo] });

      expect(attached.repos[0].worktrees.every((w) => w.conflicts === undefined)).toBe(true);
    });
  });
});
