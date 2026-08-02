import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withConflicts } from "./conflicts.ts";
import { type RepoOverview, gitOverview } from "./overview.ts";

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

  // The repo as the scan sees it, with the conflict answers already on it.
  const scanned = async (): Promise<RepoOverview> => (await gitOverview([root])).repos[0];

  // The repo as it stood before the conflict pass, so a test can re-run that
  // pass against a repo whose default branch it has altered.
  const unanswered = async (): Promise<RepoOverview> => {
    const repo = await scanned();
    return {
      ...repo,
      worktrees: repo.worktrees.map(({ conflicts, ...worktree }) => worktree),
    };
  };

  // What the scan concluded about one worktree: its files, or undefined when it
  // had no answer to give.
  const answerFor = async (path: string): Promise<string[] | undefined> =>
    (await scanned()).worktrees.find((worktree) => worktree.path === path)?.conflicts;

  it("names the files a branch would conflict in", async () => {
    const path = addWorktree("project-feature", "feature");
    commitInto(path, { "a.txt": "branch\n", "b.txt": "branch\n" }, "branch edit");
    moveOrigin({ "a.txt": "origin\n", "b.txt": "origin\n" });

    expect(await answerFor(path)).toEqual(["a.txt", "b.txt"]);
  });

  it("reports a branch that still merges cleanly as conflicting in nothing", async () => {
    const path = addWorktree("project-feature", "feature");
    commitInto(path, { "a.txt": "branch\n" }, "branch edit");
    moveOrigin({ "b.txt": "origin\n" });

    expect(await answerFor(path)).toEqual([]);
  });

  it("says nothing about the primary checkout", async () => {
    expect(await answerFor(clone)).toBeUndefined();
  });

  it("says nothing about a worktree sitting on the default branch", async () => {
    const path = join(root, "project-main");
    git(clone, "worktree", "add", "-q", path, "main");

    expect(await answerFor(path)).toBeUndefined();
  });

  it("says nothing about a detached worktree", async () => {
    const path = join(root, "project-detached");
    git(clone, "worktree", "add", "-q", "--detach", path, "main");

    expect(await answerFor(path)).toBeUndefined();
  });

  it("says nothing when origin has no copy of the default branch", async () => {
    const path = addWorktree("project-feature", "feature");
    const repo = await unanswered();

    const [reported] = await withConflicts([{ ...repo, defaultBranch: "no-such-branch" }]);

    expect(reported.worktrees.find((w) => w.path === path)?.conflicts).toBeUndefined();
  });

  it("says nothing when the repo has no discoverable default branch", async () => {
    const path = addWorktree("project-feature", "feature");
    const repo = await unanswered();

    const [reported] = await withConflicts([{ ...repo, defaultBranch: null }]);

    expect(reported.worktrees.find((w) => w.path === path)?.conflicts).toBeUndefined();
  });

  it("leaves a worktree whose merge git cannot compute unmarked rather than clean", async () => {
    // An unrelated history has no merge base, so the merge has no answer.
    const path = addWorktree("project-feature", "feature");
    git(path, "checkout", "-q", "--orphan", "feature-orphan");
    git(path, "commit", "-q", "-m", "unrelated", "--allow-empty");

    expect(await answerFor(path)).toBeUndefined();
  });

  it("leaves every worktree unmarked when no repo has anything to merge into", async () => {
    addWorktree("project-feature", "feature");
    const repo = await unanswered();

    const [reported] = await withConflicts([{ ...repo, defaultBranch: null }]);

    expect(reported.worktrees.every((w) => w.conflicts === undefined)).toBe(true);
  });
});
