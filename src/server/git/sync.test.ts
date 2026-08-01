import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fastForwardPull, fetchRepo, fetchRepos } from "./sync.ts";

const git = (cwd: string, ...args: string[]): string => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
};

// A repo at `dir` on `main` with one commit.
const initRepo = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
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

describe("fetch and fast-forward pull", () => {
  let root: string;
  let origin: string;
  let clone: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kiri-sync-"));
    origin = join(root, "origin");
    clone = join(root, "clone");
    initRepo(origin);
    // A non-bare origin can still serve a clone, and keeping it a working tree
    // lets a test commit into it to move the remote on.
    git(origin, "config", "receive.denyCurrentBranch", "ignore");
    git(root, "clone", "-q", origin, clone);
    git(clone, "config", "user.email", "test@example.com");
    git(clone, "config", "user.name", "Test");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const target = (name: string, path: string) => ({ name, root: path });

  describe("fetchRepo", () => {
    it("reports up to date when nothing moved", async () => {
      const result = await fetchRepo(target("clone", clone));
      expect(result).toEqual({ repo: "clone", status: "up-to-date", updates: [] });
    });

    it("reports what moved when the remote has advanced", async () => {
      commit(origin, "second");

      const result = await fetchRepo(target("clone", clone));

      expect(result.status).toBe("updated");
      expect(result.updates.join("\n")).toContain("main");
      expect(git(clone, "rev-parse", "origin/main")).toBe(git(origin, "rev-parse", "HEAD"));
    });

    it("prunes remote-tracking refs for branches deleted upstream", async () => {
      git(origin, "branch", "gone-soon");
      await fetchRepo(target("clone", clone));
      expect(git(clone, "branch", "-r")).toContain("gone-soon");

      git(origin, "branch", "-D", "gone-soon");
      const result = await fetchRepo(target("clone", clone));

      expect(result.status).toBe("updated");
      expect(git(clone, "branch", "-r")).not.toContain("gone-soon");
    });

    it("refuses a repo with no remote", async () => {
      const result = await fetchRepo(target("origin", origin));
      expect(result.status).toBe("refused");
      expect(result.reason).toBe("the repo has no remote");
    });

    it("reports git's message when the fetch fails", async () => {
      git(clone, "remote", "set-url", "origin", join(root, "missing"));

      const result = await fetchRepo(target("clone", clone));

      expect(result.status).toBe("failed");
      expect(result.error).not.toBe("");
      expect(result.updates).toEqual([]);
    });

    it("reports a failure when the path is not a repo", async () => {
      const result = await fetchRepo(target("nowhere", join(root, "nowhere")));
      expect(result.status).toBe("failed");
      expect(result.error).not.toBe("");
    });
  });

  describe("fetchRepos", () => {
    it("fetches every repo and keeps one failure from taking down the rest", async () => {
      const broken = join(root, "broken");
      git(root, "clone", "-q", origin, broken);
      git(broken, "remote", "set-url", "origin", join(root, "missing"));
      commit(origin, "second");

      const results = await fetchRepos([target("broken", broken), target("clone", clone)]);

      expect(results.map((result) => [result.repo, result.status])).toEqual([
        ["broken", "failed"],
        ["clone", "updated"],
      ]);
    });
  });

  describe("fastForwardPull", () => {
    it("fast-forwards a checkout that is behind, reporting how far it moved", async () => {
      commit(origin, "second");
      commit(origin, "third");
      await fetchRepo(target("clone", clone));

      const result = await fastForwardPull(clone);

      expect(result).toEqual({ path: clone, branch: "main", status: "updated", commits: 2 });
      expect(git(clone, "rev-parse", "HEAD")).toBe(git(origin, "rev-parse", "HEAD"));
    });

    it("reports up to date when the branch is level with its upstream", async () => {
      const result = await fastForwardPull(clone);
      expect(result).toEqual({ path: clone, branch: "main", status: "up-to-date", commits: 0 });
    });

    it("reports up to date when the branch is only ahead", async () => {
      commit(clone, "local");
      const result = await fastForwardPull(clone);
      expect(result.status).toBe("up-to-date");
    });

    it("refuses a detached HEAD", async () => {
      git(clone, "checkout", "-q", "--detach");
      const result = await fastForwardPull(clone);
      expect(result.status).toBe("refused");
      expect(result.branch).toBeNull();
      expect(result.reason).toContain("detached");
    });

    it("refuses a branch with no upstream", async () => {
      git(clone, "checkout", "-q", "-b", "solo");
      const result = await fastForwardPull(clone);
      expect(result.status).toBe("refused");
      expect(result.reason).toContain("no upstream");
    });

    it("refuses a branch whose upstream has gone", async () => {
      git(origin, "branch", "temp");
      git(clone, "fetch", "-q", "origin");
      git(clone, "checkout", "-q", "--track", "origin/temp");
      git(origin, "branch", "-D", "temp");
      await fetchRepo(target("clone", clone));

      const result = await fastForwardPull(clone);

      expect(result.status).toBe("refused");
      expect(result.reason).toContain("no longer exists");
    });

    it("refuses a branch that has diverged from its upstream", async () => {
      commit(origin, "theirs");
      await fetchRepo(target("clone", clone));
      commit(clone, "mine");

      const result = await fastForwardPull(clone);

      expect(result.status).toBe("refused");
      expect(result.reason).toContain("diverged");
    });

    it("refuses a dirty working tree", async () => {
      commit(origin, "second");
      await fetchRepo(target("clone", clone));
      writeFileSync(join(clone, "scratch.txt"), "wip");

      const result = await fastForwardPull(clone);

      expect(result.status).toBe("refused");
      expect(result.reason).toContain("uncommitted changes");
    });

    it("reports git's message when the pull itself fails", async () => {
      commit(origin, "second");
      await fetchRepo(target("clone", clone));
      // The counts come off the remote-tracking ref, so the checkout still reads
      // as behind while the remote it would pull from has gone.
      git(clone, "remote", "set-url", "origin", join(root, "missing"));

      const result = await fastForwardPull(clone);

      expect(result.status).toBe("failed");
      expect(result.error).not.toBe("");
      expect(result.commits).toBe(0);
    });
  });
});
