import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorktreeEntry } from "./discovery.ts";
import { worktreeStatus } from "./status.ts";

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
};

const setUser = (dir: string) => {
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
};

const commit = (dir: string, name: string) => {
  writeFileSync(join(dir, name), name);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", name);
};

const initRepo = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  setUser(dir);
  commit(dir, "init");
};

const entryFor = (path: string, over: Partial<WorktreeEntry> = {}): WorktreeEntry => ({
  path,
  head: null,
  branch: "main",
  bare: false,
  detached: false,
  locked: false,
  lockedReason: null,
  prunable: false,
  prunableReason: null,
  primary: true,
  ...over,
});

describe("worktreeStatus", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "kiri-status-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("reports a clean repo with no upstream", () => {
    const repo = join(base, "repo");
    initRepo(repo);
    const status = worktreeStatus(entryFor(repo));
    expect(status.dirty).toBe(false);
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
    expect(status.upstreamGone).toBe(false);
  });

  it("flags a dirty working tree", () => {
    const repo = join(base, "repo");
    initRepo(repo);
    writeFileSync(join(repo, "init"), "edited");
    expect(worktreeStatus(entryFor(repo)).dirty).toBe(true);
  });

  it("counts ahead and behind against an upstream without swapping them", () => {
    const origin = join(base, "origin");
    const local = join(base, "local");
    initRepo(origin);
    git(base, "clone", "-q", origin, local);
    setUser(local);
    commit(local, "local-2"); // 1 ahead
    commit(origin, "origin-2"); // 2 behind after fetch
    commit(origin, "origin-3");
    git(local, "fetch", "-q");

    const status = worktreeStatus(entryFor(local));
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(2);
    expect(status.upstreamGone).toBe(false);
  });

  it("flags an upstream that no longer exists as gone", () => {
    const origin = join(base, "origin");
    const local = join(base, "local");
    initRepo(origin);
    git(base, "clone", "-q", origin, local);
    setUser(local);
    git(local, "update-ref", "-d", "refs/remotes/origin/main");

    const status = worktreeStatus(entryFor(local));
    expect(status.upstreamGone).toBe(true);
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
  });

  it("treats a detached worktree as having no branch or upstream", () => {
    const repo = join(base, "repo");
    initRepo(repo);
    const head = git(repo, "rev-parse", "HEAD").trim();
    const status = worktreeStatus(
      entryFor(repo, { branch: null, detached: true, head, primary: false }),
    );
    expect(status.branch).toBeNull();
    expect(status.detached).toBe(true);
    expect(status.head).toBe(head);
    expect(status.upstreamGone).toBe(false);
  });

  it("carries the structural flags from the discovered entry", () => {
    const repo = join(base, "repo");
    initRepo(repo);
    const status = worktreeStatus(entryFor(repo, { locked: true, prunable: true, primary: false }));
    expect(status.locked).toBe(true);
    expect(status.prunable).toBe(true);
    expect(status.primary).toBe(false);
    expect(status.path).toBe(repo);
  });
});
