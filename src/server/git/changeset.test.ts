import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_FILES,
  MAX_PATCH_BYTES,
  PATCH_TRUNCATION_MARKER,
  changeset,
  filePatch,
} from "./changeset.ts";

const git = (cwd: string, ...args: string[]): string => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
};

// A repo on `main` with one commit carrying two text files.
const initRepo = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "kept.txt"), "one\ntwo\n");
  writeFileSync(join(dir, "gone.txt"), "bye\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
};

const write = (dir: string, file: string, body: string): void =>
  writeFileSync(join(dir, file), body);

const uncommitted = (path: string) =>
  changeset({ path, view: "uncommitted", defaultBranch: "main" });

const branchView = (path: string, defaultBranch: string | null = "main") =>
  changeset({ path, view: "branch", defaultBranch });

const fileNamed = (files: { path: string }[], path: string) =>
  files.find((file) => file.path === path);

describe("changeset", () => {
  let repo: string;

  beforeEach(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "kiri-changeset-")));
    initRepo(repo);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  describe("uncommitted view", () => {
    it("reports modified, deleted, untracked and renamed files with their line counts", async () => {
      write(repo, "kept.txt", "one\ntwo\nthree\n");
      unlinkSync(join(repo, "gone.txt"));
      write(repo, "fresh.txt", "new\nlines\n");
      write(repo, "moved.txt", "move me\n");
      git(repo, "add", "moved.txt");
      git(repo, "commit", "-q", "-m", "moved");
      git(repo, "mv", "moved.txt", "elsewhere.txt");

      const result = await uncommitted(repo);

      expect(result.view).toBe("uncommitted");
      expect(result.mergeBase).toBeNull();
      expect(result.emptyReason).toBeNull();
      expect(result.truncated).toBe(false);
      expect(result.totalFiles).toBe(4);
      expect(result.files.map((file) => file.path)).toEqual([
        "elsewhere.txt",
        "fresh.txt",
        "gone.txt",
        "kept.txt",
      ]);
      expect(fileNamed(result.files, "kept.txt")).toMatchObject({
        kind: "modified",
        insertions: 1,
        deletions: 0,
        binary: false,
        previousPath: null,
      });
      expect(fileNamed(result.files, "gone.txt")).toMatchObject({ kind: "deleted", deletions: 1 });
      expect(fileNamed(result.files, "fresh.txt")).toMatchObject({
        kind: "added",
        insertions: 2,
        deletions: 0,
      });
      expect(fileNamed(result.files, "elsewhere.txt")).toMatchObject({
        kind: "renamed",
        previousPath: "moved.txt",
      });
    });

    it("reports a binary file as binary with no line counts", async () => {
      writeFileSync(join(repo, "blob.bin"), Buffer.from([0, 1, 2, 0, 255]));

      const result = await uncommitted(repo);

      expect(fileNamed(result.files, "blob.bin")).toMatchObject({
        binary: true,
        insertions: 0,
        deletions: 0,
      });
    });

    it("ignores files git is configured to ignore", async () => {
      write(repo, ".gitignore", "ignored.txt\n");
      write(repo, "ignored.txt", "noise\n");

      const result = await uncommitted(repo);

      expect(result.files.map((file) => file.path)).toEqual([".gitignore"]);
    });

    it("reports staged files in a repo with no commits yet", async () => {
      const fresh = realpathSync(mkdtempSync(join(tmpdir(), "kiri-changeset-empty-")));
      git(fresh, "init", "-q", "-b", "main");
      write(fresh, "staged.txt", "hello\n");
      git(fresh, "add", "staged.txt");
      write(fresh, "loose.txt", "hi\n");

      const result = await uncommitted(fresh);

      expect(result.files.map((file) => file.path)).toEqual(["loose.txt", "staged.txt"]);
      expect(fileNamed(result.files, "staged.txt")).toMatchObject({ kind: "added", insertions: 1 });
      rmSync(fresh, { recursive: true, force: true });
    });

    it("caps the file list and reports how many changed", async () => {
      const total = MAX_FILES + 5;
      for (let i = 0; i < total; i++) write(repo, `bulk-${String(i).padStart(4, "0")}.txt`, "a\n");
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "bulk");
      for (let i = 0; i < total; i++) write(repo, `bulk-${String(i).padStart(4, "0")}.txt`, "b\n");

      const result = await uncommitted(repo);

      expect(result.totalFiles).toBe(total);
      expect(result.files).toHaveLength(MAX_FILES);
      expect(result.truncated).toBe(true);
    });
  });

  describe("branch view", () => {
    // A branch off main carrying one new commit.
    const branchOff = (dir: string): void => {
      git(dir, "checkout", "-q", "-b", "feature");
      write(dir, "kept.txt", "one\ntwo\nthree\n");
      write(dir, "added.txt", "brand new\n");
      git(dir, "add", ".");
      git(dir, "commit", "-q", "-m", "feature work");
    };

    it("reports what the branch introduces over its merge-base", async () => {
      branchOff(repo);
      // Uncommitted noise the branch view must not pick up.
      write(repo, "gone.txt", "changed but uncommitted\n");

      const result = await branchView(repo);

      expect(result.mergeBase).toMatch(/^[0-9a-f]{40}$/);
      expect(result.emptyReason).toBeNull();
      expect(result.files.map((file) => file.path)).toEqual(["added.txt", "kept.txt"]);
    });

    it("diffs against the merge-base rather than the default branch tip", async () => {
      branchOff(repo);
      git(repo, "checkout", "-q", "main");
      write(repo, "main-only.txt", "moved on\n");
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "main moves on");
      git(repo, "checkout", "-q", "feature");

      const result = await branchView(repo);

      expect(result.files.map((file) => file.path)).toEqual(["added.txt", "kept.txt"]);
    });

    it("computes a detached HEAD against its merge-base", async () => {
      branchOff(repo);
      const head = git(repo, "rev-parse", "HEAD").trim();
      git(repo, "checkout", "-q", head);

      const result = await branchView(repo);

      expect(result.emptyReason).toBeNull();
      expect(result.files.map((file) => file.path)).toEqual(["added.txt", "kept.txt"]);
    });

    it("is empty on the default branch itself", async () => {
      const result = await branchView(repo);

      expect(result.emptyReason).toBe("on-default-branch");
      expect(result.files).toEqual([]);
      expect(result.mergeBase).toBeNull();
    });

    it("is empty when the repo has no default branch", async () => {
      expect(await branchView(repo, null)).toMatchObject({ emptyReason: "no-default-branch" });
    });

    it("is empty when the repo has no commits", async () => {
      const fresh = realpathSync(mkdtempSync(join(tmpdir(), "kiri-changeset-empty-")));
      git(fresh, "init", "-q", "-b", "main");

      expect(await branchView(fresh)).toMatchObject({ emptyReason: "no-commits" });
      rmSync(fresh, { recursive: true, force: true });
    });

    it("is empty when there is no merge-base with the default branch", async () => {
      git(repo, "checkout", "-q", "--orphan", "unrelated");
      write(repo, "orphan.txt", "alone\n");
      git(repo, "add", "orphan.txt");
      git(repo, "commit", "-q", "-m", "orphan");

      expect(await branchView(repo)).toMatchObject({ emptyReason: "no-merge-base" });
    });
  });

  describe("file patches", () => {
    it("serves git's unified patch for a tracked change unmodified", async () => {
      write(repo, "kept.txt", "one\ntwo\nthree\n");

      const result = await filePatch({
        path: repo,
        view: "uncommitted",
        file: "kept.txt",
        defaultBranch: "main",
      });

      expect(result.path).toBe("kept.txt");
      expect(result.truncated).toBe(false);
      expect(result.patch).toStartWith("diff --git a/kept.txt b/kept.txt\n");
      expect(result.patch).toContain("@@ -1,2 +1,3 @@");
      expect(result.patch).toContain("+three");
    });

    it("serves a patch for an untracked file", async () => {
      write(repo, "fresh.txt", "new\n");

      const result = await filePatch({
        path: repo,
        view: "uncommitted",
        file: "fresh.txt",
        defaultBranch: "main",
      });

      expect(result.patch).toContain("+new");
    });

    it("reports a binary file's difference without its bytes", async () => {
      writeFileSync(join(repo, "blob.bin"), Buffer.from([0, 1, 2, 0, 255]));

      const result = await filePatch({
        path: repo,
        view: "uncommitted",
        file: "blob.bin",
        defaultBranch: "main",
      });

      expect(result.patch).toContain("Binary files");
      expect(result.patch).not.toContain("GIT binary patch");
    });

    it("pairs the two sides of a rename into one patch", async () => {
      git(repo, "mv", "kept.txt", "renamed.txt");

      const result = await filePatch({
        path: repo,
        view: "uncommitted",
        file: "renamed.txt",
        previousPath: "kept.txt",
        defaultBranch: "main",
      });

      expect(result.patch).toContain("rename from kept.txt");
      expect(result.patch).toContain("rename to renamed.txt");
    });

    it("returns an empty patch for a file with nothing to show", async () => {
      const result = await filePatch({
        path: repo,
        view: "uncommitted",
        file: "kept.txt",
        defaultBranch: "main",
      });

      expect(result).toMatchObject({ patch: "", truncated: false });
    });

    it("serves a branch patch against the merge-base", async () => {
      git(repo, "checkout", "-q", "-b", "feature");
      write(repo, "kept.txt", "one\ntwo\nthree\n");
      git(repo, "commit", "-qam", "feature work");

      const result = await filePatch({
        path: repo,
        view: "branch",
        file: "kept.txt",
        defaultBranch: "main",
      });

      expect(result.patch).toContain("+three");
    });

    it("returns an empty branch patch when there is no merge-base to diff against", async () => {
      const result = await filePatch({
        path: repo,
        view: "branch",
        file: "kept.txt",
        defaultBranch: null,
      });

      expect(result).toMatchObject({ patch: "", truncated: false });
    });

    it("caps a huge patch at a line boundary and marks it", async () => {
      const line = `${"x".repeat(80)}\n`;
      write(repo, "huge.txt", line.repeat(Math.ceil(MAX_PATCH_BYTES / line.length) + 100));
      git(repo, "add", "huge.txt");

      const result = await filePatch({
        path: repo,
        view: "uncommitted",
        file: "huge.txt",
        defaultBranch: "main",
      });

      expect(result.truncated).toBe(true);
      expect(result.patch.length).toBeLessThanOrEqual(
        MAX_PATCH_BYTES + PATCH_TRUNCATION_MARKER.length + 2,
      );
      expect(result.patch).toEndWith(`\n${PATCH_TRUNCATION_MARKER}\n`);
      // Cut at a line boundary: every line before the marker is a whole diff line.
      const lines = result.patch.split("\n");
      expect(lines[lines.length - 3]).toBe(`+${"x".repeat(80)}`);
    });
  });
});
