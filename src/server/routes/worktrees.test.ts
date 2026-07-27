import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import { createApp } from "../index.ts";
import type { WorktreesOverview } from "../worktrees/overview.ts";
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
    writeFileSync(join(env.cwd, "kiri.yaml"), `worktrees:\n  roots:\n${roots}`);

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
    it("returns the freshly-built model and publishes worktrees.changed", async () => {
      initRepo(join(env.cwd, "repos", "proj"));
      configureRoots("    - repos\n");

      const res = await buildApp(withBus()).request("/api/worktrees/refresh", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as WorktreesOverview;
      expect(body.repos.map((r) => r.name)).toEqual(["proj"]);
      expect(events).toEqual([{ type: "worktrees.changed" }]);
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
});
