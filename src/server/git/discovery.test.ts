import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverRepos } from "./discovery.ts";

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

describe("discoverRepos", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "kiri-discovery-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("returns nothing for a root that has no repos", async () => {
    mkdirSync(join(base, "root", "plain"), { recursive: true });
    expect(await discoverRepos([join(base, "root")])).toEqual([]);
  });

  it("returns nothing for a non-existent root", async () => {
    expect(await discoverRepos([join(base, "missing")])).toEqual([]);
  });

  it("includes a root that is itself a git repo", async () => {
    const repo = join(base, "repo");
    initRepo(repo);
    const repos = await discoverRepos([repo]);
    expect(repos).toHaveLength(1);
    expect(realpathSync(repos[0].root)).toBe(realpathSync(repo));
    expect(repos[0].worktrees).toHaveLength(1);
    expect(repos[0].worktrees[0].primary).toBe(true);
    expect(repos[0].worktrees[0].branch).toBe("main");
  });

  it("scans immediate children only, skipping non-repos and files", async () => {
    const root = join(base, "root");
    initRepo(join(root, "alpha"));
    initRepo(join(root, "beta"));
    mkdirSync(join(root, "notarepo"), { recursive: true });
    writeFileSync(join(root, "loose.txt"), "x");
    const repos = await discoverRepos([root]);
    expect(repos).toHaveLength(2);
  });

  it("does not recurse into grandchildren", async () => {
    const root = join(base, "root");
    // The repo is nested one level below an immediate child, so it is out of reach.
    mkdirSync(join(root, "group"), { recursive: true });
    initRepo(join(root, "group", "nested"));
    expect(await discoverRepos([root])).toEqual([]);
  });

  it("parses linked worktrees with their branches and marks only the primary", async () => {
    const repo = join(base, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-q", join(base, "wt-feature"), "-b", "feature");
    git(repo, "worktree", "add", "-q", "--detach", join(base, "wt-detached"), "HEAD");
    const repos = await discoverRepos([repo]);
    expect(repos).toHaveLength(1);

    const worktrees = repos[0].worktrees;
    expect(worktrees).toHaveLength(3);
    expect(worktrees.filter((w) => w.primary)).toHaveLength(1);

    const feature = worktrees.find((w) => w.branch === "feature");
    expect(feature?.primary).toBe(false);

    const detached = worktrees.find((w) => w.detached);
    expect(detached?.branch).toBeNull();
    expect(detached?.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("surfaces a bare repo as a bare primary worktree", async () => {
    const bare = join(base, "bare.git");
    mkdirSync(bare, { recursive: true });
    git(bare, "init", "-q", "--bare", "-b", "main");
    const repos = await discoverRepos([bare]);
    expect(repos).toHaveLength(1);
    const primary = repos[0].worktrees[0];
    expect(primary.bare).toBe(true);
    expect(primary.branch).toBeNull();
    expect(primary.head).toBeNull();
  });

  it("reports locked worktrees, with and without a reason", async () => {
    const repo = join(base, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-q", join(base, "wt-a"), "-b", "a");
    git(repo, "worktree", "add", "-q", join(base, "wt-b"), "-b", "b");
    git(repo, "worktree", "lock", "--reason", "busy", join(base, "wt-a"));
    git(repo, "worktree", "lock", join(base, "wt-b"));
    const worktrees = (await discoverRepos([repo]))[0].worktrees;

    const a = worktrees.find((w) => w.branch === "a");
    expect(a?.locked).toBe(true);
    expect(a?.lockedReason).toBe("busy");

    const b = worktrees.find((w) => w.branch === "b");
    expect(b?.locked).toBe(true);
    expect(b?.lockedReason).toBeNull();
  });

  it("reports a prunable worktree whose directory was removed", async () => {
    const repo = join(base, "repo");
    initRepo(repo);
    const wt = join(base, "wt-gone");
    git(repo, "worktree", "add", "-q", wt, "-b", "gone");
    rmSync(wt, { recursive: true, force: true });
    const worktrees = (await discoverRepos([repo]))[0].worktrees;
    const gone = worktrees.find((w) => w.branch === "gone");
    expect(gone?.prunable).toBe(true);
  });

  it("dedupes a repo reached both as a primary and via a linked worktree in another root", async () => {
    const rootA = join(base, "a");
    const rootB = join(base, "b");
    mkdirSync(rootA, { recursive: true });
    mkdirSync(rootB, { recursive: true });
    const primary = join(rootA, "proj");
    initRepo(primary);
    git(primary, "worktree", "add", "-q", join(rootB, "proj-feature"), "-b", "feature");

    const repos = await discoverRepos([rootA, rootB]);
    expect(repos).toHaveLength(1);
    expect(repos[0].worktrees).toHaveLength(2);
    expect(realpathSync(repos[0].root)).toBe(realpathSync(primary));
  });

  it("keeps distinct repos separate and records the shared git dir", async () => {
    const root = join(base, "root");
    initRepo(join(root, "one"));
    initRepo(join(root, "two"));
    const repos = await discoverRepos([root]);
    const commonDirs = new Set(repos.map((r) => r.gitCommonDir));
    expect(commonDirs.size).toBe(2);
  });
});
