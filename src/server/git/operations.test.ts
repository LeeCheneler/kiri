import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree, pruneWorktrees, removeWorktree } from "./operations.ts";
import type { CommandResult, CommandRunner } from "./prepare.ts";
import type { GitConfig } from "./schema.ts";

const git = (cwd: string, ...args: string[]): string => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
};

// A repo at `dir` on `branch` with one commit.
const initRepo = (dir: string, branch = "main"): void => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", branch);
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "file.txt"), "hello");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
};

const commit = (dir: string, body: string): void => {
  writeFileSync(join(dir, "file.txt"), body);
  git(dir, "commit", "-qam", body);
};

// A runner that fails the test if any command is dispatched — proves the prep
// pipeline ran nothing (or was skipped entirely).
const neverRun: CommandRunner = async (command) => {
  throw new Error(`unexpected command: ${command}`);
};

// A recording runner, so a test asserts what prep dispatched without running it.
const recordingRunner = (
  respond: (command: string) => CommandResult = () => ({ exitCode: 0, stdout: "", stderr: "" }),
): { run: CommandRunner; commands: string[] } => {
  const commands: string[] = [];
  const run: CommandRunner = async (command) => {
    commands.push(command);
    return respond(command);
  };
  return { run, commands };
};

describe("worktree operations", () => {
  let base: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "kiri-worktree-ops-")));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const at = (name: string): string => join(base, name);

  // A repo with a bare `origin` holding `main`, and origin/HEAD set locally.
  const initRepoWithOrigin = (name = "repo"): string => {
    const origin = at(`${name}.origin.git`);
    mkdirSync(origin, { recursive: true });
    git(origin, "init", "-q", "--bare", "-b", "main");
    const repo = at(name);
    initRepo(repo);
    git(repo, "remote", "add", "origin", origin);
    git(repo, "push", "-q", "-u", "origin", "main");
    git(repo, "remote", "set-head", "origin", "-a");
    return repo;
  };

  // A second checkout of `repo`'s origin, for pushing commits the primary
  // hasn't seen.
  const cloneOfOrigin = (repo: string, name: string): string => {
    const clone = at(name);
    git(base, "clone", "-q", git(repo, "remote", "get-url", "origin").trim(), name);
    git(clone, "config", "user.email", "test@example.com");
    git(clone, "config", "user.name", "Test");
    return clone;
  };

  describe("createWorktree", () => {
    it("fails when the path is not a git repository", async () => {
      const plain = at("plain");
      mkdirSync(plain);

      const result = await createWorktree({ repoPath: plain, branch: "feature" }, neverRun);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("not a git repository");
      expect(result.branchSource).toBeNull();
    });

    it("falls back to the slugified branch, cutting a sibling from the local default", async () => {
      const repo = at("repo");
      initRepo(repo);

      const result = await createWorktree({ repoPath: repo, branch: "feat/foo" }, neverRun);

      expect(result.status).toBe("ok");
      expect(result.path).toBe(at("repo-feat-foo"));
      expect(result.branchSource).toBe("new");
      expect(result.baseRef).toBe("main");
      expect(git(result.path, "symbolic-ref", "--short", "HEAD").trim()).toBe("feat/foo");
      // Nothing to install and no env or post-create policy, so prep is inert.
      expect(result.prepare).toEqual({ status: "ok", steps: [] });
    });

    it("names the directory after an explicit name when given one", async () => {
      const repo = at("repo");
      initRepo(repo);

      const result = await createWorktree(
        { repoPath: repo, branch: "feat/add-thing", name: "swift-otter" },
        neverRun,
      );

      expect(result.path).toBe(at("repo-swift-otter"));
      expect(existsSync(at("repo-swift-otter"))).toBe(true);
    });

    it("checks out a branch that already exists locally", async () => {
      const repo = at("repo");
      initRepo(repo);
      git(repo, "branch", "existing");

      const result = await createWorktree({ repoPath: repo, branch: "existing" }, neverRun);

      expect(result.branchSource).toBe("local");
      expect(result.baseRef).toBeNull();
      expect(git(result.path, "symbolic-ref", "--short", "HEAD").trim()).toBe("existing");
    });

    it("tracks a branch that exists on origin", async () => {
      const repo = initRepoWithOrigin();
      git(repo, "push", "-q", "origin", "main:published");

      const result = await createWorktree({ repoPath: repo, branch: "published" }, neverRun);

      expect(result.branchSource).toBe("remote");
      expect(git(result.path, "rev-parse", "--abbrev-ref", "@{upstream}").trim()).toBe(
        "origin/published",
      );
    });

    it("cuts a new branch from the default branch on origin", async () => {
      const repo = initRepoWithOrigin();

      const result = await createWorktree({ repoPath: repo, branch: "feature" }, neverRun);

      expect(result.baseRef).toBe("origin/main");
      expect(result.status).toBe("ok");
    });

    it("cuts a new branch from an explicit base ref", async () => {
      const repo = at("repo");
      initRepo(repo);
      git(repo, "branch", "release");
      commit(repo, "later");

      const result = await createWorktree(
        { repoPath: repo, branch: "hotfix", baseRef: "release" },
        neverRun,
      );

      expect(result.baseRef).toBe("release");
      expect(git(result.path, "rev-parse", "HEAD").trim()).toBe(
        git(repo, "rev-parse", "release").trim(),
      );
    });

    it("refuses to create over an existing directory", async () => {
      const repo = at("repo");
      initRepo(repo);
      mkdirSync(at("repo-feature"));

      const result = await createWorktree({ repoPath: repo, branch: "feature" }, neverRun);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("already exists");
    });

    it("fails when there is no base ref to cut from", async () => {
      const repo = at("repo");
      initRepo(repo, "trunk");

      const result = await createWorktree({ repoPath: repo, branch: "feature" }, neverRun);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("base ref");
      expect(existsSync(at("repo-feature"))).toBe(false);
    });

    it("fails with git's error when the worktree cannot be created", async () => {
      const repo = at("repo");
      initRepo(repo);

      const result = await createWorktree(
        { repoPath: repo, branch: "feature", baseRef: "origin/nope" },
        neverRun,
      );

      expect(result.status).toBe("failed");
      expect(result.error).toContain("nope");
    });

    it("preps the worktree with the repo's resolved config", async () => {
      const repo = at("repo");
      initRepo(repo);
      writeFileSync(join(repo, ".gitignore"), ".env\n");
      git(repo, "add", ".gitignore");
      git(repo, "commit", "-qm", "ignore env");
      writeFileSync(join(repo, ".env"), "SECRET=1\n");

      const config: GitConfig = {
        roots: [base],
        defaults: { prepare: { env: "copy", postCreate: ["echo default"] } },
        repos: { repo: { prepare: { env: "symlink", postCreate: ["echo repo"] } } },
      };
      const { run, commands } = recordingRunner();

      const result = await createWorktree({ repoPath: repo, branch: "feature", config }, run);

      expect(result.status).toBe("ok");
      expect(commands).toEqual(["echo repo"]);
      expect(lstatSync(join(result.path, ".env")).isSymbolicLink()).toBe(true);
    });

    it("skips prep entirely when asked", async () => {
      const repo = at("repo");
      initRepo(repo);
      const config: GitConfig = {
        roots: [base],
        defaults: { prepare: { postCreate: ["echo hello"] } },
      };

      const result = await createWorktree(
        { repoPath: repo, branch: "feature", skipPrepare: true, config },
        neverRun,
      );

      expect(result.status).toBe("ok");
      expect(result.prepare).toBeNull();
    });

    it("reports a failed prep step and leaves the worktree in place", async () => {
      const repo = at("repo");
      initRepo(repo);
      const config: GitConfig = {
        roots: [base],
        defaults: { prepare: { postCreate: ["boom"] } },
      };
      const { run } = recordingRunner(() => ({ exitCode: 1, stdout: "", stderr: "nope" }));

      const result = await createWorktree({ repoPath: repo, branch: "feature", config }, run);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("postCreate: boom");
      expect(result.prepare?.status).toBe("failed");
      expect(existsSync(result.path)).toBe(true);
    });
  });

  describe("removeWorktree", () => {
    // A repo plus a linked worktree on `branch`, both ready to remove.
    const withWorktree = (branch = "feature"): { repo: string; worktree: string } => {
      const repo = at("repo");
      initRepo(repo);
      const worktree = at(`repo-${branch}`);
      git(repo, "worktree", "add", "-q", worktree, "-b", branch);
      return { repo, worktree };
    };

    it("fails when the path is not a git worktree", () => {
      const plain = at("plain");
      mkdirSync(plain);

      const result = removeWorktree(plain);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("not a git worktree");
    });

    it("refuses to remove the primary checkout", () => {
      const { repo } = withWorktree();

      const result = removeWorktree(repo);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("primary checkout");
      expect(existsSync(repo)).toBe(true);
    });

    it("refuses a worktree with uncommitted changes", () => {
      const { worktree } = withWorktree();
      writeFileSync(join(worktree, "file.txt"), "changed");

      const result = removeWorktree(worktree);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("uncommitted changes");
      expect(existsSync(worktree)).toBe(true);
    });

    it("removes a dirty worktree when forced", () => {
      const { worktree } = withWorktree();
      writeFileSync(join(worktree, "file.txt"), "changed");

      const result = removeWorktree(worktree, true);

      expect(result.status).toBe("ok");
      expect(existsSync(worktree)).toBe(false);
    });

    it("removes the worktree, prunes it and deletes its branch, reporting the sha", () => {
      const { repo, worktree } = withWorktree();
      const sha = git(repo, "rev-parse", "feature").trim();

      const result = removeWorktree(worktree);

      expect(result.status).toBe("ok");
      expect(result.branch).toBe("feature");
      expect(result.deletedBranchSha).toBe(sha);
      expect(existsSync(worktree)).toBe(false);
      expect(git(repo, "branch", "--list", "feature").trim()).toBe("");
      expect(git(repo, "worktree", "list")).not.toContain(worktree);
    });

    it("unlinks symlinked env files without touching the primary's copies", async () => {
      const repo = at("repo");
      initRepo(repo);
      writeFileSync(join(repo, ".gitignore"), ".env\n");
      git(repo, "add", ".gitignore");
      git(repo, "commit", "-qm", "ignore env");
      writeFileSync(join(repo, ".env"), "SECRET=1\n");
      const config: GitConfig = {
        roots: [base],
        defaults: { prepare: { env: "symlink" } },
      };
      const created = await createWorktree({ repoPath: repo, branch: "feature", config }, neverRun);

      const result = removeWorktree(created.path);

      expect(result.status).toBe("ok");
      expect(existsSync(created.path)).toBe(false);
      expect(readFileSync(join(repo, ".env"), "utf8")).toBe("SECRET=1\n");
    });

    it("removes a worktree carrying git-ignored files without forcing", () => {
      const { repo, worktree } = withWorktree();
      writeFileSync(join(repo, ".gitignore"), "node_modules\n");
      git(repo, "add", ".gitignore");
      git(repo, "commit", "-qm", "ignore deps");
      git(worktree, "merge", "-q", "main");
      mkdirSync(join(worktree, "node_modules"));
      writeFileSync(join(worktree, "node_modules", "dep.js"), "x");

      const result = removeWorktree(worktree);

      expect(result.status).toBe("ok");
      expect(existsSync(worktree)).toBe(false);
    });

    it("deletes no branch when the worktree is detached", () => {
      const repo = at("repo");
      initRepo(repo);
      const worktree = at("repo-detached");
      git(repo, "worktree", "add", "-q", "--detach", worktree, "HEAD");

      const result = removeWorktree(worktree);

      expect(result.status).toBe("ok");
      expect(result.branch).toBeNull();
      expect(result.deletedBranchSha).toBeNull();
    });

    it("never deletes the default branch", () => {
      const repo = at("repo");
      initRepo(repo);
      git(repo, "checkout", "-q", "-b", "other");
      const worktree = at("repo-main");
      git(repo, "worktree", "add", "-q", worktree, "main");

      const result = removeWorktree(worktree);

      expect(result.status).toBe("ok");
      expect(result.deletedBranchSha).toBeNull();
      expect(result.warnings).toContainEqual(expect.stringContaining("is the default branch"));
      expect(git(repo, "branch", "--list", "main").trim()).toContain("main");
    });

    it("warns when the branch cannot be deleted", () => {
      const { repo, worktree } = withWorktree();
      // A second worktree on the same branch keeps git from deleting it.
      git(repo, "worktree", "add", "-q", "--force", at("repo-feature-two"), "feature");

      const result = removeWorktree(worktree);

      expect(result.status).toBe("ok");
      expect(result.deletedBranchSha).toBeNull();
      expect(result.warnings).toContainEqual(
        expect.stringContaining("could not delete branch 'feature'"),
      );
      expect(git(repo, "branch", "--list", "feature").trim()).toContain("feature");
    });

    it("fails with git's error when the worktree cannot be removed", () => {
      const { repo, worktree } = withWorktree();
      git(repo, "worktree", "lock", worktree);

      const result = removeWorktree(worktree);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("locked");
      expect(existsSync(worktree)).toBe(true);
    });

    it("fast-forwards the primary checkout afterwards", () => {
      const repo = initRepoWithOrigin();
      const other = cloneOfOrigin(repo, "other");
      commit(other, "from elsewhere");
      git(other, "push", "-q", "origin", "main");
      const worktree = at("repo-feature");
      git(repo, "worktree", "add", "-q", worktree, "-b", "feature");

      const result = removeWorktree(worktree);

      expect(result.pull).toBe("ok");
      expect(result.warnings).toEqual([]);
      expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("from elsewhere");
    });

    it("warns rather than fails when the pull cannot fast-forward", () => {
      const repo = initRepoWithOrigin();
      const other = cloneOfOrigin(repo, "other");
      commit(other, "from elsewhere");
      git(other, "push", "-q", "origin", "main");
      commit(repo, "diverged");
      const worktree = at("repo-feature");
      git(repo, "worktree", "add", "-q", worktree, "-b", "feature");

      const result = removeWorktree(worktree);

      expect(result.status).toBe("ok");
      expect(result.pull).toBe("failed");
      expect(result.warnings).toEqual([expect.stringContaining("pull failed")]);
      expect(result.deletedBranchSha).not.toBeNull();
    });

    it("skips the pull when the primary checkout is on another branch", () => {
      const repo = initRepoWithOrigin();
      const worktree = at("repo-feature");
      git(repo, "worktree", "add", "-q", worktree, "-b", "feature");
      git(repo, "checkout", "-q", "-b", "sidetrack");

      const result = removeWorktree(worktree);

      expect(result.pull).toBe("skipped");
      expect(result.warnings).toEqual([expect.stringContaining("is on 'sidetrack'")]);
    });

    it("skips the pull when the primary checkout is detached", () => {
      const repo = initRepoWithOrigin();
      const worktree = at("repo-feature");
      git(repo, "worktree", "add", "-q", worktree, "-b", "feature");
      git(repo, "checkout", "-q", "--detach");

      const result = removeWorktree(worktree);

      expect(result.pull).toBe("skipped");
      expect(result.warnings).toEqual([expect.stringContaining("a detached HEAD")]);
    });

    it("skips the pull when there is no origin remote", () => {
      const { worktree } = withWorktree();

      const result = removeWorktree(worktree);

      expect(result.pull).toBe("skipped");
      expect(result.warnings).toEqual([expect.stringContaining("no origin remote")]);
    });

    it("skips the pull when the default branch cannot be worked out", () => {
      const repo = at("repo");
      initRepo(repo, "trunk");
      const worktree = at("repo-feature");
      git(repo, "worktree", "add", "-q", worktree, "-b", "feature");

      const result = removeWorktree(worktree);

      expect(result.pull).toBe("skipped");
      expect(result.warnings).toEqual([expect.stringContaining("default branch")]);
      expect(result.deletedBranchSha).not.toBeNull();
    });
  });

  describe("pruneWorktrees", () => {
    it("fails when the path is not a git repository", () => {
      const plain = at("plain");
      mkdirSync(plain);

      const result = pruneWorktrees(plain);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("not a git repository");
    });

    it("reports nothing when there is nothing stale", () => {
      const repo = at("repo");
      initRepo(repo);
      git(repo, "worktree", "add", "-q", at("repo-feature"), "-b", "feature");

      expect(pruneWorktrees(repo)).toEqual({ status: "ok", pruned: [] });
    });

    it("prunes stale admin entries and reports their paths", () => {
      const repo = at("repo");
      initRepo(repo);
      const worktree = at("repo-feature");
      git(repo, "worktree", "add", "-q", worktree, "-b", "feature");
      rmSync(worktree, { recursive: true, force: true });

      const result = pruneWorktrees(repo);

      expect(result).toEqual({ status: "ok", pruned: [worktree] });
      expect(git(repo, "worktree", "list")).not.toContain(worktree);
    });
  });
});
