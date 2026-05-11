import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGitHead } from "./head.ts";

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
};

describe("resolveGitHead", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-git-head-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns null sha and dirty when cwd is not a git working tree", () => {
    expect(resolveGitHead(cwd)).toEqual({ sha: null, dirty: null });
  });

  it("returns null sha and dirty for a fresh repo with no commits", () => {
    git(cwd, "init", "-q");
    expect(resolveGitHead(cwd)).toEqual({ sha: null, dirty: null });
  });

  it("returns HEAD sha with dirty=false on a clean working tree", () => {
    git(cwd, "init", "-q");
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "config", "user.name", "Test");
    writeFileSync(join(cwd, "a.txt"), "hello");
    git(cwd, "add", "a.txt");
    git(cwd, "commit", "-q", "-m", "init");

    const head = resolveGitHead(cwd);
    expect(head.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(head.dirty).toBe(false);
  });

  it("returns dirty=true when the working tree has uncommitted changes", () => {
    git(cwd, "init", "-q");
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "config", "user.name", "Test");
    writeFileSync(join(cwd, "a.txt"), "hello");
    git(cwd, "add", "a.txt");
    git(cwd, "commit", "-q", "-m", "init");
    writeFileSync(join(cwd, "a.txt"), "edited");

    const head = resolveGitHead(cwd);
    expect(head.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(head.dirty).toBe(true);
  });

  it("treats untracked files as dirty", () => {
    git(cwd, "init", "-q");
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "config", "user.name", "Test");
    writeFileSync(join(cwd, "a.txt"), "hello");
    git(cwd, "add", "a.txt");
    git(cwd, "commit", "-q", "-m", "init");
    writeFileSync(join(cwd, "untracked.txt"), "new");

    expect(resolveGitHead(cwd).dirty).toBe(true);
  });
});
