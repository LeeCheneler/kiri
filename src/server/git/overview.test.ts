import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitOverview } from "./overview.ts";

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
};

// A git repo at `dir` with one commit on `main`.
const initRepo = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "file.txt"), "hello");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
};

describe("gitOverview", () => {
  let base: string;
  let root: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "kiri-overview-"));
    root = join(base, "root");
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("echoes the scanned roots and finds nothing under an empty one", async () => {
    expect(await gitOverview([root])).toEqual({ roots: [root], repos: [] });
  });

  it("names a repo after its primary checkout's directory", async () => {
    initRepo(join(root, "alpha"));
    const { repos } = await gitOverview([root]);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe("alpha");
    expect(realpathSync(repos[0].root)).toBe(realpathSync(join(root, "alpha")));
    expect(repos[0].gitCommonDir).toContain(".git");
  });

  it("orders repos by name", async () => {
    initRepo(join(root, "zeta"));
    initRepo(join(root, "alpha"));
    initRepo(join(root, "mid"));
    expect((await gitOverview([root])).repos.map((r) => r.name)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("orders same-named repos from different roots by path", async () => {
    const other = join(base, "other");
    mkdirSync(other, { recursive: true });
    initRepo(join(other, "proj"));
    initRepo(join(root, "proj"));

    const { repos } = await gitOverview([root, other]);
    expect(repos.map((r) => r.name)).toEqual(["proj", "proj"]);
    expect(repos.map((r) => realpathSync(r.root))).toEqual([
      realpathSync(join(other, "proj")),
      realpathSync(join(root, "proj")),
    ]);
  });

  it("puts the primary checkout first and orders linked worktrees by path", async () => {
    const repo = join(root, "proj");
    initRepo(repo);
    git(repo, "worktree", "add", "-q", join(root, "proj-b"), "-b", "b");
    git(repo, "worktree", "add", "-q", join(root, "proj-a"), "-b", "a");

    const worktrees = (await gitOverview([root])).repos[0].worktrees;
    expect(worktrees).toHaveLength(3);
    expect(worktrees[0].primary).toBe(true);
    expect(worktrees.slice(1).map((w) => w.branch)).toEqual(["a", "b"]);
  });

  it("carries each worktree's live status", async () => {
    const repo = join(root, "proj");
    initRepo(repo);
    git(repo, "worktree", "add", "-q", join(root, "proj-dirty"), "-b", "dirty");
    writeFileSync(join(root, "proj-dirty", "scratch.txt"), "uncommitted");

    const worktrees = (await gitOverview([root])).repos[0].worktrees;
    expect(worktrees.find((w) => w.primary)?.dirty).toBe(false);
    const dirty = worktrees.find((w) => w.branch === "dirty");
    expect(dirty?.dirty).toBe(true);
    expect(dirty?.ahead).toBe(0);
    expect(dirty?.behind).toBe(0);
  });
});
