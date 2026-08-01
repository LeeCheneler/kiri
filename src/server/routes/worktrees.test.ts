import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import type { WorktreesOverview } from "../git/overview.ts";
import { createApp } from "../index.ts";
import { CLIENT_HEADERS, type TestEnv, createTestEnv } from "./test-helpers.ts";

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
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

describe("worktrees routes", () => {
  let env: TestEnv;
  let events: KiriEvent[];

  beforeEach(() => {
    env = createTestEnv();
    events = [];
  });

  afterEach(() => {
    env.dispose();
  });

  const withBus = () => {
    const bus = createEventBus();
    bus.subscribe((event) => events.push(event));
    return bus;
  };

  // The workspace root doubles as the scanned root, so `repos:` live beside kiri.yaml.
  const configureRoots = (roots: string) =>
    writeFileSync(join(env.cwd, "kiri.yaml"), `git:\n  roots:\n${roots}`);

  const buildApp = (bus?: ReturnType<typeof createEventBus>) =>
    createApp({ db: env.db, registry: env.registry, config: env.config, env: {}, bus });

  describe("GET /api/worktrees", () => {
    it("returns an empty model when no roots are configured", async () => {
      const res = await buildApp().request("/api/worktrees");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ roots: [], repos: [] });
    });

    it("returns the grouped model for the configured roots", async () => {
      const repo = join(env.cwd, "repos", "proj");
      initRepo(repo);
      git(repo, "worktree", "add", "-q", join(env.cwd, "repos", "proj-feature"), "-b", "feature");
      configureRoots("    - repos\n");

      const res = await buildApp().request("/api/worktrees");
      const body = (await res.json()) as WorktreesOverview;
      expect(body.roots).toEqual([join(env.cwd, "repos")]);
      expect(body.repos).toHaveLength(1);
      expect(body.repos[0].name).toBe("proj");
      expect(body.repos[0].worktrees.map((w) => w.branch)).toEqual(["main", "feature"]);
    });

    it("reflects a config edit without a restart", async () => {
      initRepo(join(env.cwd, "repos", "proj"));
      const app = buildApp();
      expect(
        ((await (await app.request("/api/worktrees")).json()) as WorktreesOverview).repos,
      ).toHaveLength(0);

      configureRoots("    - repos\n");

      const body = (await (await app.request("/api/worktrees")).json()) as WorktreesOverview;
      expect(body.repos).toHaveLength(1);
    });
  });

  describe("POST /api/worktrees/refresh", () => {
    it("returns the freshly-built model and publishes git.changed", async () => {
      initRepo(join(env.cwd, "repos", "proj"));
      configureRoots("    - repos\n");

      const res = await buildApp(withBus()).request("/api/worktrees/refresh", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as WorktreesOverview;
      expect(body.repos.map((r) => r.name)).toEqual(["proj"]);
      expect(events).toEqual([{ type: "git.changed" }]);
    });

    it("works without an event bus", async () => {
      const res = await buildApp().request("/api/worktrees/refresh", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ roots: [], repos: [] });
    });

    it("rejects a request without the client header", async () => {
      const res = await buildApp().request("/api/worktrees/refresh", { method: "POST" });
      expect(res.status).toBe(403);
    });
  });

  // git records and reports canonical paths, so the temp dir's symlinked prefix
  // has to be resolved before a path is compared with — or handed to — the API.
  const realJoin = (...parts: string[]) => join(realpathSync(env.cwd), ...parts);

  const post = (app: ReturnType<typeof buildApp>, path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  describe("POST /api/worktrees/create", () => {
    it("creates a worktree, reports how the branch resolved, and publishes the change", async () => {
      initRepo(join(env.cwd, "repos", "proj"));
      configureRoots("    - repos\n");

      const res = await post(buildApp(withBus()), "/api/worktrees/create", {
        repo: "proj",
        branch: "feat/thing",
        name: "swift-otter",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.branchSource).toBe("new");
      expect(body.baseRef).toBe("main");
      expect(body.path).toBe(realJoin("repos", "proj-swift-otter"));
      expect(existsSync(body.path)).toBe(true);
      expect(events).toEqual([{ type: "git.changed" }]);
    });

    it("runs the repo's prep pipeline and carries its report", async () => {
      initRepo(join(env.cwd, "repos", "proj"));
      writeFileSync(
        join(env.cwd, "kiri.yaml"),
        [
          "git:",
          "  roots:",
          "    - repos",
          "  repos:",
          "    proj:",
          "      prepare:",
          "        postCreate: ['echo ready']",
          "",
        ].join("\n"),
      );

      const res = await post(buildApp(), "/api/worktrees/create", {
        repo: "proj",
        branch: "feat/thing",
      });

      const body = await res.json();
      expect(body.prepare.status).toBe("ok");
      expect(body.prepare.steps.map((s: { name: string }) => s.name)).toEqual([
        "postCreate: echo ready",
      ]);
    });

    it("answers 200 with the report when the worktree exists but its prep failed", async () => {
      initRepo(join(env.cwd, "repos", "proj"));
      writeFileSync(
        join(env.cwd, "kiri.yaml"),
        [
          "git:",
          "  roots:",
          "    - repos",
          "  repos:",
          "    proj:",
          "      prepare:",
          "        postCreate: ['echo halfway && exit 3']",
          "",
        ].join("\n"),
      );

      const res = await post(buildApp(withBus()), "/api/worktrees/create", {
        repo: "proj",
        branch: "feat/thing",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("failed");
      expect(body.prepare.steps[0].status).toBe("failed");
      expect(body.prepare.steps[0].stdout).toContain("halfway");
      expect(existsSync(body.path)).toBe(true);
      // The worktree is on disk, so the listing has to catch up either way.
      expect(events).toEqual([{ type: "git.changed" }]);
    });

    it("skips prep when asked", async () => {
      initRepo(join(env.cwd, "repos", "proj"));
      configureRoots("    - repos\n");

      const res = await post(buildApp(), "/api/worktrees/create", {
        repo: "proj",
        branch: "feat/thing",
        skipPrepare: true,
      });
      expect((await res.json()).prepare).toBeNull();
    });

    it("answers 400 when nothing was created", async () => {
      initRepo(join(env.cwd, "repos", "proj"));
      configureRoots("    - repos\n");
      mkdirSync(join(env.cwd, "repos", "proj-taken"), { recursive: true });

      const res = await post(buildApp(withBus()), "/api/worktrees/create", {
        repo: "proj",
        branch: "feat/thing",
        name: "taken",
      });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("already exists");
      expect(events).toEqual([]);
    });

    it("answers 404 for a repo outside the configured roots", async () => {
      initRepo(join(env.cwd, "repos", "proj"));
      configureRoots("    - repos\n");

      const res = await post(buildApp(), "/api/worktrees/create", {
        repo: "elsewhere",
        branch: "feat/thing",
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toContain("elsewhere");
    });

    it("rejects a malformed body", async () => {
      const res = await post(buildApp(), "/api/worktrees/create", { repo: "proj" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/worktrees/remove", () => {
    // A repo with one linked worktree on its own branch, ready to be removed.
    const repoWithWorktree = () => {
      const repo = join(env.cwd, "repos", "proj");
      initRepo(repo);
      git(repo, "worktree", "add", "-q", join(env.cwd, "repos", "proj-feature"), "-b", "feature");
      configureRoots("    - repos\n");
      return { repo: realJoin("repos", "proj"), worktree: realJoin("repos", "proj-feature") };
    };

    it("removes the worktree, reports the deleted branch's sha, and publishes", async () => {
      const { worktree } = repoWithWorktree();

      const res = await post(buildApp(withBus()), "/api/worktrees/remove", { path: worktree });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.branch).toBe("feature");
      expect(body.deletedBranchSha).toMatch(/^[0-9a-f]{40}$/);
      expect(existsSync(worktree)).toBe(false);
      expect(events).toEqual([{ type: "git.changed" }]);
    });

    it("refuses a dirty worktree and removes it once forced", async () => {
      const { worktree } = repoWithWorktree();
      writeFileSync(join(worktree, "scratch.txt"), "uncommitted");

      const refused = await post(buildApp(), "/api/worktrees/remove", { path: worktree });
      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toContain("uncommitted changes");
      expect(existsSync(worktree)).toBe(true);

      const forced = await post(buildApp(), "/api/worktrees/remove", {
        path: worktree,
        force: true,
      });
      expect(forced.status).toBe(200);
      expect(existsSync(worktree)).toBe(false);
    });

    it("answers 404 for a path outside the configured roots", async () => {
      repoWithWorktree();
      const res = await post(buildApp(), "/api/worktrees/remove", { path: "/elsewhere/proj-x" });
      expect(res.status).toBe(404);
    });

    it("answers 404 for the repo's primary checkout", async () => {
      const { repo } = repoWithWorktree();
      const res = await post(buildApp(), "/api/worktrees/remove", { path: repo });
      expect(res.status).toBe(404);
      expect(existsSync(repo)).toBe(true);
    });

    it("rejects a malformed body", async () => {
      const res = await post(buildApp(), "/api/worktrees/remove", { path: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/worktrees/prune", () => {
    it("clears the stale admin entries and publishes the change", async () => {
      const repo = join(env.cwd, "repos", "proj");
      initRepo(repo);
      const worktree = realJoin("repos", "proj-gone");
      git(repo, "worktree", "add", "-q", join(env.cwd, "repos", "proj-gone"), "-b", "gone");
      // Delete the directory behind git's back so its admin entry goes stale.
      rmSync(worktree, { recursive: true, force: true });
      configureRoots("    - repos\n");

      const res = await post(buildApp(withBus()), "/api/worktrees/prune", { repo: "proj" });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ repo: "proj", pruned: [worktree] });
      expect(events).toEqual([{ type: "git.changed" }]);
    });

    it("reports nothing pruned for a tidy repo", async () => {
      initRepo(join(env.cwd, "repos", "proj"));
      configureRoots("    - repos\n");

      const res = await post(buildApp(), "/api/worktrees/prune", { repo: "proj" });
      expect((await res.json()).pruned).toEqual([]);
    });

    it("answers 404 for a repo outside the configured roots", async () => {
      const res = await post(buildApp(), "/api/worktrees/prune", { repo: "proj" });
      expect(res.status).toBe(404);
    });

    it("rejects a malformed body", async () => {
      const res = await post(buildApp(), "/api/worktrees/prune", { name: "proj" });
      expect(res.status).toBe(400);
    });
  });
});
