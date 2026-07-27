import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * How env files are shared into a fresh worktree. `symlink` links each into
 * the same relative path (values shared, edits affect every worktree);
 * `copy` copies each (independent per-worktree values). Omitting the option
 * leaves env files entirely alone.
 */
export type EnvMode = "symlink" | "copy";

/** `auto` detects lockfiles and runs the matching install; `off` skips installs. */
export type InstallMode = "auto" | "off";

/**
 * Resolved prep options for a single worktree. Every field is optional and
 * omission is inert: no `env` leaves env files alone, no/`off` `install`
 * skips installs, no `postCreate` runs nothing. Config wiring resolves these
 * from `kiri.yaml`; this module owns the shape it consumes.
 */
export interface PrepareOptions {
  env?: EnvMode;
  install?: InstallMode;
  postCreate?: string[];
}

/** Outcome of one command run through the injectable runner. */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a shell command string in `cwd` and resolves its result. Injected so
 * tests never actually invoke package managers; the default runs `bash -c`
 * on the host with the kiri process's environment.
 */
export type CommandRunner = (command: string, cwd: string) => Promise<CommandResult>;

/** One entry in the prep report — a single env, install, or post-create action. */
export interface PrepareStep {
  name: string;
  status: "ok" | "failed";
  /** Tail of captured stdout, present only on a failed command with output. */
  stdout?: string;
  /** Tail of captured stderr, present only on a failed command with output. */
  stderr?: string;
  /** Failure reason, present only on a failed step. */
  error?: string;
}

/**
 * Structured result of preparing a worktree: an overall status and a step
 * per action taken, in execution order. `failed` means a step failed and the
 * pipeline stopped; later steps are absent rather than skipped-and-listed.
 */
export interface PrepareReport {
  status: "ok" | "failed";
  steps: PrepareStep[];
}

// Per-stream cap on the failure output attached to a failed step. The tail is
// kept — a failing install or command prints its cause last — and the marker
// flags the cut so a reader treats the stream as incomplete.
const FAILURE_STREAM_CAP = 8 * 1024;

const streamTail = (value: string): string | undefined => {
  if (value === "") return undefined;
  if (value.length <= FAILURE_STREAM_CAP) return value;
  let tail = value.slice(-FAILURE_STREAM_CAP);
  // slice() cuts at a UTF-16 code-unit index, so a surrogate pair (emoji etc.)
  // can be split at the cap. A tail starting with a low surrogate
  // (0xdc00–0xdfff) carries an orphan half — drop it so the text stays valid.
  const first = tail.charCodeAt(0);
  if (first >= 0xdc00 && first <= 0xdfff) tail = tail.slice(1);
  return `[truncated — earlier output dropped]\n${tail}`;
};

// Directories never walked when discovering env files or lockfiles: the git
// internals and installed dependencies, which hold neither the user's env
// files nor the tracked lockfiles we care about.
const SKIP_DIRS = new Set([".git", "node_modules"]);

// Every file under `root` as a path relative to it, skipping SKIP_DIRS and
// following no symlinks (they are neither recursed into nor collected), so a
// symlink cycle can't hang the walk.
const listFiles = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel === "" ? entry.name : join(rel, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  };
  walk(root, "");
  return out;
};

const isEnvName = (name: string): boolean => name === ".env" || name.startsWith(".env.");

