import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conflictingPaths, namePaths } from "./merge-tree.ts";

const git = (cwd: string, ...args: string[]): string => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
};

// A repo at `dir` on `main` with `files` committed.
const initRepo = (dir: string, files: Record<string, string>): void => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
};

const commit = (dir: string, files: Record<string, string>, message: string): void => {
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  git(dir, "commit", "-qam", message);
};

describe("merging two refs without touching the working tree", () => {
  let root: string;
  let repo: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kiri-merge-tree-"));
    repo = join(root, "repo");
    initRepo(repo, { "a.txt": "one\n", "b.txt": "two\n" });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports no paths when the two sides merge cleanly", async () => {
    git(repo, "checkout", "-q", "-b", "feature");
    commit(repo, { "b.txt": "changed on the branch\n" }, "branch edit");

    expect(await conflictingPaths(repo, "main", "HEAD")).toEqual([]);
  });

  it("names every path the merge would conflict in", async () => {
    git(repo, "checkout", "-q", "-b", "feature");
    commit(repo, { "a.txt": "branch\n", "b.txt": "branch\n" }, "branch edit");
    git(repo, "checkout", "-q", "main");
    commit(repo, { "a.txt": "main\n", "b.txt": "main\n" }, "main edit");

    expect(await conflictingPaths(repo, "main", "feature")).toEqual(["a.txt", "b.txt"]);
  });

  it("reports nothing at all when git cannot answer", async () => {
    expect(await conflictingPaths(repo, "no-such-ref", "HEAD")).toBeNull();
  });

  it("names unrelated histories as unanswerable rather than clean", async () => {
    const other = join(root, "other");
    initRepo(other, { "a.txt": "elsewhere\n" });
    git(repo, "remote", "add", "other", other);
    git(repo, "fetch", "-q", "other");

    expect(await conflictingPaths(repo, "other/main", "HEAD")).toBeNull();
  });
});

describe("phrasing a list of conflicting paths", () => {
  it("names them all when there are few enough", () => {
    expect(namePaths(["a.ts", "b.ts"])).toBe("a.ts, b.ts");
  });

  it("names the first few and counts the rest", () => {
    expect(namePaths(["a", "b", "c", "d", "e", "f", "g"])).toBe("a, b, c, d, e and 2 more");
  });
});
