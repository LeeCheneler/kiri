import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CommandResult,
  type CommandRunner,
  defaultCommandRunner,
  prepareWorktree,
} from "./prepare.ts";

// A recording runner: scripts each command's result and captures the calls,
// so a test asserts what ran without ever invoking a package manager.
const recordingRunner = (
  respond: (command: string, cwd: string) => CommandResult = () => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  }),
): { run: CommandRunner; calls: { command: string; cwd: string }[] } => {
  const calls: { command: string; cwd: string }[] = [];
  const run: CommandRunner = async (command, cwd) => {
    calls.push({ command, cwd });
    return respond(command, cwd);
  };
  return { run, calls };
};

// A runner that fails the test if any command is dispatched — proves a phase
// was skipped or the pipeline stopped before reaching it.
const neverRun: CommandRunner = async (command) => {
  throw new Error(`unexpected command: ${command}`);
};

describe("prepareWorktree", () => {
  let primary: string;
  let worktree: string;

  beforeEach(() => {
    primary = mkdtempSync(join(tmpdir(), "kiri-prep-primary-"));
    worktree = mkdtempSync(join(tmpdir(), "kiri-prep-worktree-"));
  });

  afterEach(() => {
    rmSync(primary, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  });

  const write = (root: string, rel: string, body = ""): void => {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  };

  const gitInit = (root: string): void => {
    const opts = { cwd: root } as const;
    spawnSync("git", ["init", "-q"], opts);
    spawnSync("git", ["config", "user.email", "t@t.co"], opts);
    spawnSync("git", ["config", "user.name", "t"], opts);
  };

  const gitTrack = (root: string, ...paths: string[]): void => {
    spawnSync("git", ["add", "-f", ...paths], { cwd: root });
    spawnSync("git", ["commit", "-qm", "init"], { cwd: root });
  };

  describe("env files", () => {
    it("leaves env files alone when env is omitted", async () => {
      write(primary, ".env", "SECRET=1\n");
      gitInit(primary);

      const report = await prepareWorktree(primary, worktree, {}, neverRun);

      expect(report.status).toBe("ok");
      expect(report.steps).toEqual([]);
      expect(existsSync(join(worktree, ".env"))).toBe(false);
    });

    it("symlinks each git-ignored env file into the same relative path", async () => {
      write(primary, ".gitignore", ".env\n.env.*\n");
      write(primary, ".env", "ROOT=1\n");
      write(primary, "packages/api/.env.local", "API=1\n");
      write(primary, "src/index.ts", "export const x = 1;\n");
      gitInit(primary);

      const report = await prepareWorktree(primary, worktree, { env: "symlink" }, neverRun);

      expect(report.status).toBe("ok");
      expect(report.steps).toEqual([{ name: "env: symlink", status: "ok" }]);

      const rootLink = join(worktree, ".env");
      expect(lstatSync(rootLink).isSymbolicLink()).toBe(true);
      expect(readlinkSync(rootLink)).toBe(join(primary, ".env"));

      const nestedLink = join(worktree, "packages/api/.env.local");
      expect(lstatSync(nestedLink).isSymbolicLink()).toBe(true);
      expect(readlinkSync(nestedLink)).toBe(join(primary, "packages/api/.env.local"));

      // A non-env file is never touched.
      expect(existsSync(join(worktree, "src/index.ts"))).toBe(false);
    });

    it("copies each git-ignored env file when env is copy", async () => {
      write(primary, ".gitignore", ".env\n");
      write(primary, ".env", "COPY_ME=1\n");
      gitInit(primary);

      const report = await prepareWorktree(primary, worktree, { env: "copy" }, neverRun);

      expect(report.steps).toEqual([{ name: "env: copy", status: "ok" }]);
      const dest = join(worktree, ".env");
      expect(lstatSync(dest).isSymbolicLink()).toBe(false);
      expect(readFileSync(dest, "utf8")).toBe("COPY_ME=1\n");
    });

    it("never touches a tracked env file even when it matches an ignore pattern", async () => {
      write(primary, ".gitignore", ".env*\n");
      write(primary, ".env", "IGNORED=1\n");
      write(primary, ".env.tracked", "TRACKED=1\n");
      gitInit(primary);
      // Force-add the tracked env file so git's index-aware check-ignore excludes it.
      gitTrack(primary, ".env.tracked", ".gitignore");

      const report = await prepareWorktree(primary, worktree, { env: "symlink" }, neverRun);

      expect(report.status).toBe("ok");
      expect(existsSync(join(worktree, ".env"))).toBe(true);
      expect(existsSync(join(worktree, ".env.tracked"))).toBe(false);
    });

    it("skips env files nested inside node_modules and .git", async () => {
      write(primary, ".gitignore", ".env\nnode_modules/\n");
      write(primary, ".env", "ROOT=1\n");
      write(primary, "node_modules/pkg/.env", "DEP=1\n");
      gitInit(primary);
      // A stray .env dropped into .git must never be discovered.
      write(primary, ".git/.env", "INTERNAL=1\n");

      const report = await prepareWorktree(primary, worktree, { env: "symlink" }, neverRun);

      expect(report.status).toBe("ok");
      expect(existsSync(join(worktree, ".env"))).toBe(true);
      expect(existsSync(join(worktree, "node_modules/pkg/.env"))).toBe(false);
      expect(existsSync(join(worktree, ".git/.env"))).toBe(false);
    });

    it("reports env ok with nothing linked when the tree has no env files", async () => {
      write(primary, "src/index.ts", "export const x = 1;\n");
      gitInit(primary);

      const report = await prepareWorktree(primary, worktree, { env: "symlink" }, neverRun);

      expect(report.steps).toEqual([{ name: "env: symlink", status: "ok" }]);
    });

    it("touches nothing when the primary checkout is not a git working tree", async () => {
      // No git init: check-ignore can't verify, so no env file is trusted.
      write(primary, ".env", "SECRET=1\n");

      const report = await prepareWorktree(primary, worktree, { env: "symlink" }, neverRun);

      expect(report.status).toBe("ok");
      expect(report.steps).toEqual([{ name: "env: symlink", status: "ok" }]);
      expect(existsSync(join(worktree, ".env"))).toBe(false);
    });

    it("fails the env step and stops the pipeline when a file operation errors", async () => {
      write(primary, ".gitignore", ".env\n");
      write(primary, "sub/.env", "NESTED=1\n");
      gitInit(primary);
      // A file where the worktree needs a directory makes mkdir throw.
      writeFileSync(join(worktree, "sub"), "not a dir");

      const report = await prepareWorktree(
        primary,
        worktree,
        { env: "symlink", install: "auto", postCreate: ["echo hi"] },
        neverRun,
      );

      expect(report.status).toBe("failed");
      expect(report.steps).toHaveLength(1);
      expect(report.steps[0].name).toBe("env: symlink");
      expect(report.steps[0].status).toBe("failed");
      expect(report.steps[0].error).toBeDefined();
    });
  });

  describe("dependency installs", () => {
    it("skips installs when install is off", async () => {
      write(worktree, "package-lock.json", "{}");

      const report = await prepareWorktree(worktree, worktree, { install: "off" }, neverRun);

      expect(report.status).toBe("ok");
      expect(report.steps).toEqual([]);
    });

    it("skips installs when install is omitted", async () => {
      write(worktree, "bun.lock", "");

      const report = await prepareWorktree(worktree, worktree, {}, neverRun);

      expect(report.steps).toEqual([]);
    });

    it("runs the matching install in each lockfile's own directory, ordered by path", async () => {
      write(worktree, "package-lock.json", "{}");
      write(worktree, "packages/api/pnpm-lock.yaml", "");
      write(worktree, "packages/web/yarn.lock", "");

      const { run, calls } = recordingRunner();
      const report = await prepareWorktree(primary, worktree, { install: "auto" }, run);

      expect(report.status).toBe("ok");
      expect(calls).toEqual([
        { command: "npm install", cwd: worktree },
        { command: "pnpm install", cwd: join(worktree, "packages/api") },
        { command: "yarn install", cwd: join(worktree, "packages/web") },
      ]);
      expect(report.steps.map((s) => s.name)).toEqual([
        "install: npm (.)",
        "install: pnpm (packages/api)",
        "install: yarn (packages/web)",
      ]);
      expect(report.steps.every((s) => s.status === "ok")).toBe(true);
    });

    it("maps bun lockfiles to a bun install", async () => {
      write(worktree, "bun.lockb", "");

      const { run, calls } = recordingRunner();
      await prepareWorktree(primary, worktree, { install: "auto" }, run);

      expect(calls).toEqual([{ command: "bun install", cwd: worktree }]);
    });

    it("installs once per directory when several lockfiles coexist, honouring precedence", async () => {
      // Same dir: bun.lock + bun.lockb collapse to one bun install.
      write(worktree, "bun.lock", "");
      write(worktree, "bun.lockb", "");
      // Same dir: pnpm wins over npm by precedence.
      write(worktree, "svc/pnpm-lock.yaml", "");
      write(worktree, "svc/package-lock.json", "{}");

      const { run, calls } = recordingRunner();
      await prepareWorktree(primary, worktree, { install: "auto" }, run);

      expect(calls).toEqual([
        { command: "bun install", cwd: worktree },
        { command: "pnpm install", cwd: join(worktree, "svc") },
      ]);
    });

    it("ignores lockfiles inside node_modules", async () => {
      write(worktree, "node_modules/dep/package-lock.json", "{}");

      const report = await prepareWorktree(worktree, worktree, { install: "auto" }, neverRun);

      expect(report.steps).toEqual([]);
    });

    it("stops at the first failed install and skips later installs", async () => {
      write(worktree, "package-lock.json", "{}");
      write(worktree, "later/yarn.lock", "");

      const { run, calls } = recordingRunner((command) =>
        command === "npm install"
          ? { exitCode: 1, stdout: "boom", stderr: "" }
          : { exitCode: 0, stdout: "", stderr: "" },
      );
      const report = await prepareWorktree(primary, worktree, { install: "auto" }, run);

      expect(report.status).toBe("failed");
      // Only the failing install ran; the yarn install never dispatched.
      expect(calls).toEqual([{ command: "npm install", cwd: worktree }]);
      expect(report.steps).toHaveLength(1);
      expect(report.steps[0]).toMatchObject({
        name: "install: npm (.)",
        status: "failed",
        error: "exited with code 1",
        stdout: "boom",
      });
    });
  });

  describe("post-create commands", () => {
    it("runs each command sequentially in the worktree root", async () => {
      const { run, calls } = recordingRunner();
      const report = await prepareWorktree(
        primary,
        worktree,
        { postCreate: ["mise trust", "echo done"] },
        run,
      );

      expect(report.status).toBe("ok");
      expect(calls).toEqual([
        { command: "mise trust", cwd: worktree },
        { command: "echo done", cwd: worktree },
      ]);
      expect(report.steps).toEqual([
        { name: "postCreate: mise trust", status: "ok" },
        { name: "postCreate: echo done", status: "ok" },
      ]);
    });

    it("fails fast on the first non-zero command and skips the rest", async () => {
      const { run, calls } = recordingRunner((command) =>
        command === "first"
          ? { exitCode: 2, stdout: "", stderr: "nope" }
          : { exitCode: 0, stdout: "", stderr: "" },
      );
      const report = await prepareWorktree(
        primary,
        worktree,
        { postCreate: ["first", "second"] },
        run,
      );

      expect(report.status).toBe("failed");
      expect(calls).toEqual([{ command: "first", cwd: worktree }]);
      expect(report.steps).toEqual([
        {
          name: "postCreate: first",
          status: "failed",
          error: "exited with code 2",
          stdout: undefined,
          stderr: "nope",
        },
      ]);
    });

    it("stops the pipeline before installs when a command fails", async () => {
      write(worktree, "bun.lock", "");

      const { run, calls } = recordingRunner((command) =>
        command === "mise trust"
          ? { exitCode: 1, stdout: "", stderr: "untrusted" }
          : { exitCode: 0, stdout: "", stderr: "" },
      );
      const report = await prepareWorktree(
        primary,
        worktree,
        { install: "auto", postCreate: ["mise trust"] },
        run,
      );

      expect(report.status).toBe("failed");
      expect(calls).toEqual([{ command: "mise trust", cwd: worktree }]);
      expect(report.steps.map((s) => s.name)).toEqual(["postCreate: mise trust"]);
    });

    it("omits both stream tails on a failure that produced no output", async () => {
      const { run } = recordingRunner(() => ({ exitCode: 5, stdout: "", stderr: "" }));
      const report = await prepareWorktree(primary, worktree, { postCreate: ["boom"] }, run);

      expect(report.steps[0]).toEqual({
        name: "postCreate: boom",
        status: "failed",
        error: "exited with code 5",
        stdout: undefined,
        stderr: undefined,
      });
    });

    it("truncates a long failure stream to its tail with a marker", async () => {
      const long = "y".repeat(9000);
      const { run } = recordingRunner(() => ({ exitCode: 1, stdout: long, stderr: "" }));
      const report = await prepareWorktree(primary, worktree, { postCreate: ["boom"] }, run);

      expect(report.steps[0].stdout).toBe(
        `[truncated — earlier output dropped]\n${"y".repeat(8192)}`,
      );
    });

    it("drops an orphaned surrogate half left at the truncation boundary", async () => {
      // The cut lands on the low surrogate half of an emoji straddling the cap.
      const stdout = `a😀${"x".repeat(8191)}`;
      const { run } = recordingRunner(() => ({ exitCode: 1, stdout, stderr: "" }));
      const report = await prepareWorktree(primary, worktree, { postCreate: ["boom"] }, run);

      expect(report.steps[0].stdout).toBe(
        `[truncated — earlier output dropped]\n${"x".repeat(8191)}`,
      );
    });
  });

  describe("full pipeline ordering", () => {
    it("runs env, then post-create, then installs in order", async () => {
      write(primary, ".gitignore", ".env\n");
      write(primary, ".env", "E=1\n");
      gitInit(primary);
      write(worktree, "bun.lock", "");

      const { run, calls } = recordingRunner();
      const report = await prepareWorktree(
        primary,
        worktree,
        { env: "copy", install: "auto", postCreate: ["echo hi"] },
        run,
      );

      expect(report.status).toBe("ok");
      expect(report.steps.map((s) => s.name)).toEqual([
        "env: copy",
        "postCreate: echo hi",
        "install: bun (.)",
      ]);
      expect(calls.map((c) => c.command)).toEqual(["echo hi", "bun install"]);
    });
  });
});

describe("defaultCommandRunner", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-prep-run-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("captures stdout and a zero exit for a successful command", async () => {
    const result = await defaultCommandRunner("echo hello", dir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
  });

  it("captures stderr and the exit code for a failing command", async () => {
    const result = await defaultCommandRunner("echo boom 1>&2; exit 3", dir);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("boom\n");
  });
});