// The `.env`/`.env.*` files under `primary` that git ignores, verified with a
// single `git check-ignore`: it echoes the ignored subset and, being
// index-aware by default, excludes any env file that is actually tracked. A
// primary that isn't a git working tree (or a git that can't run) yields
// nothing rather than touching files we can't vet.
const ignoredEnvFiles = (primary: string): string[] => {
  const candidates = listFiles(primary).filter((rel) => isEnvName(basename(rel)));
  if (candidates.length === 0) return [];
  const result = spawnSync("git", ["check-ignore", ...candidates], {
    cwd: primary,
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .sort();
};

const prepareEnvFiles = (primary: string, worktree: string, mode: EnvMode): PrepareStep => {
  const name = `env: ${mode}`;
  try {
    for (const rel of ignoredEnvFiles(primary)) {
      const dest = join(worktree, rel);
      mkdirSync(dirname(dest), { recursive: true });
      if (mode === "symlink") symlinkSync(join(primary, rel), dest);
      else copyFileSync(join(primary, rel), dest);
    }
  } catch (cause) {
    return {
      name,
      status: "failed",
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
  return { name, status: "ok" };
};

type PackageManager = "pnpm" | "yarn" | "npm" | "bun";

// Lockfile → package manager, in precedence order: a directory carrying more
// than one lockfile installs once, with the earlier entry winning.
const LOCKFILES: readonly { file: string; pm: PackageManager }[] = [
  { file: "pnpm-lock.yaml", pm: "pnpm" },
  { file: "yarn.lock", pm: "yarn" },
  { file: "package-lock.json", pm: "npm" },
  { file: "bun.lock", pm: "bun" },
  { file: "bun.lockb", pm: "bun" },
];

// One install target per lockfile-bearing directory under `worktree`,
// deduplicated by directory and ordered by path for a stable report.
const detectInstalls = (worktree: string): { pm: PackageManager; relDir: string }[] => {
  const byDir = new Map<string, Set<string>>();
  for (const rel of listFiles(worktree)) {
    const name = basename(rel);
    if (LOCKFILES.some((lock) => lock.file === name)) {
      const dir = dirname(rel);
      const names = byDir.get(dir) ?? new Set<string>();
      names.add(name);
      byDir.set(dir, names);
    }
  }
  const installs: { pm: PackageManager; relDir: string }[] = [];
  for (const [relDir, names] of byDir) {
    for (const lock of LOCKFILES) {
      if (names.has(lock.file)) {
        installs.push({ pm: lock.pm, relDir });
        break;
      }
    }
  }
  return installs.sort((a, b) => a.relDir.localeCompare(b.relDir));
};

// A command result mapped onto a report step. A non-zero exit is a failed
// step carrying the exit code and the tails of both streams; success carries
// neither stream, keeping the report lean.
const commandStep = (name: string, result: CommandResult): PrepareStep => {
  if (result.exitCode === 0) return { name, status: "ok" };
  return {
    name,
    status: "failed",
    error: `exited with code ${result.exitCode}`,
    stdout: streamTail(result.stdout),
    stderr: streamTail(result.stderr),
  };
};

/**
 * The default host runner: `bash -c <command>` in `cwd`, inheriting the kiri
 * process's environment so the user's PATH and tooling resolve. stdin is
 * closed; stdout and stderr are captured in full.
 */
export const defaultCommandRunner: CommandRunner = async (command, cwd) => {
  const proc = Bun.spawn({
    cmd: ["bash", "-c", command],
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

/**
 * Prepare a freshly-created worktree: share the primary checkout's git-ignored
 * env files (symlinked or copied), install dependencies for every lockfile in
 * the tree, then run the post-create commands. Runs fail-fast in that order —
 * the first failed step stops the pipeline — and returns a per-step report for
 * the UI and tools to render. Command execution goes through `run` so it can
 * be stubbed; it defaults to the host `bash -c` runner.
 */
export async function prepareWorktree(
  primaryCheckoutPath: string,
  worktreePath: string,
  options: PrepareOptions,
  run: CommandRunner = defaultCommandRunner,
): Promise<PrepareReport> {
  const steps: PrepareStep[] = [];

  if (options.env !== undefined) {
    const step = prepareEnvFiles(primaryCheckoutPath, worktreePath, options.env);
    steps.push(step);
    if (step.status === "failed") return { status: "failed", steps };
  }

  if (options.install === "auto") {
    for (const { pm, relDir } of detectInstalls(worktreePath)) {
      const result = await run(`${pm} install`, join(worktreePath, relDir));
      const step = commandStep(`install: ${pm} (${relDir})`, result);
      steps.push(step);
      if (step.status === "failed") return { status: "failed", steps };
    }
  }

  for (const command of options.postCreate ?? []) {
    const result = await run(command, worktreePath);
    const step = commandStep(`postCreate: ${command}`, result);
    steps.push(step);
    if (step.status === "failed") return { status: "failed", steps };
  }

  return { status: "ok", steps };
}
